import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
const prisma = new PrismaClient();

const PAGE = 1, SIZE = 20;

export async function listClientes(request, reply) {
  const scope = resolveScope(request);
  const { q, page = PAGE, pageSize = SIZE, includeDeleted } = request.query || {};

  const where = {
    empresa_id: scope.empresaId,
    ...(q ? {
      OR: [
        { nombre: { contains: q, mode: "insensitive" } },
        { correo: { contains: q, mode: "insensitive" } },
        { rut:    { contains: q, mode: "insensitive" } },
      ]
    } : {}),
    ...(includeDeleted ? {} : { eliminado: false }),
  };

  const [total, data] = await Promise.all([
    prisma.cliente.count({ where }),
    prisma.cliente.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { creado_en: "desc" },
    }),
  ]);

  return reply.send({ total, data, page, pageSize });
}

export async function getCliente(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.cliente.findFirst({
    where: { id, empresa_id: scope.empresaId },
    include: {
      cotizaciones: true,
      ventas: true,
    },
  });
  if (!row) return reply.notFound("Cliente no encontrado");
  return reply.send(row);
}

export async function createCliente(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};

  const row = await prisma.cliente.create({
    data: {
      empresa_id: scope.empresaId,
      nombre: body.nombre,
      rut: body.rut ?? null,
      correo: body.correo ?? null,
      telefono: body.telefono ?? null,
      notas: body.notas ?? null,
    },
  });
  return reply.code(201).send(row);
}

export async function updateCliente(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const body = request.body || {};

  const exists = await prisma.cliente.findFirst({
    where: { id, empresa_id: scope.empresaId },
    select: { id: true },
  });
  if (!exists) return reply.notFound("Cliente no encontrado");

  const row = await prisma.cliente.update({
    where: { id },
    data: {
      nombre: body.nombre ?? undefined,
      rut: body.rut ?? undefined,
      correo: body.correo ?? undefined,
      telefono: body.telefono ?? undefined,
      notas: body.notas ?? undefined,
    },
  });
  return reply.send(row);
}

/** Soft delete */
export async function disableCliente(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const exists = await prisma.cliente.findFirst({
    where: { id, empresa_id: scope.empresaId, eliminado: false },
    select: { id: true },
  });
  if (!exists) return reply.notFound("Cliente no encontrado o ya eliminado");

  await prisma.cliente.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });
  return reply.send({ success: true });
}

/** Restore */
export async function restoreCliente(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const exists = await prisma.cliente.findFirst({
    where: { id, empresa_id: scope.empresaId, eliminado: true },
    select: { id: true },
  });
  if (!exists) return reply.notFound("Cliente no está eliminado o no existe");

  await prisma.cliente.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });
  return reply.send({ success: true });
}

/** Delete físico (solo si no tiene movimientos, o con force) */
export async function deleteCliente(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { force } = request.query || {};

  const c = await prisma.cliente.findFirst({
    where: { id, empresa_id: scope.empresaId },
    include: {
      _count: { select: { cotizaciones: true, ventas: true } },
    },
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  if (!force && (c._count.cotizaciones > 0 || c._count.ventas > 0)) {
    return reply.conflict("Cliente con movimientos. Usa ?force=true para borrado definitivo.");
  }

  await prisma.cliente.delete({ where: { id } });
  return reply.send({ success: true });
}
