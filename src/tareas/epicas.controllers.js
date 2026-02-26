// src/tareas/epicas.controllers.js
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const normalizeDay = (d) => {
  const nd = new Date(d);
  nd.setHours(0, 0, 0, 0);
  return nd;
};

const daysBetweenInclusive = (start, end) => {
  if (!start || !end) return null;
  const s = normalizeDay(start);
  const e = normalizeDay(end);
  const diffMs = e.getTime() - s.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return diffDays + 1;
};

export async function assertEpicaInEmpresaYProyecto(
  tx,
  epicaId,
  empresaId,
  proyectoId
) {
  if (!epicaId) {
    const err = new Error("Debes indicar epica_id");
    err.statusCode = 400;
    throw err;
  }

  const ep = await tx.epica.findFirst({
    where: {
      id: epicaId,
      eliminado: false,
      proyecto_id: proyectoId,
      proyecto: {
        empresa_id: empresaId,
        eliminado: false,
        empresa: { eliminado: false },
      },
    },
    select: { id: true },
  });

  if (!ep) {
    const err = new Error(
      "Épica inválida (no pertenece a tu proyecto/empresa o está deshabilitada)"
    );
    err.statusCode = 403;
    throw err;
  }
}

export async function recomputeEpicaFromTareas(tx, epicaId) {
  const tareas = await tx.tarea.findMany({
    where: { epica_id: epicaId, eliminado: false },
    select: {
      avance: true,
      fecha_inicio_plan: true,
      fecha_fin_plan: true,
      fecha_inicio_real: true,
      fecha_fin_real: true,
    },
  });

  // Si no hay tareas, reset básico
  if (!tareas.length) {
    await tx.epica.update({
      where: { id: epicaId },
      data: {
        avance: 0,
        estado: "pendiente",
        fecha_inicio_plan: null,
        fecha_fin_plan: null,
        dias_plan: null,
        fecha_inicio_real: null,
        fecha_fin_real: null,
        dias_reales: null,
      },
    });
    return;
  }

  // Promedio simple de avance
  const avgAvance =
    Math.round(
      tareas.reduce((acc, t) => acc + (Number(t.avance ?? 0) || 0), 0) /
        Math.max(1, tareas.length)
    ) || 0;

  let estado = "pendiente";
  if (avgAvance >= 100) estado = "completada";
  else if (avgAvance > 0) estado = "en_progreso";

  // Rangos plan/real
  let minInicioPlan = null;
  let maxFinPlan = null;

  let minInicioReal = null;
  let maxFinReal = null;

  for (const t of tareas) {
    if (t.fecha_inicio_plan && t.fecha_fin_plan) {
      if (!minInicioPlan || t.fecha_inicio_plan < minInicioPlan)
        minInicioPlan = t.fecha_inicio_plan;
      if (!maxFinPlan || t.fecha_fin_plan > maxFinPlan)
        maxFinPlan = t.fecha_fin_plan;
    }
    if (t.fecha_inicio_real && t.fecha_fin_real) {
      if (!minInicioReal || t.fecha_inicio_real < minInicioReal)
        minInicioReal = t.fecha_inicio_real;
      if (!maxFinReal || t.fecha_fin_real > maxFinReal)
        maxFinReal = t.fecha_fin_real;
    }
  }

  const diasPlan =
    minInicioPlan && maxFinPlan
      ? daysBetweenInclusive(minInicioPlan, maxFinPlan)
      : null;

  const diasReales =
    minInicioReal && maxFinReal
      ? daysBetweenInclusive(minInicioReal, maxFinReal)
      : null;

  await tx.epica.update({
    where: { id: epicaId },
    data: {
      avance: Math.max(0, Math.min(100, avgAvance)),
      estado,

      fecha_inicio_plan: minInicioPlan || null,
      fecha_fin_plan: maxFinPlan || null,
      dias_plan: diasPlan,

      fecha_inicio_real: minInicioReal || null,
      fecha_fin_real: maxFinReal || null,
      dias_reales: diasReales,
    },
  });
}

/* =========================
   CRUD ÉPICAS
========================= */

/* ========== LISTAR ÉPICAS ========== */
export async function listEpicas(request, reply) {
  const scope = resolveScope(request);

  // ✅ acepta ambos formatos
  const q = request.query || {};
  const proyectoId = q.proyectoId || q.proyecto_id;
  const includeDeleted = q.includeDeleted;

  if (!proyectoId) {
    return httpError(reply, 400, "Falta proyectoId/proyecto_id");
  }

  // seguridad: proyecto pertenece a la empresa
  const proyecto = await prisma.proyecto.findFirst({
    where: {
      id: proyectoId,
      empresa_id: scope.empresaId,
      eliminado: false,
      empresa: { eliminado: false },
    },
    select: { id: true },
  });

  if (!proyecto) {
    return httpError(reply, 403, "Proyecto no pertenece a tu empresa");
  }

  const where = {
    proyecto_id: proyectoId,
    ...(includeDeleted ? {} : { eliminado: false }),
    proyecto: {
      empresa_id: scope.empresaId,
      eliminado: false,
      empresa: { eliminado: false },
    },
  };

  const rows = await prisma.epica.findMany({
    where,
    orderBy: [{ creado_en: "desc" }],
    select: {
      id: true,
      proyecto_id: true,
      nombre: true,
      descripcion: true,
      estado: true,
      avance: true,
      orden: true,

      fecha_inicio_plan: true,
      fecha_fin_plan: true,
      dias_plan: true,

      fecha_inicio_real: true,
      fecha_fin_real: true,
      dias_reales: true,

      source: true,
      jira_key: true,
      jira_estado: true,
      jira_sprint: true,
      jira_issue_color: true,

      creado_en: true,
      actualizado_en: true,
      eliminado: true,
      eliminado_en: true,
    },
  });

  return reply.send({ ok: true, rows });
}

export async function getEpica(request, reply) {
  const scope = resolveScope(request);

  // ✅ viene por params: /epicas/:id
  const epicaId = request.params?.id;

  if (!epicaId) return httpError(reply, 400, "Falta epica_id");

  const row = await prisma.epica.findFirst({
    where: {
      id: epicaId,
      eliminado: false,
      proyecto: {
        empresa_id: scope.empresaId,
        eliminado: false,
        empresa: { eliminado: false },
      },
    },
  });

  if (!row) return httpError(reply, 404, "Épica no encontrada");

  return reply.send({ ok: true, row });
}

export async function createEpica(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};
  const {  nombre, descripcion, proyecto_id } = body;

  if (!proyecto_id) return httpError(reply, 400, "Falta proyecto_id");
  if (!nombre?.trim())
    return httpError(reply, 400, "El nombre de la épica es obligatorio");

  const p = await prisma.proyecto.findFirst({
    where: {
      id: proyecto_id,
      empresa_id: scope.empresaId,
     eliminado: false,
      empresa: { eliminado: false },
   },
    select: { id: true },
  });
  if (!p) return httpError(reply, 403, "Proyecto no pertenece a tu empresa");

  const row = await prisma.epica.create({
    data: {
      proyecto_id,
      nombre: nombre.trim(),
      descripcion: descripcion?.trim() || null,
      estado: "pendiente",
      avance: 0,
      source: "MANUAL",
    },
  });

  return reply.code(201).send({ ok: true, row });
}

export async function updateEpica(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const data = request.body || {};

  const current = await prisma.epica.findFirst({
    where: {
      id,
      eliminado: false,
      proyecto: { empresa_id: scope.empresaId },
    },
    select: { id: true },
  });
  if (!current) return httpError(reply, 404, "Épica no encontrada");

  const row = await prisma.epica.update({
    where: { id },
    data: {
      ...(data.nombre != null ? { nombre: String(data.nombre).trim() } : {}),
      ...(data.descripcion !== undefined
        ? {
            descripcion: data.descripcion
              ? String(data.descripcion).trim()
              : null,
          }
        : {}),
    },
  });

  return reply.send({ ok: true, row });
}

export async function disableEpica(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const ep = await prisma.epica.findFirst({
    where: { id, proyecto: { empresa_id: scope.empresaId } },
    select: { id: true, eliminado: true },
  });
  if (!ep) return httpError(reply, 404, "Épica no encontrada");
  if (ep.eliminado) return httpError(reply, 409, "Épica ya está deshabilitada");

  await prisma.epica.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });

  return reply.send({ ok: true });
}

export async function restoreEpica(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const ep = await prisma.epica.findFirst({
    where: { id, proyecto: { empresa_id: scope.empresaId } },
    select: { id: true, eliminado: true },
  });
  if (!ep) return httpError(reply, 404, "Épica no encontrada");
  if (!ep.eliminado) return httpError(reply, 409, "Épica no está deshabilitada");

  await prisma.epica.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });

  return reply.send({ ok: true });
}

