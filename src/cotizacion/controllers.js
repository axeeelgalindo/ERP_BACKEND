// src/modules/cotizaciones/controllers.js
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";

const prisma = new PrismaClient();
const PAGE = 1;
const SIZE = 20;

/* ===== Helpers ===== */
const toBool = (v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string")
    return ["1", "true", "on", "yes"].includes(v.toLowerCase());
  return false;
};

const ESTADOS = ["borrador", "enviada", "aceptada", "rechazada", "anulada"];

export async function getNextNumeroCotizacion(request, reply) {
  // Si quisieras filtrar por empresa, puedes usar resolveScope,
  // pero como el campo numero es autoincrement global,
  // mejor usar el máximo global para que coincida.
  // const scope = resolveScope(request);

  const last = await prisma.cotizacion.findFirst({
    where: { eliminado: false },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });

  const nextNumero = (last?.numero ?? 0) + 1;

  return reply.send({ nextNumero });
}

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
  }[tabla];
  const ok = await by();
  if (!ok)
    throw Object.assign(new Error(`${tabla} no pertenece a tu empresa`), {
      statusCode: 403,
    });
}

function calcTotal(items = []) {
  return items.reduce(
    (a, it) => a + Number(it.cantidad || 0) * Number(it.precio_unit || 0),
    0
  );
}

async function recalcTotalTX(tx, cotizacionId) {
  const items = await tx.cotizacionItem.findMany({
    where: { cotizacion_id: cotizacionId },
    select: { cantidad: true, precio_unit: true },
  });
  const total = calcTotal(items);
  await tx.cotizacion.update({ where: { id: cotizacionId }, data: { total } });
  return total;
}

/* ===== LIST ===== */
export async function listCotizaciones(request, reply) {
  const scope = resolveScope(request);
  const {
    q,
    estado,
    clienteId,
    proyectoId,
    desde,
    hasta,
    page = PAGE,
    pageSize = SIZE,
    includeDeleted,
    empresaId,
  } = request.query || {};

  const empresa_id = scope.isMaster
    ? empresaId || scope.empresaId
    : scope.empresaId;

  // normalizar page/pageSize (vienen como string)
  const _page = Number(page) > 0 ? Number(page) : PAGE;
  const _pageSize = Number(pageSize) > 0 ? Number(pageSize) : SIZE;

  // rango de fechas en creada_en
  let fechaFilter = {};
  if (desde || hasta) {
    const rango = {};
    if (desde) {
      // YYYY-MM-DD
      rango.gte = new Date(desde);
    }
    if (hasta) {
      const end = new Date(hasta);
      // incluir todo el día "hasta"
      end.setHours(23, 59, 59, 999);
      rango.lte = end;
    }
    fechaFilter = { creada_en: rango };
  }

  // filtro de búsqueda (q)
  let searchFilter = {};
  if (q) {
    const or = [
      {
        cliente: { nombre: { contains: q, mode: "insensitive" } },
      },
      {
        proyecto: { nombre: { contains: q, mode: "insensitive" } },
      },
    ];

    const asNumber = Number(q);
    if (!Number.isNaN(asNumber)) {
      // si q es numérico, también buscamos por numero exacto
      or.unshift({ numero: asNumber });
    }

    searchFilter = { OR: or };
  }

  const where = {
    empresa_id,
    ...(estado ? { estado } : {}),
    ...(clienteId ? { cliente_id: clienteId } : {}),
    ...(proyectoId ? { proyecto_id: proyectoId } : {}),
    ...(includeDeleted ? {} : { eliminado: false }),
    ...fechaFilter,
    ...searchFilter,
  };

  const [total, data] = await Promise.all([
    prisma.cotizacion.count({ where }),
    prisma.cotizacion.findMany({
      where,
      orderBy: [{ creada_en: "desc" }],
      skip: (_page - 1) * _pageSize,
      take: _pageSize,
      include: {
        cliente: { select: { id: true, nombre: true } },
        proyecto: { select: { id: true, nombre: true } },
        items: true,
      },
    }),
  ]);

  return reply.send({ total, page: _page, pageSize: _pageSize, data });
}

/* ===== GET ===== */
export async function getCotizacion(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.cotizacion.findFirst({
    where: { id, empresa_id: scope.isMaster ? undefined : scope.empresaId },
    include: {
      cliente: true,
      proyecto: true,
      items: { include: { producto: true } },
    },
  });
  if (!row) return httpError(reply, 404, "Cotización no encontrada");
  return reply.send(row);
}

/* ===== CREATE (TX + total backend) ===== */
export async function createCotizacion(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};
  const empresa_id = scope.isMaster
    ? body.empresa_id || scope.empresaId
    : scope.empresaId;

  const items = Array.isArray(body.items) ? body.items : [];
  const estado =
    body.estado && ESTADOS.includes(body.estado)
      ? body.estado
      : "borrador";

  const row = await prisma.$transaction(async (tx) => {
    await assertEntidadEmpresa(tx, "proyecto", body.proyecto_id, empresa_id);
    await assertEntidadEmpresa(tx, "cliente", body.cliente_id, empresa_id);
    for (const it of items) {
      if (it.producto_id) {
        await assertEntidadEmpresa(tx, "producto", it.producto_id, empresa_id);
      }
    }

    // numero lo genera la BD (Int autoincrement)
    const created = await tx.cotizacion.create({
      data: {
        empresa_id,
        proyecto_id: body.proyecto_id,
        cliente_id: body.cliente_id,
        estado,
        total: 0,
        items: {
          create: items.map((it) => ({
            producto_id: it.producto_id ?? null,
            cantidad: Number(it.cantidad || 0),
            precio_unit: Number(it.precio_unit || 0),
            total: Number(
              (it.cantidad || 0) * (it.precio_unit || 0)
            ),
          })),
        },
      },
    });

    const total = await recalcTotalTX(tx, created.id);
    return { ...created, total };
  });

  const withItems = await prisma.cotizacion.findUnique({
    where: { id: row.id },
    include: { items: true, cliente: true, proyecto: true },
  });

  return reply.code(201).send(withItems);
}

/* ===== UPDATE (TX + total backend) ===== */
export async function updateCotizacion(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const data = { ...request.body };
  if (data.total != null) delete data.total; // siempre backend
  // tampoco aceptamos "numero" por si acaso
  if (data.numero != null) delete data.numero;

  const exists = await prisma.cotizacion.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!exists) return httpError(reply, 404, "Cotización no encontrada");
  if (!scope.isMaster && exists.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Cotización fuera de tu empresa");

  const updated = await prisma.$transaction(async (tx) => {
    const empresa_id = exists.empresa_id;

    // validar cambios de FK
    if (data.proyecto_id && data.proyecto_id !== exists.proyecto_id)
      await assertEntidadEmpresa(
        tx,
        "proyecto",
        data.proyecto_id,
        empresa_id
      );
    if (data.cliente_id && data.cliente_id !== exists.cliente_id)
      await assertEntidadEmpresa(
        tx,
        "cliente",
        data.cliente_id,
        empresa_id
      );

    // normalizar estado si viene
    if (data.estado && !ESTADOS.includes(data.estado)) {
      throw Object.assign(new Error("Estado inválido"), {
        statusCode: 400,
      });
    }

    // si vienen items, los reemplazamos y recalculamos total
    const incomingItems = Array.isArray(data.items) ? data.items : null;
    if (incomingItems) {
      for (const it of incomingItems) {
        if (it.producto_id)
          await assertEntidadEmpresa(
            tx,
            "producto",
            it.producto_id,
            empresa_id
          );
      }

      await tx.cotizacionItem.deleteMany({ where: { cotizacion_id: id } });
      if (incomingItems.length) {
        await tx.cotizacionItem.createMany({
          data: incomingItems.map((it) => ({
            cotizacion_id: id,
            producto_id: it.producto_id ?? null,
            cantidad: Number(it.cantidad || 0),
            precio_unit: Number(it.precio_unit || 0),
            total: Number(
              (it.cantidad || 0) * (it.precio_unit || 0)
            ),
          })),
        });
      }
      delete data.items;
    }

    await tx.cotizacion.update({ where: { id }, data });
    await recalcTotalTX(tx, id);

    return tx.cotizacion.findUnique({
      where: { id },
      include: { items: true, cliente: true, proyecto: true },
    });
  });

  return reply.send(updated);
}

/* ===== DELETE (físico, con force) ===== */
export async function deleteCotizacion(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { force } = request.query || {};

  const row = await prisma.cotizacion.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
    select: { id: true, estado: true },
  });
  if (!row) return httpError(reply, 404, "Cotización no encontrada");

  if (!toBool(force) && row.estado !== "borrador") {
    return httpError(
      reply,
      409,
      "Solo cotizaciones en borrador. Usa ?force=true para borrar."
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.cotizacionItem.deleteMany({ where: { cotizacion_id: id } });
    await tx.cotizacion.delete({ where: { id } });
  });

  return reply.send({ success: true });
}

/* ===== SOFT-DELETE / RESTORE ===== */
export async function disableCotizacion(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.cotizacion.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
  });
  if (!row) return httpError(reply, 404, "Cotización no encontrada");
  if (row.eliminado)
    return httpError(reply, 409, "Cotización ya está eliminada");

  const upd = await prisma.cotizacion.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });
  return reply.send({ success: true, cotizacion: upd });
}

export async function restoreCotizacion(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.cotizacion.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
  });
  if (!row) return httpError(reply, 404, "Cotización no encontrada");
  if (!row.eliminado)
    return httpError(reply, 409, "Cotización no está eliminada");

  const upd = await prisma.cotizacion.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });
  return reply.send({ success: true, cotizacion: upd });
}

/* ===== PATCH ESTADO ===== */
export async function setEstadoCotizacion(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { estado } = request.body || {};
  if (!ESTADOS.includes(estado))
    return httpError(reply, 400, "Estado inválido");

  const exists = await prisma.cotizacion.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
    select: { id: true },
  });
  if (!exists) return httpError(reply, 404, "Cotización no encontrada");

  const row = await prisma.cotizacion.update({
    where: { id },
    data: { estado },
  });
  return reply.send({ ok: true, row });
}

/* ===== ÍTEMS: add / update / delete (siempre recalcular) ===== */
export async function addItem(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params; // cotizacionId
  const body = request.body || {};

  const cot = await prisma.cotizacion.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
    select: { id: true, empresa_id: true },
  });
  if (!cot) return httpError(reply, 404, "Cotización no encontrada");

  const result = await prisma.$transaction(async (tx) => {
    if (body.producto_id) {
      await assertEntidadEmpresa(
        tx,
        "producto",
        body.producto_id,
        cot.empresa_id
      );
    }
    await tx.cotizacionItem.create({
      data: {
        cotizacion_id: id,
        producto_id: body.producto_id ?? null,
        cantidad: Number(body.cantidad || 0),
        precio_unit: Number(body.precio_unit || 0),
        total: Number(
          (body.cantidad || 0) * (body.precio_unit || 0)
        ),
      },
    });
    await recalcTotalTX(tx, id);

    return tx.cotizacion.findUnique({
      where: { id },
      include: { items: true },
    });
  });

  return reply.code(201).send(result);
}

export async function updateItem(request, reply) {
  const scope = resolveScope(request);
  const { itemId } = request.params;
  const body = request.body || {};

  const item = await prisma.cotizacionItem.findFirst({
    where: { id: itemId },
    include: { cotizacion: true },
  });
  if (!item) return httpError(reply, 404, "Ítem no encontrado");
  if (!scope.isMaster && item.cotizacion.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Fuera de tu empresa");

  const updated = await prisma.$transaction(async (tx) => {
    if (body.producto_id) {
      await assertEntidadEmpresa(
        tx,
        "producto",
        body.producto_id,
        item.cotizacion.empresa_id
      );
    }
    await tx.cotizacionItem.update({
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
    await recalcTotalTX(tx, item.cotizacion_id);

    return tx.cotizacion.findUnique({
      where: { id: item.cotizacion_id },
      include: { items: true },
    });
  });

  return reply.send(updated);
}

export async function deleteItem(request, reply) {
  const scope = resolveScope(request);
  const { itemId } = request.params;

  const item = await prisma.cotizacionItem.findFirst({
    where: { id: itemId },
    include: { cotizacion: true },
  });
  if (!item) return httpError(reply, 404, "Ítem no encontrado");
  if (!scope.isMaster && item.cotizacion.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Fuera de tu empresa");

  const updated = await prisma.$transaction(async (tx) => {
    await tx.cotizacionItem.delete({ where: { id: itemId } });
    await recalcTotalTX(tx, item.cotizacion_id);

    return tx.cotizacion.findUnique({
      where: { id: item.cotizacion_id },
      include: { items: true },
    });
  });

  return reply.send(updated);
}
