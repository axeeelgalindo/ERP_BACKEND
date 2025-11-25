import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";

const prisma = new PrismaClient();
const PAGE = 1, SIZE = 20;

/* LISTAR */
export async function listProveedores(request, reply) {
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
        { nombre:   { contains: q, mode: "insensitive" } },
        { rut:      { contains: q, mode: "insensitive" } },
        { correo:   { contains: q, mode: "insensitive" } },
        { telefono: { contains: q, mode: "insensitive" } },
        { notas:    { contains: q, mode: "insensitive" } },
      ]
    } : {}),
    ...(includeDeleted ? {} : { eliminado: false }),
  };

  const [total, data] = await Promise.all([
    prisma.proveedor.count({ where }),
    prisma.proveedor.findMany({
      where,
      orderBy: [{ creado_en: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return reply.send({ total, page, pageSize, data });
}

/* OBTENER */
export async function getProveedor(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.proveedor.findFirst({
    where: { id, empresa_id: scope.isMaster ? undefined : scope.empresaId },
    include: { compras: { select: { id: true, total: true, estado: true } } },
  });
  if (!row) return httpError(reply, 404, "Proveedor no encontrado");
  return reply.send(row);
}

/* CREAR */
export async function createProveedor(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};
  const empresa_id = scope.isMaster ? (body.empresa_id || scope.empresaId) : scope.empresaId;

  // opcional: si trae correo, validamos que no exista activo en la empresa
  if (body.correo) {
    const exists = await prisma.proveedor.findFirst({
      where: { empresa_id, correo: body.correo, eliminado: false },
      select: { id: true },
    });
    if (exists) return httpError(reply, 409, "Correo ya registrado en la empresa");
  }

  const row = await prisma.proveedor.create({
    data: {
      empresa_id,
      nombre: body.nombre,
      rut: body.rut ?? null,
      correo: body.correo ?? null,
      telefono: body.telefono ?? null,
      notas: body.notas ?? null,
    },
  });

  return reply.code(201).send(row);
}

/* ACTUALIZAR */
export async function updateProveedor(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const data = { ...request.body };

  const prov = await prisma.proveedor.findUnique({ where: { id } });
  if (!prov) return httpError(reply, 404, "Proveedor no encontrado");
  if (!scope.isMaster && prov.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Proveedor fuera de tu empresa");

  if (!scope.isMaster && data.empresa_id) delete data.empresa_id;

  // si cambia correo, revalidar
  if (data.correo && data.correo !== prov.correo) {
    const clash = await prisma.proveedor.findFirst({
      where: {
        empresa_id: scope.isMaster ? (data.empresa_id || prov.empresa_id) : prov.empresa_id,
        correo: data.correo,
        eliminado: false,
      },
      select: { id: true },
    });
    if (clash) return httpError(reply, 409, "Correo ya registrado en la empresa");
  }

  const row = await prisma.proveedor.update({ where: { id }, data });
  return reply.send(row);
}

/* DELETE FÍSICO (protección salvo ?force=true) */
export async function deleteProveedor(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { force } = request.query || {};

  const prov = await prisma.proveedor.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
    include: { _count: { select: { compras: true } } },
  });
  if (!prov) return httpError(reply, 404, "Proveedor no encontrado");

  if (!force && prov._count.compras > 0) {
    return httpError(reply, 409, "Proveedor con compras asociadas. Usa ?force=true para borrado definitivo.");
  }

  await prisma.proveedor.delete({ where: { id } });
  return reply.send({ success: true });
}

/* SOFT-DELETE */
export async function disableProveedor(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const prov = await prisma.proveedor.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
  });
  if (!prov) return httpError(reply, 404, "Proveedor no encontrado");
  if (prov.eliminado) return httpError(reply, 409, "Proveedor ya está eliminado");

  const upd = await prisma.proveedor.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });
  return reply.send({ success: true, proveedor: upd });
}

/* RESTORE */
export async function restoreProveedor(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const prov = await prisma.proveedor.findFirst({
    where: { id, ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }) },
  });
  if (!prov) return httpError(reply, 404, "Proveedor no encontrado");
  if (!prov.eliminado) return httpError(reply, 409, "Proveedor no está eliminado");

  const upd = await prisma.proveedor.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });
  return reply.send({ success: true, proveedor: upd });
}
