import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

/** ===== Helpers fecha (Lun-Dom) ===== */
function startOfWeekMonday(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Dom,1=Lun...
  const diff = (day === 0 ? -6 : 1 - day);
  x.setDate(x.getDate() + diff);
  return x;
}
function endOfWeekSunday(d) {
  const s = startOfWeekMonday(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function clamp01(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
function pct01From100(v) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return clamp01(n / 100);
}
function overlapDays(a1, a2, b1, b2) {
  if (!a1 || !a2 || !b1 || !b2) return 0;
  const s = new Date(Math.max(new Date(a1).getTime(), new Date(b1).getTime()));
  const e = new Date(Math.min(new Date(a2).getTime(), new Date(b2).getTime()));
  s.setHours(0, 0, 0, 0);
  e.setHours(0, 0, 0, 0);
  if (e < s) return 0;
  return Math.floor((e.getTime() - s.getTime()) / (24 * 3600 * 1000)) + 1;
}

/** ===== Peso tarea (ponderación) ===== */
function taskWeight(t) {
  const costo = Number(t.total_costo_plan);
  if (Number.isFinite(costo) && costo > 0) return costo;

  const horas = Number(t.total_horas_plan);
  if (Number.isFinite(horas) && horas > 0) return horas;

  const dias = Number(t.dias_plan);
  if (Number.isFinite(dias) && dias > 0) return dias;

  return 1;
}

/** ===== Base monetaria ===== */
function pickBaseMoney(cot, base) {
  const vendido = Number(cot?.subtotal || 0);
  const cotizado = Number(cot?.total || 0);
  const b = String(base || "VENTA").toUpperCase();
  const monto = b === "COTIZADO" ? cotizado : vendido;
  return { fuente: b, valor: monto, valorVendido: vendido, valorCotizado: cotizado };
}

/**
 * Devuelve avance ponderado (0..1) usando los avances “as-of” una fecha:
 * - Si hay historial <= fecha, usa to_avance (último evento por tarea)
 * - Si no hay historial, usa tarea.avance actual
 *
 * Implementación eficiente: SQL Postgres con DISTINCT ON.
 */
async function getWeightedProgressAsOf({ proyectoId, asOf, tareas, weightsById }) {
  if (!tareas.length) return 0;

  const tareaIds = tareas.map((t) => t.id);

  // Último evento por tarea <= asOf que tenga to_avance no nulo
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON (h.tarea_id)
      h.tarea_id,
      h.to_avance,
      h.occurred_at
    FROM "TareaHistorial" h
    WHERE h.proyecto_id = ${proyectoId}
      AND h.tarea_id = ANY(${tareaIds})
      AND h.occurred_at <= ${asOf}
      AND h.to_avance IS NOT NULL
    ORDER BY h.tarea_id, h.occurred_at DESC
  `;

  const map = new Map();
  for (const r of rows) {
    map.set(r.tarea_id, Number(r.to_avance));
  }

  let sumW = 0;
  let sumWA = 0;

  for (const t of tareas) {
    const w = weightsById.get(t.id) || 1;
    const a100 = map.has(t.id) ? map.get(t.id) : Number(t.avance || 0);
    const a01 = pct01From100(a100);
    sumW += w;
    sumWA += w * a01;
  }

  return sumW > 0 ? sumWA / sumW : 0;
}

/**
 * Tareas terminadas en la semana (REAL):
 * - evento donde to_estado = "completa" o to_avance=100 dentro del rango
 * - devuelve lista única por tarea (último evento dentro del rango)
 */
async function getCompletedTasksInRange({ proyectoId, start, end }) {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON (h.tarea_id)
      h.tarea_id,
      h.to_estado,
      h.to_avance,
      h.occurred_at
    FROM "TareaHistorial" h
    WHERE h.proyecto_id = ${proyectoId}
      AND h.occurred_at >= ${start}
      AND h.occurred_at <= ${end}
      AND (
        (h.to_estado IS NOT NULL AND lower(h.to_estado) IN ('completa','finalizada','done'))
        OR (h.to_avance IS NOT NULL AND h.to_avance >= 100)
      )
    ORDER BY h.tarea_id, h.occurred_at DESC
  `;
  return rows;
}

/** ===== Controller =====
 * GET /api/proyectos/:id/reporte-devengado?base=VENTA|COTIZADO
 */
export async function reporteDevengadoProfesional(request, reply) {
  try {
    const proyectoId = request.params.id;
    const baseParam = (request.query.base || "VENTA").toUpperCase();

    const proyecto = await prisma.proyecto.findFirst({
      where: { id: proyectoId, eliminado: false },
      select: {
        id: true,
        nombre: true,
        estado: true,
        empresa_id: true,
        fecha_inicio_plan: true,
        fecha_fin_plan: true,
        fecha_inicio_real: true,
        fecha_fin_real: true,
      },
    });

    if (!proyecto) return reply.code(404).send({ ok: false, error: "Proyecto no encontrado" });

    const cotizacion = await prisma.cotizacion.findFirst({
      where: { proyecto_id: proyectoId, eliminado: false, estado: "ACEPTADA" },
      orderBy: { fecha_documento: "desc" },
      select: { id: true, numero: true, subtotal: true, iva: true, total: true, estado: true, fecha_documento: true },
    });

    const base = pickBaseMoney(cotizacion, baseParam);

    const tareasRaw = await prisma.tarea.findMany({
      where: { proyecto_id: proyectoId, eliminado: false },
      select: {
        id: true,
        nombre: true,
        jira_key: true,
        jira_tipo: true,
        estado: true,
        avance: true,
        fecha_inicio_plan: true,
        fecha_fin_plan: true,
        fecha_inicio_real: true,
        fecha_fin_real: true,
        dias_plan: true,
        total_horas_plan: true,
        total_costo_plan: true,
      },
      orderBy: [{ fecha_inicio_plan: "asc" }],
    });

    const tareas = tareasRaw.map((t) => ({
      ...t,
      tipo: t.jira_tipo || "Tarea",
      nombre: t.jira_key ? `${t.jira_key} ${t.nombre || ""}`.trim() : (t.nombre || "Sin nombre"),
    }));

    // weights
    const weightsById = new Map();
    let sumW = 0;
    for (const t of tareas) {
      const w = taskWeight(t);
      weightsById.set(t.id, w);
      sumW += w;
    }

    // Avance actual ponderado (con avances actuales)
    let sumWA = 0;
    for (const t of tareas) {
      const w = weightsById.get(t.id) || 1;
      sumWA += w * pct01From100(t.avance);
    }
    const avanceActual01 = sumW > 0 ? sumWA / sumW : 0;

    const devengadoAcumulado = Math.round(base.valor * avanceActual01);

    // Compras
    const comprasRaw = await prisma.compra.findMany({
      where: { proyecto_id: proyectoId, eliminado: false },
      include: { proveedor: { select: { nombre: true } } },
      orderBy: { id: "desc" },
    });

    const comprasList = comprasRaw.map(c => ({
      numero: c.numero,
      fecha: c.fecha_docto || c.creada_en,
      proveedor: c.proveedor?.nombre || "Sin proveedor",
      estado: c.estado,
      total: c.total,
      factura_url: c.factura_url,
    }));

    // Equipo Asignado
    const miembros = await prisma.proyectoMiembro.findMany({
      where: { proyecto_id: proyectoId },
      include: {
        empleado: {
          include: {
            usuario: { select: { nombre: true } },
            hhRegistros: {
              orderBy: [{ anio: 'desc' }, { mes: 'desc' }],
              take: 1,
            }
          }
        }
      }
    });

    const empleadosList = miembros.map(m => {
      const e = m.empleado;
      const u = e?.usuario;
      const hh = e?.hhRegistros?.[0];
      return {
        nombre: u?.nombre || "Usuario",
        cargo: e?.cargo || m.rol || "Miembro",
        costoHH: hh?.costoHH || Math.round((e?.sueldo_base || 500000) / 180),
      };
    });

    // Rendiciones aprobadas
    const rendiciones = await prisma.rendicion.findMany({
      where: { proyecto_id: proyectoId, eliminado: false, estado: { in: ["aprobada", "pagada", "revisada"] } },
    });
    const totalRendiciones = rendiciones.reduce((acc, r) => acc + r.monto_total, 0);

    const totalCompras = comprasList.reduce((acc, c) => acc + c.total, 0);
    const comprasFacturadas = comprasList.filter(c => c.estado === "FACTURADA" || c.factura_url).reduce((acc, c) => acc + c.total, 0);
    const hhCostoReal = tareasRaw.reduce((acc, t) => acc + (t.total_costo_real || 0), 0);
    const costoAcumulado = totalCompras + totalRendiciones + hhCostoReal;

    const costos = {
      totalCompras,
      totalRendiciones,
      valorHHReal: hhCostoReal,
      comprasFacturadas,
      costoAcumulado,
    };

    const yaPasoCosto = devengadoAcumulado >= costos.costoAcumulado;
    const faltanteParaEquilibrio = Math.max(0, costos.costoAcumulado - devengadoAcumulado);
    const utilidadDevengada = Math.max(0, devengadoAcumulado - costos.costoAcumulado);

    // Semanas
    const now = new Date();
    const semanaActual = { inicio: startOfWeekMonday(now), fin: endOfWeekSunday(now) };
    const semanaPasada = { inicio: addDays(semanaActual.inicio, -7), fin: addDays(semanaActual.fin, -7) };
    const semanaProxima = { inicio: addDays(semanaActual.inicio, 7), fin: addDays(semanaActual.fin, 7) };

    const rango = { semanaPasada, semanaActual, semanaProxima };

    // ===== Listas de tareas por plan (como tu UI actual) =====
    const inRangePlan = (t, r) =>
      t.fecha_inicio_plan && t.fecha_fin_plan &&
      overlapDays(t.fecha_inicio_plan, t.fecha_fin_plan, r.inicio, r.fin) > 0;

    const completadasSemanaPasada = tareas.filter((t) => {
      // usando estado/avance actual (solo para lista visual); lo REAL semanal va por historial
      const done = String(t.estado || "").toLowerCase() === "completa" || Number(t.avance || 0) >= 100;
      return done && inRangePlan(t, semanaPasada);
    });

    const enSemanaActual = tareas.filter((t) => inRangePlan(t, semanaActual));
    const atrasadas = tareas.filter((t) => {
      const done = String(t.estado || "").toLowerCase() === "completa" || Number(t.avance || 0) >= 100;
      return !done && t.fecha_fin_plan && new Date(t.fecha_fin_plan) < semanaActual.inicio;
    });
    const pendientesFuturas = tareas.filter((t) => {
      const done = String(t.estado || "").toLowerCase() === "completa" || Number(t.avance || 0) >= 100;
      return !done && t.fecha_inicio_plan && new Date(t.fecha_inicio_plan) > semanaActual.fin;
    });

    // ===== Semanal PLAN =====
    function weeklyPlanned(r) {
      let sumPlannedW = 0;

      for (const t of tareas) {
        if (!t.fecha_inicio_plan || !t.fecha_fin_plan) continue;
        const w = weightsById.get(t.id) || 1;

        const totalDays = Math.max(
          1,
          overlapDays(t.fecha_inicio_plan, t.fecha_fin_plan, t.fecha_inicio_plan, t.fecha_fin_plan)
        );
        const ov = overlapDays(t.fecha_inicio_plan, t.fecha_fin_plan, r.inicio, r.fin);
        if (ov <= 0) continue;

        sumPlannedW += (ov / totalDays) * w;
      }

      const pct = sumW > 0 ? sumPlannedW / sumW : 0;
      const amount = Math.round(base.valor * pct);

      return { pct: Math.round(pct * 10000) / 100, amount };
    }

    // ===== Semanal REAL (audit) =====
    async function weeklyReal(r) {
      // avance ponderado al inicio-1ms y al fin
      const startMinus = new Date(r.inicio);
      startMinus.setMilliseconds(startMinus.getMilliseconds() - 1);

      const aStart = await getWeightedProgressAsOf({
        proyectoId,
        asOf: startMinus,
        tareas,
        weightsById,
      });

      const aEnd = await getWeightedProgressAsOf({
        proyectoId,
        asOf: r.fin,
        tareas,
        weightsById,
      });

      const delta = Math.max(0, aEnd - aStart);

      const amount = Math.round(base.valor * delta);

      // tareas completadas por historial dentro de semana
      const completedRows = await getCompletedTasksInRange({ proyectoId, start: r.inicio, end: r.fin });

      // trae nombres de tareas completadas
      const completedIds = [...new Set(completedRows.map((x) => x.tarea_id))];
      let completedTasks = [];
      if (completedIds.length) {
        const taskMap = new Map(tareas.map((t) => [t.id, t]));
        completedTasks = completedIds
          .map((id) => taskMap.get(id))
          .filter(Boolean)
          .map((t) => ({
            id: t.id,
            nombre: t.nombre,
            tipo: t.tipo,
            avance: t.avance,
            estado: t.estado,
            fecha_inicio_plan: t.fecha_inicio_plan,
            fecha_fin_plan: t.fecha_fin_plan,
            fecha_inicio_real: t.fecha_inicio_real,
            fecha_fin_real: t.fecha_fin_real,
          }));
      }

      return {
        avanceInicioPct: Math.round(aStart * 10000) / 100,
        avanceFinPct: Math.round(aEnd * 10000) / 100,
        avanceSemanaPct: Math.round(delta * 10000) / 100,
        devengadoSemana: amount,
        tareasHechas: completedTasks,
        tareasHechasCount: completedTasks.length,
      };
    }

    const weekly = {
      semanaPasada: {
        plan: weeklyPlanned(semanaPasada),
        real: await weeklyReal(semanaPasada),
      },
      semanaActual: {
        plan: weeklyPlanned(semanaActual),
        real: await weeklyReal(semanaActual),
      },
      semanaProxima: {
        plan: weeklyPlanned(semanaProxima),
        real: await weeklyReal(semanaProxima),
      },
    };

    // Arma respuesta compatible con tu frontend actual + agregamos weekly
    return reply.send({
      ok: true,
      proyecto,
      rango,
      financiero: {
        base,
        costos,
        devengado: {
          devengado: devengadoAcumulado,
          avancePct: Math.round(avanceActual01 * 10000) / 100, // 2 dec
          utilidadDevengada,
          faltanteParaEquilibrio,
          yaPasoCosto,
          breakevenPct: null,
        },
      },
      tareas: {
        usandoSubtareas: false,
        avancePct: Math.round(avanceActual01 * 10000) / 100,
        conteo: {
          completadasSemanaPasada: completadasSemanaPasada.length,
          enSemanaActual: enSemanaActual.length,
          atrasadas: atrasadas.length,
          pendientesFuturas: pendientesFuturas.length,
        },
        completadasSemanaPasada,
        enSemanaActual,
        atrasadas,
        pendientesFuturas,
      },
      compras: comprasList,
      empleados: empleadosList,
      weekly,
      notas: [
        "REAL semanal se calcula con TareaHistorial (audit). Si no has guardado eventos aún, el delta puede salir 0.",
        "PLAN semanal se calcula repartiendo el peso de cada tarea por sus días plan dentro de la semana.",
        "Ponderación: costo_plan > horas_plan > dias_plan > 1.",
      ],
    });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ ok: false, error: err.message || "Error interno" });
  }
}