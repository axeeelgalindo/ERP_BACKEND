import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";

const prisma = new PrismaClient();

/* ========== LISTAR REQUISITOS DE UNA TAREA ========== */
export async function listTareaRequisitos(request, reply) {
  const scope = resolveScope(request);
  const { tareaId } = request.params;

  const rows = await prisma.tareaRequisito.findMany({
    where: {
      tarea_id: tareaId,
      tarea: {
        empresa_id: scope.empresaId,
      },
    },
    orderBy: { creado_en: "asc" },
    include: {
      predecesora: {
        select: { id: true, nombre: true }
      }
    }
  });

  return reply.send({ ok: true, rows });
}

/* ========== CREAR REQUISITO ========== */
export async function createTareaRequisito(request, reply) {
  const scope = resolveScope(request);
  const { tarea_id, nombre, predecesora_id } = request.body || {};

  if (!tarea_id || !nombre) {
    return reply.status(400).send({ ok: false, message: "Faltan datos requeridos (tarea_id, nombre)" });
  }

  // Verificar que la tarea pertenece a la empresa
  const tarea = await prisma.tarea.findFirst({
    where: {
      id: tarea_id,
      empresa_id: scope.empresaId,
    },
  });

  if (!tarea) {
    return reply.status(403).send({ ok: false, message: "Tarea no válida o fuera de alcance" });
  }

  const row = await prisma.tareaRequisito.create({
    data: {
      tarea_id,
      nombre,
      predecesora_id: predecesora_id || null,
      completado: false
    },
    include: {
      predecesora: {
        select: { id: true, nombre: true }
      }
    }
  });

  return reply.status(201).send({ ok: true, row });
}

/* ========== ACTUALIZAR REQUISITO ========== */
export async function updateTareaRequisito(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { nombre, completado, predecesora_id } = request.body || {};

  const req = await prisma.tareaRequisito.findFirst({
    where: {
      id,
      tarea: {
        empresa_id: scope.empresaId,
      },
    },
  });

  if (!req) {
    return reply.status(404).send({ ok: false, message: "Requisito no encontrado o fuera de alcance" });
  }

  const data = {};
  if (nombre !== undefined) data.nombre = nombre;
  if (completado !== undefined) data.completado = completado;
  if (predecesora_id !== undefined) data.predecesora_id = predecesora_id || null;

  const row = await prisma.tareaRequisito.update({
    where: { id },
    data,
    include: {
      predecesora: {
        select: { id: true, nombre: true }
      }
    }
  });

  return reply.send({ ok: true, row });
}

/* ========== ELIMINAR REQUISITO ========== */
export async function deleteTareaRequisito(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const req = await prisma.tareaRequisito.findFirst({
    where: {
      id,
      tarea: {
        empresa_id: scope.empresaId,
      },
    },
  });

  if (!req) {
    return reply.status(404).send({ ok: false, message: "Requisito no encontrado o fuera de alcance" });
  }

  await prisma.tareaRequisito.delete({
    where: { id }
  });

  return reply.send({ ok: true, message: "Requisito eliminado" });
}
