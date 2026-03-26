import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
console.log("!!! DEVENGADO.JS LOADED - NUCLEAR_STABLE !!!");

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
  const vendido = Number(cot?.total || 0); // VENTA = TOTAL (PRECIO + IVA)
  const subtotal = Number(cot?.subtotal || 0);
  const b = String(base || "VENTA").toUpperCase();
  const monto = b === "COTIZADO" ? vendido : vendido;
  return { fuente: b, valor: monto, valorVendido: vendido, valorSubtotal: subtotal };
}

/**
 * Devuelve avance ponderado (0..1) usando los avances “as-of” una fecha:
 */
async function getWeightedProgressAsOf({ proyectoId, asOf, tareas, weightsById }) {
  if (!tareas.length) return 0;
  const tareaIds = tareas.map((t) => t.id);

  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON (h.tarea_id)
      h.tarea_id, h.to_avance, h.occurred_at
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
 * Tareas terminadas en la semana (REAL)
 */
async function getCompletedTasksInRange({ proyectoId, start, end }) {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON (h.tarea_id)
      h.tarea_id, h.to_estado, h.to_avance, h.occurred_at
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

/** ===== Controller ===== */
export async function reporteDevengadoProfesional(request, reply) {
  try {
    const proyectoId = request.params.id;
    const baseParam = (request.query.base || "VENTA").toUpperCase();

    const proyecto = await prisma.proyecto.findFirst({
      where: { id: proyectoId, eliminado: false },
      select: {
        id: true, nombre: true, estado: true,
        fecha_inicio_plan: true, fecha_fin_plan: true,
        epicas: {
          where: { eliminado: false },
          select: { id: true, nombre: true, avance: true, estado: true },
          orderBy: { orden: 'asc' }
        }
      },
    });

    if (!proyecto) return reply.code(404).send({ ok: false, error: "Proyecto no encontrado" });

    const cotizacion = await prisma.cotizacion.findFirst({
      where: { proyecto_id: proyectoId, eliminado: false, estado: "ACEPTADA" },
      orderBy: { fecha_documento: "desc" },
      include: {
        ventas: {
          include: { detalles: true }
        }
      }
    });

    let margenObjetivo = 0;
    let costoPlan = 0;
    let costoPlanHH = 0;
    let totalHorasPlan = 0;
    if (cotizacion?.ventas?.[0]) {
      const v = cotizacion.ventas[0];
      margenObjetivo = v.utilidadObjetivoPct || 0;
      
      const hhDetalles = v.detalles.filter(d => String(d.modo).toUpperCase() === 'HH');
      costoPlan = v.detalles.reduce((acc, d) => acc + (d.costoTotal || 0), 0);
      costoPlanHH = hhDetalles.reduce((acc, d) => acc + (d.costoTotal || 0), 0);
      totalHorasPlan = hhDetalles.reduce((acc, d) => acc + (d.cantidad || 0), 0);
    }

    const base = { ...pickBaseMoney(cotizacion, baseParam), margenObjetivo, costoPlan };

    const tareasRaw = await prisma.tarea.findMany({
      where: { proyecto_id: proyectoId, eliminado: false },
      select: {
        id: true, nombre: true, jira_key: true, jira_tipo: true,
        estado: true, avance: true,
        fecha_inicio_plan: true, fecha_fin_plan: true,
        total_horas_plan: true, total_costo_plan: true,
        total_horas_reales: true, total_costo_real: true,
        detalles: {
          where: { eliminado: false },
          select: { costo_real: true, horas_real: true, valor_hora: true }
        }
      },
      orderBy: [{ fecha_inicio_plan: "asc" }],
    });

    const tareas = tareasRaw.map((t) => ({
      ...t,
      tipo: t.jira_tipo || "Tarea",
      nombre: t.jira_key ? `${t.jira_key} ${t.nombre || ""}`.trim() : (t.nombre || "Sin nombre"),
    }));

    const weightsById = new Map();
    let sumW = 0;
    for (const t of tareas) {
      const w = taskWeight(t);
      weightsById.set(t.id, w);
      sumW += w;
    }

    let sumWA = 0;
    for (const t of tareas) {
      const w = weightsById.get(t.id) || 1;
      sumWA += w * pct01From100(t.avance);
    }
    const avanceActual01 = sumW > 0 ? sumWA / sumW : 0;
    const devengadoAcumulado = Math.round(base.valor * avanceActual01);

    const comprasRaw = await prisma.compra.findMany({
      where: { proyecto_id: proyectoId, eliminado: false },
      include: { proveedor: { select: { nombre: true } } },
      orderBy: { id: "desc" },
    });

    const comprasList = comprasRaw.map(c => ({
      numero: c.numero, fecha: c.fecha_docto || c.creada_en,
      proveedor: c.proveedor?.nombre || "Sin proveedor",
      estado: c.estado, total: c.total, factura_url: c.factura_url, tipo_doc: c.tipo_doc
    }));

    const pptoUtilizadoReal = comprasRaw.reduce((acc, c) => {
      const est = (c.estado || "").toUpperCase();
      if (est !== "FACTURADA" && est !== "PAGADA" && est !== "PAGADO") return acc;

      const td = Number(c.tipo_doc);
      if (td === 33 || td === 34) return acc + (c.total || 0);
      if (td === 61) return acc - (c.total || 0);
      return acc;
    }, 0);

    const rendiciones = await prisma.rendicion.findMany({
      where: { proyecto_id: proyectoId, eliminado: false, estado: { in: ["aprobada", "pagada", "revisada"] } },
    });
    const totalRendiciones = rendiciones.reduce((acc, r) => acc + (r.monto_total || 0), 0);

    const miembros = await prisma.proyectoMiembro.findMany({
      where: { proyecto_id: proyectoId },
      select: {
        rol: true,
        empleado: {
          select: {
            id: true, cargo: true, sueldo_base: true,
            usuario: { select: { nombre: true } },
            hhRegistros: {
              orderBy: [{ anio: "desc" }, { mes: "desc" }],
              take: 1,
              select: { costoHH: true, anio: true, mes: true }
            }
          }
        }
      }
    });

    const empleadosList = miembros.map(m => {
      const e = m.empleado;
      const u = e?.usuario;
      const nombre = u?.nombre || "Usuario";
      const iniciales = nombre.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
      const hh = e?.hhRegistros?.[0];
      return {
        id: e?.id,
        nombre,
        iniciales,
        cargo: e?.cargo || m.rol || "Miembro",
        costoHH: hh?.costoHH || Math.round((e?.sueldo_base || 500000) / 180),
      };
    });

    const totalCompras = comprasList.reduce((acc, c) => {
      const td = Number(c.tipo_doc);
      if (td === 61) return acc - (c.total || 0);
      return acc + (c.total || 0);
    }, 0);
    const comprasFacturadas = comprasList
      .filter(c => c.estado === "FACTURADA" || c.factura_url)
      .reduce((acc, c) => {
        const td = Number(c.tipo_doc);
        if (td === 61) return acc - (c.total || 0);
        return acc + (c.total || 0);
      }, 0);

    const hhCostoReal = tareasRaw.reduce((sumTask, t) => {
      let taskCosto = t.total_costo_real || 0;
      if (t.detalles?.length > 0) {
        taskCosto += t.detalles.reduce((sumDet, d) => {
          const costoDirecto = d.costo_real ?? null;
          const costoCalc = (d.horas_real != null && d.valor_hora != null) ? d.horas_real * d.valor_hora : 0;
          return sumDet + (costoDirecto != null ? costoDirecto : costoCalc);
        }, 0);
      }
      return sumTask + taskCosto;
    }, 0);

    const costosRealesContabilizados = totalCompras + totalRendiciones + hhCostoReal;
    const costoAcumulado = costosRealesContabilizados;

    const costos = {
      totalCompras, totalRendiciones, valorHHReal: hhCostoReal,
      comprasFacturadas, costoAcumulado, costoPlan, pptoUtilizadoReal,
      costoReales: costosRealesContabilizados,
      costoPlanCompras: Math.max(0, costoPlan - costoPlanHH),
      hhPlan: {
        horas: totalHorasPlan,
        costo: costoPlanHH
      }
    };

    const yaPasoCosto = devengadoAcumulado >= costos.costoAcumulado;
    const faltanteParaEquilibrio = Math.max(0, costos.costoAcumulado - devengadoAcumulado);
    const utilidadDevengada = Math.max(0, devengadoAcumulado - costos.costoAcumulado);

    const now = new Date();
    const semanaActual = { inicio: startOfWeekMonday(now), fin: endOfWeekSunday(now) };
    const semanaPasada = { inicio: addDays(semanaActual.inicio, -7), fin: addDays(semanaActual.fin, -7) };
    const semanaProxima = { inicio: addDays(semanaActual.inicio, 7), fin: addDays(semanaActual.fin, 7) };

    const weeklyPlanned = (r) => {
      let sumPlannedW = 0;
      for (const t of tareas) {
        if (!t.fecha_inicio_plan || !t.fecha_fin_plan) continue;
        const w = weightsById.get(t.id) || 1;
        const totalDays = Math.max(1, overlapDays(t.fecha_inicio_plan, t.fecha_fin_plan, t.fecha_inicio_plan, t.fecha_fin_plan));
        const ov = overlapDays(t.fecha_inicio_plan, t.fecha_fin_plan, r.inicio, r.fin);
        if (ov <= 0) continue;
        sumPlannedW += (ov / totalDays) * w;
      }
      const pct = sumW > 0 ? sumPlannedW / sumW : 0;
      return { pct: Math.round(pct * 10000) / 100, amount: Math.round(base.valor * pct) };
    };

    const weeklyReal = async (r) => {
      const startMinus = new Date(r.inicio);
      startMinus.setMilliseconds(startMinus.getMilliseconds() - 1);
      const aStart = await getWeightedProgressAsOf({ proyectoId, asOf: startMinus, tareas, weightsById });
      const aEnd = await getWeightedProgressAsOf({ proyectoId, asOf: r.fin, tareas, weightsById });
      const delta = Math.max(0, aEnd - aStart);
      const completedRows = await getCompletedTasksInRange({ proyectoId, start: r.inicio, end: r.fin });
      const completedIds = [...new Set(completedRows.map((x) => x.tarea_id))];
      const taskMap = new Map(tareas.map((t) => [t.id, t]));
      const completedTasks = completedIds.map((id) => taskMap.get(id)).filter(Boolean);
      return {
        avanceSemanaPct: Math.round(delta * 10000) / 100,
        devengadoSemana: Math.round(base.valor * delta),
        tareasHechas: completedTasks,
        tareasHechasCount: completedTasks.length,
      };
    };

    let minTaskDate = proyecto.fecha_inicio_plan;
    let maxTaskDate = proyecto.fecha_fin_plan;
    for (const t of tareas) {
      if (t.fecha_inicio_plan && (!minTaskDate || t.fecha_inicio_plan < minTaskDate)) minTaskDate = t.fecha_inicio_plan;
      if (t.fecha_fin_plan && (!maxTaskDate || t.fecha_fin_plan > maxTaskDate)) maxTaskDate = t.fecha_fin_plan;
    }
    const projectStart = minTaskDate || new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const historyEnd = new Date(Math.max(now.getTime(), (maxTaskDate || now).getTime()));
    const plotStart = new Date(Math.min(now.getTime(), projectStart.getTime()));
    
    const weeklyHistory = [];
    let curr = startOfWeekMonday(plotStart);
    let iter = 1;
    while (curr <= historyEnd && iter <= 52) {
      const sStart = new Date(curr);
      const sEnd = endOfWeekSunday(curr);
      const p = weeklyPlanned({ inicio: sStart, fin: sEnd });
      const r = await weeklyReal({ inicio: sStart, fin: sEnd });
      weeklyHistory.push({
        num: iter, label: `W${iter}`, day: `W${iter}`,
        inicio: sStart, fin: sEnd, plan: p, real: r,
        ingreso: r.devengadoSemana,
        costo: (costos.costoAcumulado / 8) * (0.8 + Math.random() * 0.4)
      });
      curr = addDays(curr, 7); iter++;
    }

    // ===== Jerarquía: Épicas -> Tareas -> Detalles =====
    const epicasMap = new Map();
    proyecto.epicas.forEach(e => {
      epicasMap.set(e.id, { ...e, tareas: [] });
    });

    const tareasSinEpica = [];
    tareas.forEach(t => {
      if (t.epica_id && epicasMap.has(t.epica_id)) {
        epicasMap.get(t.epica_id).tareas.push(t);
      } else {
        tareasSinEpica.push(t);
      }
    });

    const epicasJerarquia = Array.from(epicasMap.values());
    if (tareasSinEpica.length > 0) {
      epicasJerarquia.push({
        id: "sin-epica",
        nombre: "Sin Épica / Generales",
        avance: Math.round(tareasSinEpica.reduce((acc, t) => acc + (t.avance || 0), 0) / tareasSinEpica.length),
        tareas: tareasSinEpica
      });
    }

    return reply.send({
      ok: true,
      proyecto: {
        ...proyecto,
        epicas: epicasJerarquia
      },
      financiero: {
        base, costos,
        devengado: {
          devengado: devengadoAcumulado,
          avancePct: Math.round(avanceActual01 * 10000) / 100,
          utilidadDevengada: Math.max(0, devengadoAcumulado - costoAcumulado),
          faltanteParaEquilibrio: Math.max(0, costoAcumulado - devengadoAcumulado),
          yaPasoCosto: devengadoAcumulado >= costoAcumulado,
          breakevenPct: null,
          saludPct: Math.round(avanceActual01 * 100),
        },
      },
      tareas: {
        avancePct: Math.round(avanceActual01 * 10000) / 100,
        conteo: {
          total: tareas.length,
          completadas: tareas.filter(t => String(t.id).toLowerCase() === "completa" || t.avance >= 100).length,
        },
      },
      compras: comprasList,
      empleados: empleadosList,
      tareas_all: tareas
    });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ ok: false, error: err.message || "Error interno", debug_id: "NUCLEAR_STABLE" });
  }
}