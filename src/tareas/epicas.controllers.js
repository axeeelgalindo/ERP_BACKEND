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

const parseDate = (d) => {
  if (!d) return null;
  const s = String(d);
  return new Date(`${s.slice(0, 10)}T12:00:00`);
};

const addDaysInclusive = (date, dias) => {
  return new Date(date.getTime() + (dias - 1) * 24 * 60 * 60 * 1000);
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
      empresa_id: empresaId,
      ...(proyectoId ? { proyecto_id: proyectoId } : {}),
    },
    select: { id: true },
  });

  if (!ep) {
    const err = new Error(
      "Épica inválida (no pertenece a tu empresa o está deshabilitada)"
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

  // Si no hay tareas, reset básico (pero respetar si ya está completada)
  if (!tareas.length) {
    const epicaActual = await tx.epica.findUnique({
      where: { id: epicaId },
      select: { estado: true, avance: true },
    });

    if (epicaActual?.estado === "completada" && epicaActual?.avance === 100) {
      return;
    }

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

  const q = request.query || {};
  const proyectoId = q.proyectoId || q.proyecto_id;
  const destino = q.destino;
  const centro_costo = q.centro_costo;
  const includeDeleted = q.includeDeleted;

  if (!proyectoId && !destino) {
    return httpError(reply, 400, "Falta proyectoId/proyecto_id o destino");
  }

  if (proyectoId) {
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
  }

  const where = {
    empresa_id: scope.empresaId,
    ...(proyectoId ? { proyecto_id: proyectoId, destino: "PROYECTO" } : {}),
    ...(destino ? { destino } : {}),
    ...(centro_costo ? { centro_costo } : {}),
    ...(includeDeleted ? {} : { eliminado: false }),
  };

  const rows = await prisma.epica.findMany({
    where,
    orderBy: [{ creado_en: "desc" }],
    select: {
      id: true,
      proyecto_id: true,
      destino: true,
      centro_costo: true,
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
      responsable_id: true,
      responsable: { include: { usuario: { select: { nombre: true } } } },

      creado_en: true,
      actualizado_en: true,
      eliminado: true,
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
  const {  nombre, descripcion, proyecto_id, es_planificado, responsable_id, destino, centro_costo } = body;

  const dest = destino || "PROYECTO";
  if (dest === "PROYECTO") {
    if (!proyecto_id) return httpError(reply, 400, "Falta proyecto_id");
    
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
  } else {
    if (proyecto_id) return httpError(reply, 400, "proyecto_id debe ser null para destino no-proyecto");
  }

  if (!nombre?.trim())
    return httpError(reply, 400, "El nombre de la épica es obligatorio");

  const { fecha_inicio_plan, dias_plan } = body;
  const fip = parseDate(fecha_inicio_plan);
  const dp = parseInt(dias_plan) || null;
  const ffp = fip && dp ? addDaysInclusive(fip, dp) : null;

  const row = await prisma.epica.create({
    data: {
      empresa_id: scope.empresaId,
      proyecto_id: dest === "PROYECTO" ? proyecto_id : null,
      destino: dest,
      centro_costo: dest === "PROYECTO" ? null : (centro_costo || null),
      nombre: nombre.trim(),
      descripcion: descripcion?.trim() || null,
      estado: "pendiente",
      avance: 0,
      source: "MANUAL",
      es_planificado,
      responsable_id: responsable_id || null,
      fecha_inicio_plan: fip,
      fecha_fin_plan: ffp,
      dias_plan: dp
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

  const row = await prisma.$transaction(async (tx) => {
    const updateData = {
      ...(data.nombre != null ? { nombre: String(data.nombre).trim() } : {}),
      ...(data.descripcion !== undefined
        ? {
            descripcion: data.descripcion
              ? String(data.descripcion).trim()
              : null,
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(data, "responsable_id")
        ? { responsable_id: data.responsable_id || null }
        : {}),
    };

    if (Object.prototype.hasOwnProperty.call(data, "fecha_inicio_real")) {
      updateData.fecha_inicio_real = data.fecha_inicio_real ? new Date(`${String(data.fecha_inicio_real).slice(0, 10)}T12:00:00`) : null;
    }
    if (Object.prototype.hasOwnProperty.call(data, "fecha_fin_real")) {
      updateData.fecha_fin_real = data.fecha_fin_real ? new Date(`${String(data.fecha_fin_real).slice(0, 10)}T12:00:00`) : null;
    }

    // ✅ Sincronizar estado y avance
    if (Object.prototype.hasOwnProperty.call(data, "avance")) {
      let a = Number(data.avance);
      if (Number.isNaN(a)) a = 0;
      a = Math.max(0, Math.min(100, Math.round(a)));
      updateData.avance = a;

      if (a >= 100) updateData.estado = "completada";
      else if (a > 0) updateData.estado = "en_progreso";
      else updateData.estado = "pendiente";
    } else if (Object.prototype.hasOwnProperty.call(data, "estado")) {
      updateData.estado = data.estado;
      if (data.estado === "completada") {
        updateData.avance = 100;
      } else if (data.estado === "pendiente") {
        updateData.avance = 0;
      }
    }

    const updated = await tx.epica.update({
      where: { id },
      data: updateData,
    });

    // ✅ Si se completa la épica, completar todas sus tareas y subtareas
    if (updateData.estado === "completada") {
      // 1. Obtener todas las tareas de esta épica para poder actualizar subtareas por ID
      const tareasActuales = await tx.tarea.findMany({
        where: { epica_id: id, eliminado: false },
        select: { id: true },
      });
      const tareaIds = tareasActuales.map((t) => t.id);

      // 2. Actualizar las tareas
      if (tareaIds.length > 0) {
        await tx.tarea.updateMany({
          where: { id: { in: tareaIds } },
          data: { estado: "completada", avance: 100 },
        });

        // 3. Actualizar todas las subtareas de esas tareas
        await tx.tareaDetalle.updateMany({
          where: {
            tarea_id: { in: tareaIds },
            eliminado: false,
          },
          data: { estado: "completada", avance: 100 },
        });
      }
    }

    return updated;
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

