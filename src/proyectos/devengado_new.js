import { PrismaClient } from "@prisma/client";
import { buscarInfoProyecto } from "./buscarInfoProyecto.js";

const prisma = new PrismaClient();

console.log("!!! DEVENGADO_NEW.JS v2 LOADED !!!");

// ===== Date helpers =====
function startOfWeekMonday(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
  return x;
}
function endOfWeekSunday(d) {
  const s = startOfWeekMonday(d);
  const e = new Date(s); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59, 999);
  return e;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function clamp01(v) { const n = Number(v || 0); return !Number.isFinite(n) ? 0 : Math.max(0, Math.min(1, n)); }
function pct01From100(v) { const n = Number(v ?? 0); return !Number.isFinite(n) ? 0 : clamp01(n / 100); }
function overlapDays(a1, a2, b1, b2) {
  if (!a1 || !a2 || !b1 || !b2) return 0;
  const s = new Date(Math.max(new Date(a1).getTime(), new Date(b1).getTime()));
  const e = new Date(Math.min(new Date(a2).getTime(), new Date(b2).getTime()));
  s.setHours(0, 0, 0, 0); e.setHours(0, 0, 0, 0);
  if (e < s) return 0;
  return Math.floor((e.getTime() - s.getTime()) / (24 * 3600 * 1000)) + 1;
}

function taskWeight(t) {
  const costo = Number(t.total_costo_plan);
  if (Number.isFinite(costo) && costo > 0) return costo;
  const horas = Number(t.total_horas_plan);
  if (Number.isFinite(horas) && horas > 0) return horas;
  const dias = Number(t.dias_plan);
  if (Number.isFinite(dias) && dias > 0) return dias;
  return 1;
}

function pickBaseMoney(cotizacion, baseParam) {
  const vendido = Number(cotizacion?.subtotal || 0);
  const cotizado = Number(cotizacion?.total || 0);
  const b = String(baseParam || "VENTA").toUpperCase();
  const monto = b === "COTIZADO" ? cotizado : vendido;
  return { fuente: b, valor: monto, valorVendido: vendido, valorCotizado: cotizado };
}

export async function reporteDevengadoProfesional(request, reply) {
  try {
    const proyectoId = request.params.id;
    const baseParam = (request.query.base || "VENTA").toUpperCase();

    // Obtener TODOS los datos necesarios del proyecto de una vez
    const info = await buscarInfoProyecto(proyectoId);
    if (!info) return reply.code(404).send({ ok: false, error: "Proyecto no encontrado" });

    const { proyecto, cotizacion, tareas: tareasRaw, compras: comprasRaw, rendiciones, miembros } = info;

    // ===== Base monetaria =====
    const moneyBase = pickBaseMoney(cotizacion, baseParam);

    // Margen objetivo desde la venta
    let margenObjetivo = 0;
    let costoPlan = Number(proyecto?.presupuesto || 0);
    let costoPlanHH = 0;

    if (cotizacion?.ventas?.[0]) {
      const v = cotizacion.ventas[0];
      margenObjetivo = v.utilidadObjetivoPct || 0;
      
      costoPlanHH = v.detalles.filter(d => String(d.modo).toUpperCase() === 'HH').reduce((acc, d) => acc + (d.costoTotal || 0), 0);
      
      // Si el proyecto no tiene presupuesto seteado, calculamos desde el costeo de la venta
      if (costoPlan === 0) {
        costoPlan = v.detalles.reduce((acc, d) => acc + (d.costoTotal || 0), 0);
      }
    }

    const base = { ...moneyBase, margenObjetivo, costoPlan };

    // ===== Tareas enriquecidas =====
    const tareas = tareasRaw.map(t => ({
      ...t,
      tipo: t.jira_tipo || "Tarea",
      nombre: t.jira_key ? `${t.jira_key} ${t.nombre || ""}`.trim() : (t.nombre || "Sin nombre"),
    }));

    // ===== Pesos para ponderación =====
    const weightsById = new Map();
    let sumW = 0;
    for (const t of tareas) {
      const w = taskWeight(t); weightsById.set(t.id, w); sumW += w;
    }

    // ===== Avance actual ponderado =====
    let sumWA = 0;
    for (const t of tareas) {
      const w = weightsById.get(t.id) || 1;
      sumWA += w * pct01From100(t.avance);
    }
    const avanceActual01 = sumW > 0 ? sumWA / sumW : 0;
    const devengadoAcumulado = Math.round(base.valor * avanceActual01);

    // ===== Compras =====
    const comprasList = comprasRaw.map(c => ({
      numero: c.numero, fecha: c.fecha_docto,
      proveedor: c.proveedor?.nombre || "Sin proveedor",
      estado: c.estado, total: c.total, factura_url: c.factura_url, tipo_doc: c.tipo_doc
    }));

    // DEBUG: ver qué tipo_doc tienen las compras
    console.log("COMPRAS RAW tipo_doc:", comprasRaw.map(c => ({ num: c.numero, tipo_doc: c.tipo_doc, tipo: typeof c.tipo_doc, total: c.total })));

    // Presupuesto utilizado por proyecto = ∑ FAC - ∑ NC
    // FAC: 33 (Electrónica), 34 (Exenta), 39 (Boleta), 41 (Boleta Exenta), 46 (Factura de Compra), 56 (Nota de Débito), 69 (Otras)
    // NC: 61 (Nota de Crédito)
    let pptoUtilizadoReal = comprasRaw.reduce((acc, c) => {
      const est = (c.estado || "").toUpperCase();
      if (est !== "FACTURADA" && est !== "PAGADA" && est !== "PAGADO") return acc;

      const td = Number(c.tipo_doc);
      if ([33, 34, 39, 41, 46, 56, 69].includes(td)) return acc + (c.total || 0);
      if (td === 61) return acc - (c.total || 0);
      return acc;
    }, 0);
    // Fallback: si las compras son manuales (sin tipo_doc), usar el total de compras como ppto utilizado
    if (pptoUtilizadoReal === 0 && comprasRaw.length > 0) {
      pptoUtilizadoReal = comprasRaw.reduce((acc, c) => {
        const est = (c.estado || "").toUpperCase();
        if (est === "FACTURADA" || est === "PAGADA" || est === "PAGADO") {
          return acc + (c.total || 0);
        }
        return acc;
      }, 0);
    }

    // ===== Costo real HH (subtareas) =====
    const hhCostoReal = tareasRaw.reduce((sumTask, t) => {
      let costo = t.total_costo_real || 0;
      if (t.detalles?.length > 0) {
        costo += t.detalles.reduce((s, d) => {
          const direct = d.costo_real ?? null;
          const calc = (d.horas_real != null && d.valor_hora != null) ? d.horas_real * d.valor_hora : 0;
          return s + (direct != null ? direct : calc);
        }, 0);
      }
      return sumTask + costo;
    }, 0);

    const totalCompras = comprasList.reduce((acc, c) => acc + (c.total || 0), 0);
    const totalRendiciones = rendiciones.reduce((acc, r) => acc + (r.monto_total || 0), 0);
    const comprasFacturadas = comprasList.filter(c => c.estado === "FACTURADA" || c.factura_url).reduce((acc, c) => acc + (c.total || 0), 0);
    const costosRealesContabilizados = totalCompras + totalRendiciones + hhCostoReal;
    const costoAcumulado = costosRealesContabilizados;

    const costos = {
      totalCompras, totalRendiciones, valorHHReal: hhCostoReal,
      comprasFacturadas, costoAcumulado, costoPlan, pptoUtilizadoReal,
      costoReales: costosRealesContabilizados,
      costoPlanCompras: Math.max(0, costoPlan - costoPlanHH)
    };

    // ===== Equipo =====
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

    // ===== Rango dinámico basado en tareas =====
    const now = new Date();
    let minDate = proyecto.fecha_inicio_plan ? new Date(proyecto.fecha_inicio_plan) : null;
    let maxDate = proyecto.fecha_fin_plan ? new Date(proyecto.fecha_fin_plan) : null;

    for (const t of tareasRaw) {
      if (t.fecha_inicio_plan) {
        const d = new Date(t.fecha_inicio_plan);
        if (!minDate || d < minDate) minDate = d;
      }
      if (t.fecha_fin_plan) {
        const d = new Date(t.fecha_fin_plan);
        if (!maxDate || d > maxDate) maxDate = d;
      }
    }
    if (!minDate) minDate = addDays(now, -14);
    if (!maxDate) maxDate = addDays(now, 14);

    const plotStart = startOfWeekMonday(minDate);
    const plotEnd = endOfWeekSunday(new Date(Math.max(now.getTime(), maxDate.getTime())));

    // ===== Plan semanal =====
    const weeklyPlanned = (sStart, sEnd) => {
      let sumP = 0;
      for (const t of tareasRaw) {
        if (!t.fecha_inicio_plan || !t.fecha_fin_plan) continue;
        const w = weightsById.get(t.id) || 1;
        const totalDays = Math.max(1, overlapDays(t.fecha_inicio_plan, t.fecha_fin_plan, t.fecha_inicio_plan, t.fecha_fin_plan));
        const ov = overlapDays(t.fecha_inicio_plan, t.fecha_fin_plan, sStart, sEnd);
        if (ov <= 0) continue;
        sumP += (ov / totalDays) * w;
      }
      const pct = sumW > 0 ? sumP / sumW : 0;
      return { pct: Math.round(pct * 10000) / 100, amount: Math.round(base.valor * pct) };
    };

    // ===== Real semanal (delta de avance via historial) =====
    const weeklyReal = async (sStart, sEnd) => {
      if (!tareasRaw.length) return { devengadoSemana: 0, avanceSemanaPct: 0 };
      const tareaIds = tareasRaw.map(t => t.id);
      const startMinus = new Date(sStart); startMinus.setMilliseconds(-1);

      const [rowsBefore, rowsAfter] = await Promise.all([
        prisma.$queryRaw`
          SELECT DISTINCT ON (h.tarea_id) h.tarea_id, h.to_avance
          FROM "TareaHistorial" h
          WHERE h.proyecto_id = ${proyectoId}
            AND h.tarea_id = ANY(${tareaIds})
            AND h.occurred_at <= ${startMinus}
            AND h.to_avance IS NOT NULL
          ORDER BY h.tarea_id, h.occurred_at DESC`,
        prisma.$queryRaw`
          SELECT DISTINCT ON (h.tarea_id) h.tarea_id, h.to_avance
          FROM "TareaHistorial" h
          WHERE h.proyecto_id = ${proyectoId}
            AND h.tarea_id = ANY(${tareaIds})
            AND h.occurred_at <= ${new Date(sEnd)}
            AND h.to_avance IS NOT NULL
          ORDER BY h.tarea_id, h.occurred_at DESC`,
      ]);

      const mapB = new Map(rowsBefore.map(r => [r.tarea_id, Number(r.to_avance)]));
      const mapA = new Map(rowsAfter.map(r => [r.tarea_id, Number(r.to_avance)]));

      let wB = 0, wA = 0;
      for (const t of tareasRaw) {
        const w = weightsById.get(t.id) || 1;
        wB += w * pct01From100(mapB.has(t.id) ? mapB.get(t.id) : 0);
        wA += w * pct01From100(mapA.has(t.id) ? mapA.get(t.id) : 0);
      }
      const delta = sumW > 0 ? Math.max(0, (wA - wB) / sumW) : 0;
      return { devengadoSemana: Math.round(base.valor * delta), avanceSemanaPct: Math.round(delta * 10000) / 100 };
    };

    // ===== Construir historial semana a semana =====
    const weeklyHistory = [];
    let curr = new Date(plotStart);
    let iter = 1;
    while (curr <= plotEnd && iter <= 52) {
      const sStart = new Date(curr);
      const sEnd = endOfWeekSunday(curr);
      const plan = weeklyPlanned(sStart, sEnd);
      const real = await weeklyReal(sStart, sEnd);
      const costoSemana = sumW > 0 ? Math.round(costoAcumulado * (plan.pct / 100)) : 0;
      weeklyHistory.push({
        num: iter, label: `S${iter}`, day: `S${iter}`,
        inicio: sStart, fin: sEnd, plan, real,
        ingreso: real.devengadoSemana,
        costo: costoSemana,
        // Etiquetas para tooltips: si no hay venta (0), mostrar el costo proyectado
        planValue: plan.amount > 0 ? plan.amount : costoSemana,
        realValue: real.devengadoSemana,
      });
      curr = addDays(curr, 7); iter++;
    }

    // Semana actual / pasada / próxima
    const semanaActual = { inicio: startOfWeekMonday(now), fin: endOfWeekSunday(now) };
    const semanaPasada = { inicio: addDays(semanaActual.inicio, -7), fin: addDays(semanaActual.fin, -7) };
    const semanaProxima = { inicio: addDays(semanaActual.inicio, 7), fin: addDays(semanaActual.fin, 7) };

    const [rwSA, rwSP] = await Promise.all([weeklyReal(semanaActual.inicio, semanaActual.fin), weeklyReal(semanaPasada.inicio, semanaPasada.fin)]);

    return reply.send({
      ok: true,
      proyecto,
      financiero: {
        base, costos,
        devengado: {
          devengado: devengadoAcumulado,
          avancePct: Math.round(avanceActual01 * 10000) / 100,
          utilidadDevengada: Math.max(0, devengadoAcumulado - costoAcumulado),
          faltanteParaEquilibrio: Math.max(0, costoAcumulado - devengadoAcumulado),
          yaPasoCosto: devengadoAcumulado >= costoAcumulado,
          breakevenPct: null,
        },
      },
      tareas: {
        avancePct: Math.round(avanceActual01 * 10000) / 100,
        conteo: {
          total: tareas.length,
          completadas: tareas.filter(t => String(t.estado).toLowerCase() === "completa" || t.avance >= 100).length,
          enSemanaActual: tareas.filter(t => t.fecha_inicio_plan && t.fecha_fin_plan && overlapDays(t.fecha_inicio_plan, t.fecha_fin_plan, semanaActual.inicio, semanaActual.fin) > 0).length,
          atrasadas: tareas.filter(t => {
            const done = String(t.estado).toLowerCase() === "completa" || t.avance >= 100;
            return !done && t.fecha_fin_plan && new Date(t.fecha_fin_plan) < semanaActual.inicio;
          }).length,
        },
        // La página usa data.tareas_all para la tabla de tareas
      },
      compras: comprasList,
      empleados: empleadosList,
      weekly: {
        semanaActual: { plan: weeklyPlanned(semanaActual.inicio, semanaActual.fin), real: rwSA },
        semanaPasada: { plan: weeklyPlanned(semanaPasada.inicio, semanaPasada.fin), real: rwSP },
        semanaProxima: { plan: weeklyPlanned(semanaProxima.inicio, semanaProxima.fin), real: { devengadoSemana: 0 } },
        history: weeklyHistory,
        daily: weeklyHistory,
      },
      // Campo que usa la tabla de tareas en el frontend
      tareas_all: tareas,
      notas: [
        `Rango del proyecto: ${minDate.toLocaleDateString("es-CL")} → ${maxDate.toLocaleDateString("es-CL")}`,
        `Semanas generadas: ${weeklyHistory.length}`,
        `Avance ponderado: ${Math.round(avanceActual01 * 100)}%`,
      ]
    });
  } catch (err) {
    console.error("ERROR EN DEVENGADO:", err);
    return reply.code(500).send({ ok: false, error: err.message, debug_id: "NEW_FILE_V2" });
  }
}
