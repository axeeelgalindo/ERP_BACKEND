// src/tareas/detalles.controllers.js
import { valorHoraFromEmpleado } from "../lib/costos.js";
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";

const prisma = new PrismaClient();

const parseDate = (d) => (d ? new Date(d) : null);
const toIntOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : Math.trunc(n);
};
const addDaysInclusive = (date, dias) =>
  new Date(date.getTime() + (dias - 1) * 24 * 60 * 60 * 1000);

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
  // si start === end => diffDays = 0 => 1 día
  return diffDays + 1;
};

/**
 * Verifica que la tarea pertenezca a la empresa del usuario
 */
async function assertTareaInEmpresa(tx, tareaId, empresaId) {
  const t = await tx.tarea.findFirst({
    where: {
      id: tareaId,
      eliminado: false,
      proyecto: {
        empresa_id: empresaId,
        eliminado: false,
        empresa: { eliminado: false },
      },
    },
    select: { id: true },
  });

  if (!t) {
    const err = new Error(
      "Tarea no pertenece a tu empresa o está deshabilitada"
    );
    err.statusCode = 403;
    throw err;
  }
}

/**
 * Verifica que el empleado sea de la empresa del usuario
 */
async function assertEmpleadoInEmpresa(tx, empleadoId, empresaId) {
  const emp = await tx.empleado.findFirst({
    where: {
      id: empleadoId,
      eliminado: false,
      usuario: {
        empresa_id: empresaId,
        eliminado: false,
        empresa: { eliminado: false },
      },
    },
    select: { id: true, sueldo_base: true },
  });

  if (!emp) {
    const err = new Error(
      "Responsable no es empleado de tu empresa o está deshabilitado"
    );
    err.statusCode = 403;
    throw err;
  }

  return emp;
}

/**
 * Recalcula avance/estado de la Tarea en base a sus detalles
 * - avance = % de subtareas en estado "completada"
 * - estado: pendiente / en_progreso / completada
 * - totales: suma de días, horas, costos y responsables distintos
 * - fechas plan y real de la tarea = rango mínimo/máximo de sus subtareas
 * - dias_desviacion = dias_reales (rango real) - dias_plan (rango plan)
 */
async function recomputeTareaFromDetalles(tx, tareaId) {
  const detalles = await tx.tareaDetalle.findMany({
    where: { tarea_id: tareaId, eliminado: false },
    select: {
      estado: true,
      dias_plan: true,
      dias_reales: true,
      horas_plan: true,
      horas_real: true,
      costo_plan: true,
      costo_real: true,
      responsable_id: true,
      // para rango PLAN
      fecha_inicio_plan: true,
      fecha_fin_plan: true,
      // para rango REAL
      fecha_inicio_real: true,
      fecha_fin_real: true,
      // por si quieres usar la desviación individual
      dias_desviacion: true,
    },
  });

  if (!detalles.length) {
    await tx.tarea.update({
      where: { id: tareaId },
      data: {
        avance: 0,
        estado: "pendiente",
        total_dias_plan: null,
        total_dias_reales: null,
        total_horas_plan: null,
        total_horas_reales: null,
        total_costo_plan: null,
        total_costo_real: null,
        total_responsables: 0,
        // no tocamos fechas si no hay subtareas
      },
    });
    return;
  }

  const total = detalles.length;
  const completadas = detalles.filter((d) => d.estado === "completada").length;
  const avance = Math.round((completadas / total) * 100);

  let estado;
  if (avance >= 100) estado = "completada";
  else if (avance > 0) estado = "en_progreso";
  else estado = "pendiente";

  // ====== TOTALES ======
  const total_dias_plan = detalles.reduce(
    (sum, d) => sum + (d.dias_plan || 0),
    0
  );
  const total_dias_reales = detalles.reduce(
    (sum, d) => sum + (d.dias_reales || 0),
    0
  );
  const total_horas_plan = detalles.reduce(
    (sum, d) => sum + (d.horas_plan || 0),
    0
  );
  const total_horas_reales = detalles.reduce(
    (sum, d) => sum + (d.horas_real || 0),
    0
  );
  const total_costo_plan = detalles.reduce(
    (sum, d) => sum + (d.costo_plan || 0),
    0
  );
  const total_costo_real = detalles.reduce(
    (sum, d) => sum + (d.costo_real || 0),
    0
  );

  const responsablesSet = new Set(
    detalles
      .map((d) => d.responsable_id)
      .filter((id) => id && typeof id === "string")
  );
  const total_responsables = responsablesSet.size;

  // ====== RANGO PLAN DEL PADRE ======
  let minInicioPlan = null;
  let maxFinPlan = null;

  // ====== RANGO REAL DEL PADRE ======
  let minInicioReal = null;
  let maxFinReal = null;

  for (const d of detalles) {
    if (d.fecha_inicio_plan && d.fecha_fin_plan) {
      const fi = d.fecha_inicio_plan;
      const ff = d.fecha_fin_plan;

      if (!minInicioPlan || fi < minInicioPlan) minInicioPlan = fi;
      if (!maxFinPlan || ff > maxFinPlan) maxFinPlan = ff;
    }

    if (d.fecha_inicio_real && d.fecha_fin_real) {
      const fir = d.fecha_inicio_real;
      const ffr = d.fecha_fin_real;

      if (!minInicioReal || fir < minInicioReal) minInicioReal = fir;
      if (!maxFinReal || ffr > maxFinReal) maxFinReal = ffr;
    }
  }

  let dias_plan = null;
  if (minInicioPlan && maxFinPlan) {
    dias_plan = daysBetweenInclusive(minInicioPlan, maxFinPlan);
  }

  let dias_reales = null;
  if (minInicioReal && maxFinReal) {
    dias_reales = daysBetweenInclusive(minInicioReal, maxFinReal);
  }

  let dias_desviacion = null;
  if (dias_plan != null && dias_reales != null) {
    dias_desviacion = dias_reales - dias_plan; // positivo = se atrasó
  }

  await tx.tarea.update({
    where: { id: tareaId },
    data: {
      avance,
      estado,
      total_dias_plan,
      total_dias_reales,
      total_horas_plan,
      total_horas_reales,
      total_costo_plan,
      total_costo_real,
      total_responsables,

      ...(minInicioPlan && maxFinPlan
        ? {
            fecha_inicio_plan: minInicioPlan,
            fecha_fin_plan: maxFinPlan,
            dias_plan,
          }
        : {}),

      ...(minInicioReal && maxFinReal
        ? {
            fecha_inicio_real: minInicioReal,
            fecha_fin_real: maxFinReal,
            dias_reales,
          }
        : {}),

      ...(dias_desviacion != null ? { dias_desviacion } : {}),
    },
  });
}


/* ========== LISTAR DETALLES DE UNA TAREA ========== */
export async function listTareaDetalles(request, reply) {
  const scope = resolveScope(request);
  const { tareaId } = request.params;
  const { estado, responsableId } = request.query || {};

  const where = {
    tarea_id: tareaId,
    eliminado: false,
    tarea: {
      proyecto: {
        empresa_id: scope.empresaId,
        eliminado: false,
        empresa: { eliminado: false },
      },
    },
    ...(estado ? { estado } : {}),
    ...(responsableId ? { responsable_id: responsableId } : {}),
  };

  const rows = await prisma.tareaDetalle.findMany({
    where,
    orderBy: [{ fecha_inicio_plan: "asc" }],
    include: {
      responsable: {
        include: { usuario: { select: { nombre: true, correo: true } } },
      },
    },
  });

  return reply.send({ ok: true, rows });
}

/* ========== CREAR DETALLE ========== */
export async function createTareaDetalle(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};

  const {
    tarea_id,
    titulo,
    descripcion,
    responsable_id,
    estado,
    fecha_inicio_plan,
    dias_plan,
    fecha_inicio_real,
    dias_reales,
    horas_plan,
    horas_real,
  } = body;

  const fip = parseDate(fecha_inicio_plan);
  const diasPlan = toIntOrNull(dias_plan);

  if (!fip || !diasPlan || diasPlan <= 0)
    return httpError(
      reply,
      400,
      "Debes indicar fecha inicio y días plan (>0) en el detalle"
    );

  const ffp = addDaysInclusive(fip, diasPlan);

  const fir = parseDate(fecha_inicio_real);
  const diasReales = toIntOrNull(dias_reales);
  const ffr =
    fir && diasReales && diasReales > 0
      ? addDaysInclusive(fir, diasReales)
      : null;

  // diferencia real vs plan de la subtarea
  const diasDesviacion =
    diasPlan != null && diasReales != null ? diasReales - diasPlan : null;

  const row = await prisma.$transaction(async (tx) => {
    await assertTareaInEmpresa(tx, tarea_id, scope.empresaId);

    let valorHora = null;
    let responsableIdFinal = responsable_id ?? null;

    if (responsableIdFinal) {
      const emp = await assertEmpleadoInEmpresa(
        tx,
        responsableIdFinal,
        scope.empresaId
      );
      valorHora = valorHoraFromEmpleado(emp);
    }

    const horasPlan =
      typeof horas_plan === "number" && !Number.isNaN(horas_plan)
        ? horas_plan
        : null;
    const horasReal =
      typeof horas_real === "number" && !Number.isNaN(horas_real)
        ? horas_real
        : null;

    const costoPlan =
      valorHora != null && horasPlan != null ? valorHora * horasPlan : null;
    const costoReal =
      valorHora != null && horasReal != null ? valorHora * horasReal : null;

    const finalEstado = estado || "pendiente";

    const created = await tx.tareaDetalle.create({
      data: {
        tarea_id,
        titulo,
        descripcion,
        responsable_id: responsableIdFinal,
        estado: finalEstado,
        fecha_inicio_plan: fip,
        fecha_fin_plan: ffp,
        dias_plan: diasPlan,
        fecha_inicio_real: fir,
        fecha_fin_real: ffr,
        dias_reales: diasReales || null,
        dias_desviacion: diasDesviacion, // 👈 NUEVO
        horas_plan: horasPlan,
        horas_real: horasReal,
        valor_hora: valorHora,
        costo_plan: costoPlan,
        costo_real: costoReal,
      },
    });

    await recomputeTareaFromDetalles(tx, tarea_id);

    return created;
  });

  return reply.code(201).send({ ok: true, row });
}

/* ========== ACTUALIZAR DETALLE ========== */
// src/tareas/detalles.controllers.js

export async function updateTareaDetalle(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const data = request.body || {};

  // 👇 extraemos la accion y la quitamos de data
  const accion = data.accion;
  delete data.accion;

  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.tareaDetalle.findFirst({
      where: {
        id,
        eliminado: false,
        tarea: {
          proyecto: {
            empresa_id: scope.empresaId,
            eliminado: false,
            empresa: { eliminado: false },
          },
        },
      },
    });

    if (!current)
      throw Object.assign(new Error("Detalle de tarea no encontrado"), {
        statusCode: 404,
      });

    const tareaId = current.tarea_id;

    // ===== PLAN (se mantiene igual) =====
    const fip = data.fecha_inicio_plan
      ? parseDate(data.fecha_inicio_plan)
      : current.fecha_inicio_plan;

    const diasPlan = Object.prototype.hasOwnProperty.call(data, "dias_plan")
      ? toIntOrNull(data.dias_plan)
      : current.dias_plan;

    if (!fip || !diasPlan || diasPlan <= 0)
      throw Object.assign(
        new Error(
          "Debes indicar fecha inicio y días plan (>0) en el detalle de tarea"
        ),
        { statusCode: 400 }
      );

    const ffp = addDaysInclusive(fip, diasPlan);

    // ===== REAL (base) =====
    let fir = Object.prototype.hasOwnProperty.call(data, "fecha_inicio_real")
      ? parseDate(data.fecha_inicio_real)
      : current.fecha_inicio_real;

    let ffr = Object.prototype.hasOwnProperty.call(data, "fecha_fin_real")
      ? parseDate(data.fecha_fin_real)
      : current.fecha_fin_real;

    let diasReales = Object.prototype.hasOwnProperty.call(data, "dias_reales")
      ? toIntOrNull(data.dias_reales)
      : current.dias_reales;

    // Si vienen inicio+fin pero no días, los calculamos
    if (fir && ffr && (!diasReales || diasReales <= 0)) {
      diasReales = daysBetweenInclusive(fir, ffr);
    }

    // Caso raro: solo mandan fin_real pero no inicio_real
    if (!fir && ffr) {
      fir = current.fecha_inicio_real || current.fecha_inicio_plan || null;
      if (fir) {
        diasReales = daysBetweenInclusive(fir, ffr);
      }
    }

    // Si los datos reales no son coherentes, limpiamos
    if (!fir || !ffr || !diasReales || diasReales <= 0) {
      fir = null;
      ffr = null;
      diasReales = null;
    }

    // ===== OVERRIDE SEGÚN ACCIÓN (checkbox) =====
    if (accion === "start") {
      // iniciar actividad
      if (!fir) {
        fir = new Date(); // o current.fecha_inicio_plan si prefieres
      }
      ffr = null;
      diasReales = null;
      data.estado = "en_progreso";
      // si quieres, puedes fijar avance mínimo:
      if (typeof data.avance === "undefined") {
        data.avance = current.avance && current.avance > 0 ? current.avance : 0;
      }
    } else if (accion === "finish") {
      // finalizar actividad
      if (!fir) {
        fir = new Date(); // si nunca se marcó inicio, usamos ahora
      }
      ffr = new Date();
      diasReales = daysBetweenInclusive(fir, ffr);
      data.estado = "completada";
      data.avance = 100;
    } else if (accion === "reset") {
      // volver a pendiente
      fir = null;
      ffr = null;
      diasReales = null;
      data.estado = "pendiente";
      data.avance = 0;
    }

    // ===== RESPONSABLE / COSTOS (igual que antes) =====
    const responsableIdFinal = Object.prototype.hasOwnProperty.call(
      data,
      "responsable_id"
    )
      ? data.responsable_id
      : current.responsable_id;

    let valorHora = current.valor_hora;
    if (responsableIdFinal && responsableIdFinal !== current.responsable_id) {
      const emp = await assertEmpleadoInEmpresa(
        tx,
        responsableIdFinal,
        scope.empresaId
      );
      valorHora = valorHoraFromEmpleado(emp);
    }

    const horasPlan = Object.prototype.hasOwnProperty.call(data, "horas_plan")
      ? data.horas_plan
      : current.horas_plan;

    const horasReal = Object.prototype.hasOwnProperty.call(data, "horas_real")
      ? data.horas_real
      : current.horas_real;

    const costoPlan =
      valorHora != null && horasPlan != null ? valorHora * horasPlan : null;
    const costoReal =
      valorHora != null && horasReal != null ? valorHora * horasReal : null;

    const diasDesviacion =
      diasPlan != null && diasReales != null ? diasReales - diasPlan : null;

    const updated = await tx.tareaDetalle.update({
      where: { id },
      data: {
        ...data, // 👈 aquí ya NO va `accion`
        tarea_id: tareaId,
        responsable_id: responsableIdFinal,
        fecha_inicio_plan: fip,
        fecha_fin_plan: ffp,
        dias_plan: diasPlan,
        fecha_inicio_real: fir,
        fecha_fin_real: ffr,
        dias_reales: diasReales || null,
        dias_desviacion: diasDesviacion,
        valor_hora: valorHora,
        horas_plan: horasPlan,
        horas_real: horasReal,
        costo_plan: costoPlan,
        costo_real: costoReal,
      },
    });

    await recomputeTareaFromDetalles(tx, tareaId);

    return updated;
  });

  return reply.send({ ok: true, row });
}

/* ========== ELIMINAR DETALLE (HARD DELETE) ========== */
export async function deleteTareaDetalle(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  await prisma.$transaction(async (tx) => {
    const det = await tx.tareaDetalle.findFirst({
      where: {
        id,
        tarea: {
          proyecto: {
            empresa_id: scope.empresaId,
            eliminado: false,
            empresa: { eliminado: false },
          },
        },
      },
      select: { id: true, tarea_id: true },
    });

    if (!det)
      throw Object.assign(new Error("Detalle de tarea no encontrado"), {
        statusCode: 404,
      });

    await tx.tareaDetalle.delete({ where: { id: det.id } });

    await recomputeTareaFromDetalles(tx, det.tarea_id);
  });

  return reply.send({ ok: true, msg: "Detalle de tarea eliminado" });
}
