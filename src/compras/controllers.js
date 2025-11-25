import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";

const prisma = new PrismaClient();
const PAGE = 1, SIZE = 20;

/* ===== Helpers ===== */
function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return ["1", "true", "on", "yes"].includes(v.toLowerCase());
  return false;
}

async function assertEntidadEmpresa(tx, tabla, id, empresaId) {
  // Reutilizable para proyecto/empresa/proveedor/producto
  const map = {
    proyecto: () => tx.proyecto.findFirst({ where: { id, empresa_id: empresaId }, select: { id: true } }),
    proveedor: () => tx.proveedor.findFirst({ where: { id, empresa_id: empresaId }, select: { id: true } }),
    producto:  () => tx.producto.findFirst({ where: { id, empresa_id: empresaId }, select: { id: true } }),
  };
  const q = map[tabla];
  if (!q) return;
  const ok = await q();
  if (!ok) throw Object.assign(new Error(`${tabla} no pertenece a tu empresa`), { statusCode: 403 });
}

function calcTotal(items = []) {
  return items.reduce((acc, it) => acc + Number(it.cantidad || 0) * Number(it.precio_unit || 0), 0);
}

/* ===== LIST ===== */
export async function listCompras(request, reply) {
  const scope = resolveScope(request);
  const {
    q, estado, proveedorId, proyectoId,
    page = PAGE, pageSize = SIZE,
    includeDeleted, empresaId
  } = request.query || {};

  const empresa_id = scope.isMaster ? (empresaId || scope.empresaId) : scope.empresaId;

  const where = {
    empresa_id,
    ...(estado ? { estado } : {}),
    ...(proveedorId ? { proveedor_id: proveedorId } : {}),
    ...(proyectoId ? { proyecto_id: proyectoId } : {}),
    ...(q ? {
      OR: [
        { numero: { contains: q, mode: "insensitive" } },
        { proveedor: { nombre: { contains: q, mode: "insensitive" } } },
        { proyecto:  { nombre: { contains: q, mode: "insensitive" } } },
      ]
    } : {}),
    ...(includeDeleted ? {} : { eliminado: false }),
  };

  const [total, data] = await Promise.all([
    prisma.compra.count({ where }),
    prisma.compra.findMany({
      where,
      orderBy: [{ creada_en: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        proveedor: { select: { id: true, nombre: true } },
        proyecto:  { select: { id: true, nombre: true } },
        items: true,
      },
    }),
  ]);

  return reply.send({ total, page, pageSize, data });
}

/* ===== GET ===== */
export async function getCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.compra.findFirst({
    where: { id, empresa_id: scope.isMaster ? undefined : scope.empresaId },
    include: {
      proveedor: true,
      proyecto: true,
      items: { include: { producto: true } },
    },
  });
  if (!row) return httpError(reply, 404, "Compra no encontrada");
  return reply.send(row);
}

/* ===== CREATE ===== */
export async function createCompra(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};
  const empresa_id = scope.isMaster ? (body.empresa_id || scope.empresaId) : scope.empresaId;

  // Validar pertenencia de proyecto y proveedor
  await prisma.$transaction(async (tx) => {
    await assertEntidadEmpresa(tx, "proyecto",  body.proyecto_id,  empresa_id);
    await assertEntidadEmpresa(tx, "proveedor", body.proveedor_id, empresa_id);

    if (Array.isArray(body.items)) {
      // Validar productos
      for (const it of body.items) {
        if (it.producto_id) {
          await assertEntidadEmpresa(tx, "producto", it.producto_id, empresa_id);
        }
      }
    }
  });

  const items = Array.isArray(body.items) ? body.items : [];
  const total = body.total != null ? Number(body.total) : calcTotal(items);

  const row = await prisma.compra.create({
    data: {
      empresa_id,
      proyecto_id: body.proyecto_id,
      proveedor_id: body.proveedor_id,
      numero: body.numero,                // único
      estado: body.estado ?? "pendiente",
      total,
      items: {
        create: items.map((it) => ({
          producto_id: it.producto_id ?? null,
          cantidad: Number(it.cantidad || 0),
          precio_unit: Number(it.precio_unit || 0),
          total: Number((it.cantidad || 0) * (it.precio_unit || 0)),
        })),
      },
    },
    include: { items: true },
  });

  return reply.code(201).send(row);
}

/* ===== UPDATE ===== */
export async function updateCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const data = { ...request.body };

  const exists = await prisma.compra.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!exists) return httpError(reply, 404, "Compra no encontrada");
  if (!scope.isMaster && exists.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Compra fuera de tu empresa");

  // Si se cambia proyecto/proveedor, validar pertenencia
  await prisma.$transaction(async (tx) => {
    const empresa_id = exists.empresa_id;
    if (data.proyecto_id && data.proyecto_id !== exists.proyecto_id) {
      await assertEntidadEmpresa(tx, "proyecto", data.proyecto_id, empresa_id);
    }
    if (data.proveedor_id && data.proveedor_id !== exists.proveedor_id) {
      await assertEntidadEmpresa(tx, "proveedor", data.proveedor_id, empresa_id);
    }

    // Items: estrategia de reemplazo completo (más simple)
    let items = Array.isArray(data.items) ? data.items : null;
    if (items) {
      // validar productos
      for (const it of items) {
        if (it.producto_id) {
          await assertEntidadEmpresa(tx, "producto", it.producto_id, empresa_id);
        }
      }
      // recalcular total si no viene
      data.total = data.total != null ? Number(data.total) : calcTotal(items);

      await tx.compraItem.deleteMany({ where: { compra_id: id } });
      await tx.compraItem.createMany({
        data: items.map((it) => ({
          compra_id: id,
          producto_id: it.producto_id ?? null,
          cantidad: Number(it.cantidad || 0),
          precio_unit: Number(it.precio_unit || 0),
          total: Number((it.cantidad || 0) * (it.precio_unit || 0)),
        })),
      });
      delete data.items;
    } else if (data.total != null) {
      data.total = Number(data.total);
    }

    await tx.compra.update({
      where: { id },
      data,
    });
  });

  const updated = await prisma.compra.findUnique({
    where: { id },
    include: { items: true },
  });
  return reply.send(updated);
}

/* ===== DELETE (físico) ===== */
export async function deleteCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { force } = request.query || {};

  const row = await prisma.compra.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
    select: { id: true, estado: true },
  });
  if (!row) return httpError(reply, 404, "Compra no encontrada");

  // Protección: si está en estado "pendiente" permitimos borrar, si no, requiere force
  if (!toBool(force) && row.estado !== "pendiente") {
    return httpError(reply, 409, "Compra no está pendiente. Usa ?force=true para borrado definitivo.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.compraItem.deleteMany({ where: { compra_id: id } });
    await tx.compra.delete({ where: { id } });
  });

  return reply.send({ success: true });
}

/* ===== SOFT-DELETE ===== */
export async function disableCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.compra.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
  });
  if (!row) return httpError(reply, 404, "Compra no encontrada");
  if (row.eliminado) return httpError(reply, 409, "Compra ya está eliminada");

  const upd = await prisma.compra.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });
  return reply.send({ success: true, compra: upd });
}

/* ===== RESTORE ===== */
export async function restoreCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.compra.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
  });
  if (!row) return httpError(reply, 404, "Compra no encontrada");
  if (!row.eliminado) return httpError(reply, 409, "Compra no está eliminada");

  const upd = await prisma.compra.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });
  return reply.send({ success: true, compra: upd });
}
