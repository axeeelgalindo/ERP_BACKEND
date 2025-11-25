// src/controllers/ventas.controllers.js
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";
import { registrarAuditLog } from "../services/auditLog.service.js";

const prisma = new PrismaClient();
const PAGE = 1,
  SIZE = 20;

/* ===== Helpers ===== */
const toBool = (v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string")
    return ["1", "true", "on", "yes"].includes(v.toLowerCase());
  return false;
};

// Ajusta a tu catálogo real
const ESTADOS = ["pendiente", "aprobada", "anulada", "facturada"];

async function assertEntidadEmpresa(tx, tabla, id, empresaId) {
  if (!id) return;
  const by = {
    proyecto: () =>
      tx.proyecto.findFirst({
        where: { id, empresa_id: empresaId },
        select: { id: true },
      }),
    cliente: () =>
      tx.cliente.findFirst({
        where: { id, empresa_id: empresaId },
        select: { id: true },
      }),
    producto: () =>
      tx.producto.findFirst({
        where: { id, empresa_id: empresaId },
        select: { id: true },
      }),
    cotizacion: () =>
      tx.cotizacion.findFirst({
        where: { id, empresa_id: empresaId },
        select: { id: true, estado: true },
      }),
  }[tabla];

  const ok = await by();
  if (!ok)
    throw Object.assign(new Error(`${tabla} no pertenece a tu empresa`), {
      statusCode: 403,
    });

  return ok;
}

function calcTotal(items = []) {
  return items.reduce(
    (a, it) => a + Number(it.cantidad || 0) * Number(it.precio_unit || 0),
    0
  );
}

async function recalcTotalTX(tx, ventaId) {
  const items = await tx.ventaItem.findMany({
    where: { venta_id: ventaId },
    select: { cantidad: true, precio_unit: true },
  });
  const total = calcTotal(items);
  await tx.venta.update({ where: { id: ventaId }, data: { total } });
  return total;
}

function getRequestMeta(request) {
  return {
    ip: request.ip || null,
    userAgent: request.headers["user-agent"] || null,
  };
}

/* ===== LIST ===== */
export async function listVentas(request, reply) {
  const scope = resolveScope(request);
  const {
    q,
    estado,
    clienteId,
    proyectoId,
    page = PAGE,
    pageSize = SIZE,
    includeDeleted,
    empresaId,
    cotizacionId,
  } = request.query || {};

  const empresa_id = scope.isMaster
    ? empresaId || scope.empresaId
    : scope.empresaId;

  const where = {
    empresa_id,
    ...(estado ? { estado } : {}),
    ...(clienteId ? { cliente_id: clienteId } : {}),
    ...(proyectoId ? { proyecto_id: proyectoId } : {}),
    ...(cotizacionId ? { cotizacion_id: cotizacionId } : {}),
    ...(q
      ? {
          OR: [
            { numero: { contains: q, mode: "insensitive" } },
            {
              cliente: {
                nombre: { contains: q, mode: "insensitive" },
              },
            },
            {
              proyecto: {
                nombre: { contains: q, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
    ...(includeDeleted ? {} : { eliminado: false }),
  };

  const [total, data] = await Promise.all([
    prisma.venta.count({ where }),
    prisma.venta.findMany({
      where,
      orderBy: [{ creada_en: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        cliente: { select: { id: true, nombre: true } },
        proyecto: { select: { id: true, nombre: true } },
        cotizacion: { select: { id: true, numero: true, estado: true } },
        items: true,
      },
    }),
  ]);

  return reply.send({ total, page, pageSize, data });
}

/* ===== GET ===== */
export async function getVenta(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.venta.findFirst({
    where: { id, empresa_id: scope.isMaster ? undefined : scope.empresaId },
    include: {
      cliente: true,
      proyecto: true,
      cotizacion: true,
      items: { include: { producto: true } },
    },
  });
  if (!row) return httpError(reply, 404, "Venta no encontrada");
  return reply.send(row);
}

/* ===== CREATE (TX + total backend) ===== */
export async function createVenta(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};
  const empresa_id = scope.isMaster
    ? body.empresa_id || scope.empresaId
    : scope.empresaId;

  const items = Array.isArray(body.items) ? body.items : [];
  const estado =
    body.estado && ESTADOS.includes(body.estado) ? body.estado : "pendiente";

  const { ip, userAgent } = getRequestMeta(request);

  const row = await prisma.$transaction(async (tx) => {
    await assertEntidadEmpresa(tx, "proyecto", body.proyecto_id, empresa_id);
    await assertEntidadEmpresa(tx, "cliente", body.cliente_id, empresa_id);

    let cotizacionId = null;
    if (body.cotizacion_id) {
      const cot = await assertEntidadEmpresa(
        tx,
        "cotizacion",
        body.cotizacion_id,
        empresa_id
      );
      // si quieres exigir que esté aceptada:
      // if (cot.estado !== "aceptada") {
      //   throw Object.assign(new Error("La cotización debe estar aceptada"), { statusCode: 409 });
      // }
      cotizacionId = cot.id;
    }

    for (const it of items) {
      if (it.producto_id)
        await assertEntidadEmpresa(tx, "producto", it.producto_id, empresa_id);
    }

    const created = await tx.venta.create({
      data: {
        empresa_id,
        proyecto_id: body.proyecto_id,
        cliente_id: body.cliente_id,
        cotizacion_id: cotizacionId,
        numero: body.numero, // único
        estado,
        total: 0, // se corrige tras crear ítems
        items: {
          create: items.map((it) => ({
            producto_id: it.producto_id ?? null,
            cantidad: Number(it.cantidad || 0),
            precio_unit: Number(it.precio_unit || 0),
            total: Number((it.cantidad || 0) * (it.precio_unit || 0)),
          })),
        },
      },
    });

    const total = await recalcTotalTX(tx, created.id);
    return { ...created, total };
  });

  await registrarAuditLog({
    empresaId: row.empresa_id,
    usuarioId: scope.usuarioId || null,
    entidad: "Venta",
    registroId: row.id,
    accion: "CREATE",
    detalles: {
      numero: row.numero,
      estado: row.estado,
      cotizacion_id: row.cotizacion_id,
    },
    ip,
    userAgent,
  });

  const withItems = await prisma.venta.findUnique({
    where: { id: row.id },
    include: { items: true, cliente: true, proyecto: true, cotizacion: true },
  });

  return reply.code(201).send(withItems);
}

/* ===== UPDATE (TX + total backend) ===== */
export async function updateVenta(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const data = { ...request.body };
  if (data.total != null) delete data.total; // siempre backend

  const exists = await prisma.venta.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!exists) return httpError(reply, 404, "Venta no encontrada");
  if (!scope.isMaster && exists.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Venta fuera de tu empresa");

  const before = exists;
  const { ip, userAgent } = getRequestMeta(request);

  const updated = await prisma.$transaction(async (tx) => {
    const empresa_id = exists.empresa_id;

    if (data.proyecto_id && data.proyecto_id !== exists.proyecto_id)
      await assertEntidadEmpresa(tx, "proyecto", data.proyecto_id, empresa_id);
    if (data.cliente_id && data.cliente_id !== exists.cliente_id)
      await assertEntidadEmpresa(tx, "cliente", data.cliente_id, empresa_id);

    if (data.cotizacion_id && data.cotizacion_id !== exists.cotizacion_id) {
      const cot = await assertEntidadEmpresa(
        tx,
        "cotizacion",
        data.cotizacion_id,
        empresa_id
      );
      data.cotizacion_id = cot.id;
    }

    if (data.estado && !ESTADOS.includes(data.estado)) {
      throw Object.assign(new Error("Estado inválido"), { statusCode: 400 });
    }

    const incomingItems = Array.isArray(data.items) ? data.items : null;
    if (incomingItems) {
      for (const it of incomingItems) {
        if (it.producto_id)
          await assertEntidadEmpresa(tx, "producto", it.producto_id, empresa_id);
      }

      await tx.ventaItem.deleteMany({ where: { venta_id: id } });
      if (incomingItems.length) {
        await tx.ventaItem.createMany({
          data: incomingItems.map((it) => ({
            venta_id: id,
            producto_id: it.producto_id ?? null,
            cantidad: Number(it.cantidad || 0),
            precio_unit: Number(it.precio_unit || 0),
            total: Number((it.cantidad || 0) * (it.precio_unit || 0)),
          })),
        });
      }
      delete data.items;
    }

    await tx.venta.update({ where: { id }, data });
    await recalcTotalTX(tx, id);

    return tx.venta.findUnique({
      where: { id },
      include: { items: true, cliente: true, proyecto: true, cotizacion: true },
    });
  });

  await registrarAuditLog({
    empresaId: updated.empresa_id,
    usuarioId: scope.usuarioId || null,
    entidad: "Venta",
    registroId: updated.id,
    accion: "UPDATE",
    detalles: {
      before: {
        numero: before.numero,
        estado: before.estado,
        cotizacion_id: before.cotizacion_id,
        total: before.total,
      },
      after: {
        numero: updated.numero,
        estado: updated.estado,
        cotizacion_id: updated.cotizacion_id,
        total: updated.total,
      },
    },
    ip,
    userAgent,
  });

  return reply.send(updated);
}

/* ===== DELETE (físico) con reverso si estaba aprobada y ?force=true ===== */
export async function deleteVenta(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { force } = request.query || {};
  const { ip, userAgent } = getRequestMeta(request);

  const row = await prisma.venta.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
    include: { items: true },
  });
  if (!row) return httpError(reply, 404, "Venta no encontrada");

  const isForce =
    String(force).toLowerCase() === "true" ||
    force === 1 ||
    force === "1" ||
    force === true;

  if (!isForce && row.estado !== "pendiente") {
    return httpError(
      reply,
      409,
      "Solo ventas en pendiente. Usa ?force=true para borrar definitivamente."
    );
  }

  await prisma.$transaction(async (tx) => {
    if (isForce && row.estado === "aprobada") {
      for (const it of row.items) {
        if (!it.producto_id) continue;
        await tx.producto.update({
          where: { id: it.producto_id },
          data: { stock: { increment: Number(it.cantidad || 0) } },
        });
      }
    }

    await tx.ventaItem.deleteMany({ where: { venta_id: id } });
    await tx.venta.delete({ where: { id } });
  });

  await registrarAuditLog({
    empresaId: row.empresa_id,
    usuarioId: scope.usuarioId || null,
    entidad: "Venta",
    registroId: row.id,
    accion: isForce ? "DELETE_FORCE" : "DELETE",
    detalles: {
      numero: row.numero,
      estado: row.estado,
      force: isForce,
    },
    ip,
    userAgent,
  });

  return reply.send({ success: true });
}

/* ===== SOFT-DELETE / RESTORE ===== */
export async function disableVenta(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { ip, userAgent } = getRequestMeta(request);

  const row = await prisma.venta.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
  });
  if (!row) return httpError(reply, 404, "Venta no encontrada");
  if (row.eliminado) return httpError(reply, 409, "Venta ya está eliminada");

  const upd = await prisma.venta.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });

  await registrarAuditLog({
    empresaId: upd.empresa_id,
    usuarioId: scope.usuarioId || null,
    entidad: "Venta",
    registroId: upd.id,
    accion: "SOFT_DELETE",
    detalles: { numero: upd.numero },
    ip,
    userAgent,
  });

  return reply.send({ success: true, venta: upd });
}

export async function restoreVenta(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { ip, userAgent } = getRequestMeta(request);

  const row = await prisma.venta.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
  });
  if (!row) return httpError(reply, 404, "Venta no encontrada");
  if (!row.eliminado)
    return httpError(reply, 409, "Venta no está eliminada");

  const upd = await prisma.venta.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });

  await registrarAuditLog({
    empresaId: upd.empresa_id,
    usuarioId: scope.usuarioId || null,
    entidad: "Venta",
    registroId: upd.id,
    accion: "RESTORE",
    detalles: { numero: upd.numero },
    ip,
    userAgent,
  });

  return reply.send({ success: true, venta: upd });
}

/* ===== PATCH ESTADO (con ajuste de stock) ===== */
export async function setEstadoVenta(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { estado } = request.body || {};
  const ESTADOS_VALIDOS = ["pendiente", "aprobada", "anulada", "facturada"];

  if (!ESTADOS_VALIDOS.includes(estado)) {
    return httpError(reply, 400, "Estado inválido");
  }

  const venta = await prisma.venta.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
    include: { items: true },
  });
  if (!venta) return httpError(reply, 404, "Venta no encontrada");

  if (venta.estado === estado) {
    return reply.send({ ok: true, row: venta });
  }

  const { ip, userAgent } = getRequestMeta(request);
  const beforeEstado = venta.estado;

  const updated = await prisma.$transaction(async (tx) => {
    if (venta.estado === "pendiente" && estado === "aprobada") {
      for (const it of venta.items) {
        if (!it.producto_id) continue;
        const p = await tx.producto.findUnique({
          where: { id: it.producto_id },
          select: { stock: true },
        });
        const cant = Number(it.cantidad || 0);
        if (!p || p.stock < cant) {
          throw Object.assign(
            new Error(`Stock insuficiente para producto ${it.producto_id}`),
            { statusCode: 409 }
          );
        }
      }
      for (const it of venta.items) {
        if (!it.producto_id) continue;
        await tx.producto.update({
          where: { id: it.producto_id },
          data: { stock: { decrement: Number(it.cantidad || 0) } },
        });
      }
    } else if (venta.estado === "aprobada" && estado === "anulada") {
      for (const it of venta.items) {
        if (!it.producto_id) continue;
        await tx.producto.update({
          where: { id: it.producto_id },
          data: { stock: { increment: Number(it.cantidad || 0) } },
        });
      }
    }

    await tx.venta.update({ where: { id: venta.id }, data: { estado } });

    return tx.venta.findUnique({
      where: { id: venta.id },
      include: { items: true, cliente: true, proyecto: true, cotizacion: true },
    });
  });

  await registrarAuditLog({
    empresaId: updated.empresa_id,
    usuarioId: scope.usuarioId || null,
    entidad: "Venta",
    registroId: updated.id,
    accion: "CAMBIO_ESTADO",
    detalles: {
      numero: updated.numero,
      antes: beforeEstado,
      despues: updated.estado,
    },
    ip,
    userAgent,
  });

  return reply.send({ ok: true, row: updated });
}

/* ===== ÍTEMS: add / update / delete (siempre recalcular) ===== */
export async function addItem(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params; // ventaId
  const body = request.body || {};

  const venta = await prisma.venta.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
    select: { id: true, empresa_id: true, numero: true },
  });
  if (!venta) return httpError(reply, 404, "Venta no encontrada");

  const { ip, userAgent } = getRequestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    if (body.producto_id) {
      await assertEntidadEmpresa(tx, "producto", body.producto_id, venta.empresa_id);
    }

    const itemCreated = await tx.ventaItem.create({
      data: {
        venta_id: id,
        producto_id: body.producto_id ?? null,
        cantidad: Number(body.cantidad || 0),
        precio_unit: Number(body.precio_unit || 0),
        total: Number((body.cantidad || 0) * (body.precio_unit || 0)),
      },
    });

    await recalcTotalTX(tx, id);

    const ventaUpdated = await tx.venta.findUnique({
      where: { id },
      include: { items: true },
    });

    return { ventaUpdated, itemCreated };
  });

  await registrarAuditLog({
    empresaId: venta.empresa_id,
    usuarioId: scope.usuarioId || null,
    entidad: "VentaItem",
    registroId: result.itemCreated.id,
    accion: "CREATE",
    detalles: {
      venta_id: venta.id,
      venta_numero: venta.numero,
      item: result.itemCreated,
    },
    ip,
    userAgent,
  });

  return reply.code(201).send(result.ventaUpdated);
}

export async function updateItem(request, reply) {
  const scope = resolveScope(request);
  const { itemId } = request.params;
  const body = request.body || {};

  const item = await prisma.ventaItem.findFirst({
    where: { id: itemId },
    include: { venta: true },
  });
  if (!item) return httpError(reply, 404, "Ítem no encontrado");
  if (!scope.isMaster && item.venta.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Fuera de tu empresa");

  const before = item;
  const { ip, userAgent } = getRequestMeta(request);

  const updatedInfo = await prisma.$transaction(async (tx) => {
    if (body.producto_id) {
      await assertEntidadEmpresa(
        tx,
        "producto",
        body.producto_id,
        item.venta.empresa_id
      );
    }
    const updatedItem = await tx.ventaItem.update({
      where: { id: itemId },
      data: {
        ...(body.producto_id !== undefined
          ? { producto_id: body.producto_id }
          : {}),
        ...(body.cantidad !== undefined
          ? { cantidad: Number(body.cantidad) }
          : {}),
        ...(body.precio_unit !== undefined
          ? { precio_unit: Number(body.precio_unit) }
          : {}),
        ...(body.cantidad !== undefined || body.precio_unit !== undefined
          ? {
              total: Number(
                (body.cantidad ?? item.cantidad) *
                  (body.precio_unit ?? item.precio_unit)
              ),
            }
          : {}),
      },
    });
    const total = await recalcTotalTX(tx, item.venta_id);

    const ventaUpdated = await tx.venta.findUnique({
      where: { id: item.venta_id },
      include: { items: true },
    });

    return { updatedItem, ventaUpdated, total };
  });

  await registrarAuditLog({
    empresaId: item.venta.empresa_id,
    usuarioId: scope.usuarioId || null,
    entidad: "VentaItem",
    registroId: itemId,
    accion: "UPDATE",
    detalles: {
      venta_id: item.venta_id,
      before,
      after: updatedInfo.updatedItem,
    },
    ip,
    userAgent,
  });

  return reply.send(updatedInfo.ventaUpdated);
}

export async function deleteItem(request, reply) {
  const scope = resolveScope(request);
  const { itemId } = request.params;

  const item = await prisma.ventaItem.findFirst({
    where: { id: itemId },
    include: { venta: true },
  });
  if (!item) return httpError(reply, 404, "Ítem no encontrado");
  if (!scope.isMaster && item.venta.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Fuera de tu empresa");

  const { ip, userAgent } = getRequestMeta(request);

  const ventaUpdated = await prisma.$transaction(async (tx) => {
    await tx.ventaItem.delete({ where: { id: itemId } });
    await recalcTotalTX(tx, item.venta_id);

    return tx.venta.findUnique({
      where: { id: item.venta_id },
      include: { items: true },
    });
  });

  await registrarAuditLog({
    empresaId: item.venta.empresa_id,
    usuarioId: scope.usuarioId || null,
    entidad: "VentaItem",
    registroId: itemId,
    accion: "DELETE",
    detalles: {
      venta_id: item.venta_id,
      item,
    },
    ip,
    userAgent,
  });

  return reply.send(ventaUpdated);
}
