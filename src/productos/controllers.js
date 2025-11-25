import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";

const prisma = new PrismaClient();
const PAGE = 1, SIZE = 20;

/* LISTAR */
export async function listProductos(request, reply) {
  const scope = resolveScope(request);
  const {
    q, page = PAGE, pageSize = SIZE,
    includeDeleted, empresaId
  } = request.query || {};

  const empresa_id = scope.isMaster ? (empresaId || scope.empresaId) : scope.empresaId;

  const where = {
    empresa_id,
    ...(q ? {
      OR: [
        { nombre: { contains: q, mode: "insensitive" } },
        { sku:    { contains: q, mode: "insensitive" } },
      ]
    } : {}),
    ...(includeDeleted ? {} : { eliminado: false }),
  };

  const [total, data] = await Promise.all([
    prisma.producto.count({ where }),
    prisma.producto.findMany({
      where,
      orderBy: [{ creado_en: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return reply.send({ total, page, pageSize, data });
}

/* OBTENER */
export async function getProducto(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.producto.findFirst({
    where: {
      id,
      empresa_id: scope.isMaster ? undefined : scope.empresaId
    },
  });
  if (!row) return httpError(reply, 404, "Producto no encontrado");
  return reply.send(row);
}

/* CREAR */
export async function createProducto(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};

  const empresa_id = scope.isMaster ? (body.empresa_id || scope.empresaId) : scope.empresaId;

  // SKU opcional pero si viene, validamos unicidad por empresa y eliminado=false
  if (body.sku) {
    const exists = await prisma.producto.findFirst({
      where: { empresa_id, sku: body.sku, eliminado: false },
      select: { id: true },
    });
    if (exists) return httpError(reply, 409, "SKU ya existe en la empresa");
  }

  const row = await prisma.producto.create({
    data: {
      empresa_id,
      nombre: body.nombre,
      sku: body.sku ?? null,
      precio: body.precio,
      stock: body.stock ?? 0,
    },
  });

  return reply.code(201).send(row);
}

/* ACTUALIZAR */
export async function updateProducto(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const data = { ...request.body };

  const prod = await prisma.producto.findUnique({ where: { id } });
  if (!prod) return httpError(reply, 404, "Producto no encontrado");
  if (!scope.isMaster && prod.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Producto fuera de tu empresa");

  if (!scope.isMaster && data.empresa_id) delete data.empresa_id;

  // Si cambia SKU, revalidar
  if (data.sku && data.sku !== prod.sku) {
    const clash = await prisma.producto.findFirst({
      where: {
        empresa_id: scope.isMaster ? (data.empresa_id || prod.empresa_id) : prod.empresa_id,
        sku: data.sku,
        eliminado: false,
      },
      select: { id: true },
    });
    if (clash) return httpError(reply, 409, "SKU ya existe en la empresa");
  }

  const row = await prisma.producto.update({ where: { id }, data });
  return reply.send(row);
}

/* DELETE FÍSICO (protección salvo ?force=true) */
export async function deleteProducto(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { force } = request.query || {};

  const prod = await prisma.producto.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
    include: {
      _count: { select: { compras: true, ventas: true, cotizaciones: true } },
    },
  });
  if (!prod) return httpError(reply, 404, "Producto no encontrado");

  const hasMov = (prod._count.compras + prod._count.ventas + prod._count.cotizaciones) > 0;
  if (!force && hasMov) {
    return httpError(reply, 409, "Producto con movimientos. Usa ?force=true para borrado definitivo.");
  }

  await prisma.producto.delete({ where: { id } });
  return reply.send({ success: true });
}

/* SOFT-DELETE */
export async function disableProducto(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const prod = await prisma.producto.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
  });
  if (!prod) return httpError(reply, 404, "Producto no encontrado");
  if (prod.eliminado) return httpError(reply, 409, "Producto ya está eliminado");

  const upd = await prisma.producto.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });
  return reply.send({ success: true, producto: upd });
}

/* RESTORE */
export async function restoreProducto(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const prod = await prisma.producto.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
  });
  if (!prod) return httpError(reply, 404, "Producto no encontrado");
  if (!prod.eliminado) return httpError(reply, 409, "Producto no está eliminado");

  const upd = await prisma.producto.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });
  return reply.send({ success: true, producto: upd });
}
