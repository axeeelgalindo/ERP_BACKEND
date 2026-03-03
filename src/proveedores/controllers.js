// src/proveedor/controllers.js
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";

const prisma = new PrismaClient();

const trimOrNull = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const requiredTrim = (v) => {
  const s = String(v ?? "").trim();
  return s;
};

/**
 * LISTAR (alfabético por nombre)
 * query:
 *  - q: busca por nombre/rut/correo
 *  - includeDeleted: "true" | "false"
 */
export async function listProveedores(request, reply) {
  const scope = resolveScope(request);
  const { q = "", includeDeleted = "false" } = request.query || {};

  const includeDel = String(includeDeleted) === "true";
  const search = String(q || "").trim();

  const where = {
    ...(includeDel ? {} : { eliminado: false }),
    empresa_id: scope.empresaId,
    ...(search
      ? {
          OR: [
            { nombre: { contains: search, mode: "insensitive" } },
            { rut: { contains: search, mode: "insensitive" } },
            { correo: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const rows = await prisma.proveedor.findMany({
    where,
    orderBy: [{ nombre: "asc" }], // ✅ ALFABÉTICO
  });

  return reply.send({ ok: true, rows });
}

/**
 * OBTENER 1
 */
export async function getProveedor(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.proveedor.findFirst({
    where: {
      id,
      empresa_id: scope.empresaId,
      eliminado: false,
    },
  });

  if (!row) throw httpError(404, "Proveedor no encontrado");

  return reply.send({ ok: true, row });
}

/**
 * CREAR
 */
export async function createProveedor(request, reply) {
  const scope = resolveScope(request);

  const nombre = requiredTrim(request.body?.nombre);
  const rut = trimOrNull(request.body?.rut);
  const correo = trimOrNull(request.body?.correo);
  const telefono = trimOrNull(request.body?.telefono);
  const notas = trimOrNull(request.body?.notas);

  if (!nombre) throw httpError(400, "nombre es obligatorio");

  // Evitar choque del @@unique([correo, eliminado]) cuando correo viene informado
  if (correo) {
    const exists = await prisma.proveedor.findFirst({
      where: {
        empresa_id: scope.empresaId,
        correo,
        eliminado: false,
      },
      select: { id: true },
    });
    if (exists) throw httpError(409, "Ya existe un proveedor activo con ese correo");
  }

  const row = await prisma.proveedor.create({
    data: {
      empresa_id: scope.empresaId,
      nombre,
      rut,
      correo,
      telefono,
      notas,
    },
  });

  return reply.code(201).send({ ok: true, row });
}

/**
 * ACTUALIZAR
 */
export async function updateProveedor(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const current = await prisma.proveedor.findFirst({
    where: { id, empresa_id: scope.empresaId, eliminado: false },
    select: { id: true, correo: true },
  });
  if (!current) throw httpError(404, "Proveedor no encontrado");

  const nombre = request.body?.nombre != null ? requiredTrim(request.body?.nombre) : undefined;
  const rut = request.body?.rut != null ? trimOrNull(request.body?.rut) : undefined;
  const correo = request.body?.correo != null ? trimOrNull(request.body?.correo) : undefined;
  const telefono = request.body?.telefono != null ? trimOrNull(request.body?.telefono) : undefined;
  const notas = request.body?.notas != null ? trimOrNull(request.body?.notas) : undefined;

  if (nombre !== undefined && !nombre) throw httpError(400, "nombre no puede quedar vacío");

  // Si cambia correo, validar duplicado (solo activos)
  if (correo !== undefined && correo && correo !== current.correo) {
    const exists = await prisma.proveedor.findFirst({
      where: {
        empresa_id: scope.empresaId,
        correo,
        eliminado: false,
        NOT: { id },
      },
      select: { id: true },
    });
    if (exists) throw httpError(409, "Ya existe un proveedor activo con ese correo");
  }

  const row = await prisma.proveedor.update({
    where: { id },
    data: {
      ...(nombre !== undefined ? { nombre } : {}),
      ...(rut !== undefined ? { rut } : {}),
      ...(correo !== undefined ? { correo } : {}),
      ...(telefono !== undefined ? { telefono } : {}),
      ...(notas !== undefined ? { notas } : {}),
    },
  });

  return reply.send({ ok: true, row });
}

/**
 * ELIMINAR (soft delete)
 */
export async function deleteProveedor(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const current = await prisma.proveedor.findFirst({
    where: { id, empresa_id: scope.empresaId, eliminado: false },
    select: { id: true },
  });
  if (!current) throw httpError(404, "Proveedor no encontrado");

  await prisma.proveedor.update({
    where: { id },
    data: {
      eliminado: true,
      eliminado_en: new Date(),
    },
  });

  return reply.code(204).send();
}