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

function pickBaseMoney(cotizaciones = [], baseParam) {
  const b = String(baseParam || "VENTA").toUpperCase();
  
  let totalVendido = 0;
  let totalSubtotal = 0;

  cotizaciones.forEach(c => {
    totalVendido += Number(c.total || 0);
    totalSubtotal += Number(c.subtotal || 0);
  });

  const monto = b === "COTIZADO" ? totalVendido : totalVendido; // Por ahora ambos usan total si base es VENTA
  return { fuente: b, valor: monto, valorVendido: totalVendido, valorSubtotal: totalSubtotal };
}

export async function reporteDevengadoProfesional(request, reply) {
  try {
    const proyectoId = request.params.id;
    const baseParam = (request.query.base || "VENTA").toUpperCase();

    const info = await buscarInfoProyecto(proyectoId);
    if (!info) return reply.code(404).send({ ok: false, error: "Proyecto no encontrado" });

    const { proyecto, cotizaciones = [], tareas: tareasRaw, compras: comprasRaw, rendiciones, miembros } = info;
    const moneyBase = pickBaseMoney(cotizaciones, baseParam);

    let margenObjetivo = 0;
    let costoPlan = Number(proyecto?.presupuesto || 0);
    let costoPlanHH = 0;
    let costoPlanCompras = 0;
    let totalHorasPlan = 0;

    // Agregamos datos de todas las ventas asociadas a las cotizaciones
    let totalCostoVentas = 0;
    let countVentas = 0;
    let sumMargen = 0;

    cotizaciones.forEach(c => {
      (c.ventas || []).forEach(v => {
        countVentas++;
        sumMargen += (v.utilidadObjetivoPct || 0);
        
        const hhDetalles = v.detalles.filter(d => String(d.modo).toUpperCase() === 'HH');
        costoPlanHH += hhDetalles.reduce((acc, d) => acc + (d.costoTotal || 0), 0);
        totalHorasPlan += hhDetalles.reduce((acc, d) => acc + (d.cantidad || 0), 0);
        
        const compraDetalles = v.detalles.filter(d => String(d.modo).toUpperCase() === 'COMPRA');
        costoPlanCompras += compraDetalles.reduce((acc, d) => acc + (d.costoTotal || 0), 0);

        totalCostoVentas += v.detalles.reduce((acc, d) => acc + (d.costoTotal || 0), 0);
      });
    });

    if (countVentas > 0) {
      margenObjetivo = sumMargen / countVentas; // Promedio simple de márgenes
    }

    // Si el proyecto no tiene presupuesto seteado, calculamos desde el costeo de las ventas
    if (costoPlan === 0) {
      costoPlan = totalCostoVentas;
    }

    const base = { ...moneyBase, margenObjetivo, costoPlan, costoPlanHH, costoPlanCompras };

    // ===== Compras y Costos =====
    const comprasList = comprasRaw.map(c => ({
      numero: c.numero, fecha: c.fecha_docto,
      proveedor: c.proveedor?.nombre || "Sin proveedor",
      estado: c.estado, total: c.total, factura_url: c.factura_url, tipo_doc: c.tipo_doc
    }));

    let pptoUtilizadoReal = comprasRaw.reduce((acc, c) => {
      const est = (c.estado || "").toUpperCase();
      // Incluir también "ACEPTADA" o similares si son compras en proceso pero que ya restan?
      // El usuario dice "ppto compras = sumatoria(compras tipo_doc = 33 y 34)) - sumatoria (compras tipo_doc = 61)"
      // No especificó estado, pero usualmente son las emitidas/pagadas.
      if (est !== "FACTURADA" && est !== "PAGADA" && est !== "PAGADO" && est !== "ACEPTADA") return acc;
      
      const td = Number(c.tipo_doc);
      if (td === 61) return acc - (c.total || 0);
      if ([33, 34].includes(td)) return acc + (c.total || 0);
      return acc;
    }, 0);

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

    const totalCompras = comprasList.reduce((acc, c) => {
      const td = Number(c.tipo_doc);
      if (td === 61) return acc - (c.total || 0);
      return acc + (c.total || 0);
    }, 0);
    const totalRendiciones = rendiciones.reduce((acc, r) => acc + (r.monto_total || 0), 0);
    const costoAcumulado = totalCompras + totalRendiciones + hhCostoReal;

    const costos = {
      totalCompras, totalRendiciones, valorHHReal: hhCostoReal,
      costoAcumulado, costoPlan, pptoUtilizadoReal,
      costoPlanCompras,
      hhPlan: { horas: totalHorasPlan, costo: costoPlanHH }
    };

    // ===== Equipo =====
    const empleadosList = miembros.map(m => {
      const e = m.empleado;
      const u = e?.usuario;
      const nombre = u?.nombre || "Usuario";
      return {
        id: e?.id,
        nombre,
        cargo: e?.cargo || m.rol || "Miembro"
      };
    });

    const now = new Date();
    // ===== Date helpers locales =====
    // ===== Date helpers locales =====
    const calculatePlannedProgress = (item, refDate) => {
      if (!item.fecha_inicio_plan || !item.fecha_fin_plan) return 0;
      const s = new Date(item.fecha_inicio_plan);
      const e = new Date(item.fecha_fin_plan);
      const q = new Date(refDate);
      if (q < s) return 0;
      const total = Math.max(1, (e - s) / 86400000 + 1);
      const elap = Math.max(0, (Math.min(q, e) - s) / 86400000 + 1);
      return Math.min(1, elap / total);
    };

    // ===== Pesos y Avance Ponderado =====
    
    // Función central para calcular peso de un item
    const getPesoItem = (item) => {
      const costo = Number(item.costo_plan || item.total_costo_plan || 0);
      if (costo > 0) return costo;
      const horas = Number(item.horas_plan || item.total_horas_plan || 0);
      if (horas > 0) return horas; // Podríamos multiplicar por un valor_hora promedio si quisiéramos
      const dias = Number(item.dias_plan || 0);
      if (dias > 0) return dias;
      return 1; // Fallback mínimo para evitar divisiones por cero
    };

    // 1. Procesar Tareas y Subtareas
    const tareasProcesadas = tareasRaw.map(t => {
      const subtasks = t.detalles || [];
      let sumSubW = 0;
      let sumSubWeightedAvance = 0;
      let sumSubWeightedPlan = 0;

      const detalles = subtasks.map(d => {
        const w = getPesoItem(d);
        sumSubW += w;
        const subAvance = Number(d.avance || 0);
        const subPlan = calculatePlannedProgress(d, now) * 100;
        sumSubWeightedAvance += w * subAvance;
        sumSubWeightedPlan += w * subPlan;
        
        return {
          ...d,
          peso: w,
          avance_real_pct: subAvance,
          avance_plan_pct: Math.round(subPlan * 100) / 100,
          fecha_inicio_plan: d.fecha_inicio_plan,
          fecha_fin_plan: d.fecha_fin_plan,
          fecha_inicio_real: d.fecha_inicio_real,
          fecha_fin_real: d.fecha_fin_real,
        };
      });

      // Avance ponderado de la tarea
      const hasSubtasks = detalles.length > 0;
      const avance_real_pct = hasSubtasks 
        ? Math.round((sumSubWeightedAvance / (sumSubW || 1)) * 100) / 100 
        : Number(t.avance || 0);
      
      const avance_plan_pct = hasSubtasks
        ? Math.round((sumSubWeightedPlan / (sumSubW || 1)) * 100) / 100
        : Math.round(calculatePlannedProgress(t, now) * 10000) / 100;

      const peso = sumSubW > 0 ? sumSubW : getPesoItem(t);

      return {
        ...t,
        detalles,
        avance_real_pct,
        avance_plan_pct,
        peso,
        fecha_inicio_plan: t.fecha_inicio_plan,
        fecha_fin_plan: t.fecha_fin_plan,
        fecha_inicio_real: t.fecha_inicio_real,
        fecha_fin_real: t.fecha_fin_real,
      };
    });

    // 2. Agrupar en Épicas y Calcular su Avance Ponderado
    const epicasMap = new Map();
    (proyecto.epicas || []).forEach(e => epicasMap.set(e.id, { ...e, tareas: [] }));
    const tareasSinEpica = [];
    
    tareasProcesadas.forEach(t => {
      if (t.epica_id && epicasMap.has(t.epica_id)) epicasMap.get(t.epica_id).tareas.push(t);
      else tareasSinEpica.push(t);
    });

    const epicasJerarquia = Array.from(epicasMap.values()).map(e => {
      const sumTaskW = e.tareas.reduce((acc, t) => acc + t.peso, 0);
      const sumTaskWeightedAvance = e.tareas.reduce((acc, t) => acc + (t.avance_real_pct * t.peso), 0);
      const sumTaskWeightedPlan = e.tareas.reduce((acc, t) => acc + (t.avance_plan_pct * t.peso), 0);

      const avance_real_pct = e.tareas.length > 0
        ? Math.round((sumTaskWeightedAvance / (sumTaskW || 1)) * 100) / 100
        : Number(e.avance || 0);
      
      const avance_plan_pct = e.tareas.length > 0
        ? Math.round((sumTaskWeightedPlan / (sumTaskW || 1)) * 100) / 100
        : Math.round(calculatePlannedProgress(e, now) * 10000) / 100;

      const peso = sumTaskW > 0 ? sumTaskW : (Number(e.dias_plan || 0) || 1);

      return {
        ...e,
        avance_real_pct,
        avance_plan_pct,
        peso,
        tareas: e.tareas,
        fecha_inicio_plan: e.fecha_inicio_plan,
        fecha_fin_plan: e.fecha_fin_plan,
        fecha_inicio_real: e.fecha_inicio_real,
        fecha_fin_real: e.fecha_fin_real,
      };
    });

    // Épica virtual para tareas sin épica
    if (tareasSinEpica.length > 0) {
      const sumW = tareasSinEpica.reduce((acc, t) => acc + t.peso, 0);
      const sumWeightedAvance = tareasSinEpica.reduce((acc, t) => acc + (t.avance_real_pct * t.peso), 0);
      const sumWeightedPlan = tareasSinEpica.reduce((acc, t) => acc + (t.avance_plan_pct * t.peso), 0);
      
      epicasJerarquia.push({
        id: "sin-epica",
        nombre: "Tareas Generales",
        avance_real_pct: Math.round((sumWeightedAvance / (sumW || 1)) * 100) / 100,
        avance_plan_pct: Math.round((sumWeightedPlan / (sumW || 1)) * 100) / 100,
        peso: sumW || 1,
        tareas: tareasSinEpica,
        fecha_inicio_plan: null,
        fecha_fin_plan: null,
      });
    }

    // 3. Calcular Avance Total del Proyecto
    const totalW = epicasJerarquia.reduce((acc, e) => acc + e.peso, 0);
    const totalWeightedAvance = epicasJerarquia.reduce((acc, e) => acc + (e.avance_real_pct * e.peso), 0);
    const totalWeightedPlan = epicasJerarquia.reduce((acc, e) => acc + (e.avance_plan_pct * e.peso), 0);

    const avanceActual01 = totalW > 0 ? (totalWeightedAvance / totalW) / 100 : 0;
    const avancePlan01 = totalW > 0 ? (totalWeightedPlan / totalW) / 100 : 0;

    const devengadoAcumulado = Math.round(base.valor * avanceActual01);
    const devengadoProyectado = Math.round(base.valor * avancePlan01);

    // 4. Enriquecer con Datos Financieros Finales (Distribución de Ingresos)
    const enrichFinancieramente = (node) => {
      const pRaw = totalW > 0 ? (node.peso || 0) / totalW : 0;
      const participacion = isFinite(pRaw) ? pRaw : 0;
      const devengado_asignado = Math.round(base.valor * participacion);
      
      const enr = {
        ...node,
        avance: node.avance_real_pct, 
        participacion,
        devengado_asignado,
        devengado_real: Math.round(devengado_asignado * (node.avance_real_pct / 100)),
        devengado_plan: Math.round(devengado_asignado * (node.avance_plan_pct / 100)),
        desviacion_pct: Math.round((node.avance_real_pct - node.avance_plan_pct) * 100) / 100
      };

      if (enr.tareas && enr.tareas.length > 0) {
        enr.tareas = enr.tareas.map(t => enrichFinancieramente(t));
      }
      if (enr.detalles && enr.detalles.length > 0) {
        const tSumW = enr.detalles.reduce((acc, d) => acc + (d.peso || 0), 0);
        enr.detalles = enr.detalles.map(d => {
          const sPRaw = tSumW > 0 ? (d.peso || 0) / tSumW : 0;
          const subPart = isFinite(sPRaw) ? sPRaw : 0;
          const subAsignado = Math.round(devengado_asignado * subPart);
          return {
            ...d,
            participacion: subPart,
            devengado_asignado: subAsignado,
            devengado_real: Math.round(subAsignado * (d.avance_real_pct / 100)),
            devengado_plan: Math.round(subAsignado * (d.avance_plan_pct / 100)),
            desviacion_pct: Math.round((d.avance_real_pct - d.avance_plan_pct) * 100) / 100
          };
        });
      }
      return enr;
    };

    const jerarquiaEnriquecida = epicasJerarquia.map(e => enrichFinancieramente(e));

    // ===== Historial Semanal =====
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
    const plotStart = startOfWeekMonday(minDate || addDays(now, -14));
    const plotEnd = endOfWeekSunday(new Date(Math.max(now.getTime(), (maxDate || now).getTime())));

    const weeklyHistory = [];
    let curr = new Date(plotStart);
    let iter = 1;
    let prev = { pAmt: 0, rAmt: 0 };
    const tareaIds = tareasRaw.map(t => t.id);
    let maxRealPctSoFar = 0;

    while (curr <= plotEnd && iter <= 52) {
      const d = endOfWeekSunday(curr);
      
      // 1. Planificado Ponderado en la fecha d
      let sumWeightedPlan = 0;

      for (const t of tareasProcesadas) {
        let tPlan = 0;
        if (t.detalles && t.detalles.length > 0) {
          let sW = 0; let sWP = 0;
          for (const det of t.detalles) {
            const w = det.peso;
            sW += w;
            sWP += w * (calculatePlannedProgress(det, d) * 100);
          }
          tPlan = sW > 0 ? sWP / sW : 0;
        } else {
          tPlan = calculatePlannedProgress(t, d) * 100;
        }
        sumWeightedPlan += t.peso * (tPlan / 100); // Convert tPlan back to 0-1 range
      }
      const pPct = totalW > 0 ? sumWeightedPlan / totalW : 0;

      // 2. Real Ponderado en la fecha d (historial de tareas)
      const [rows] = await Promise.all([
        prisma.$queryRaw`SELECT DISTINCT ON (tarea_id) tarea_id, to_avance FROM "TareaHistorial" WHERE proyecto_id = ${proyectoId} AND tarea_id = ANY(${tareaIds}) AND occurred_at <= ${d} AND to_avance IS NOT NULL ORDER BY tarea_id, occurred_at DESC`,
      ]);
      const mapA = new Map(rows.map(r => [r.tarea_id, Number(r.to_avance)]));
      
      let sumWeightedReal_P = 0;
      for (const t of tareasProcesadas) {
        let tReal = 0;
        
        if (t.detalles && t.detalles.length > 0) {
          let sW = 0; let sWR = 0;
          for (const det of t.detalles) {
            const w = det.peso;
            sW += w;
            
            let rAvance = mapA.get(det.id) ?? null;
            if (rAvance === null) {
              const sR = det.fecha_inicio_real ? new Date(det.fecha_inicio_real) : null;
              const eR = det.fecha_fin_real ? new Date(det.fecha_fin_real) : null;
              if (sR && eR) {
                if (d >= eR) rAvance = det.avance_real_pct;
                else if (d < sR) rAvance = 0;
                else {
                  const totalDays = Math.max(1, (eR - sR) / 86400000);
                  const elapsedDays = Math.max(0, (d - sR) / 86400000);
                  rAvance = (elapsedDays / totalDays) * det.avance_real_pct;
                }
              } else {
                rAvance = 0;
              }
            }
            sWR += w * rAvance;
          }
          tReal = sW > 0 ? sWR / sW : 0;
        } else {
          let rAvance = mapA.get(t.id) ?? null;
          if (rAvance === null) {
            const sR = t.fecha_inicio_real ? new Date(t.fecha_inicio_real) : null;
            const eR = t.fecha_fin_real ? new Date(t.fecha_fin_real) : null;
            if (sR && eR) {
              if (d >= eR) rAvance = t.avance_real_pct;
              else if (d < sR) rAvance = 0;
              else {
                const totalDays = Math.max(1, (eR - sR) / 86400000);
                const elapsedDays = Math.max(0, (d - sR) / 86400000);
                rAvance = (elapsedDays / totalDays) * t.avance_real_pct;
              }
            } else {
              rAvance = 0;
            }
          }
          tReal = rAvance;
        }
        sumWeightedReal_P += t.peso * (tReal / 100);
      }
      let rPct = totalW > 0 ? sumWeightedReal_P / totalW : 0;
      
      // Garantizar que la curva real sea acumulativa (no decreciente)
      if (rPct > maxRealPctSoFar) maxRealPctSoFar = rPct;
      else rPct = maxRealPctSoFar;

      const pAmt = Math.round(base.valor * pPct);
      const rAmt = Math.round(base.valor * rPct);

      weeklyHistory.push({
        num: iter, label: `S${iter}`, mes: curr.toLocaleDateString("es-CL", { month: "short" }).toUpperCase(),
        planValue: pAmt, realValue: rAmt,
        avance_plan_acumulado: Math.round(pPct * 10000)/100,
        avance_real_acumulado: Math.round(rPct * 10000)/100,
        devengado_plan_semanal: Math.max(0, pAmt - prev.pAmt),
        devengado_real_semanal: Math.max(0, rAmt - prev.rAmt),
        semana: iter
      });
      prev = { pAmt, rAmt };
      curr.setDate(curr.getDate() + 7);
      iter++;
    }

    return reply.send({
      ok: true,
      proyecto: { ...proyecto, epicas: jerarquiaEnriquecida },
      financiero: {
        base, costos,
        devengado: {
          devengado: devengadoAcumulado,
          devengado_proyectado: devengadoProyectado,
          avancePct: Math.round(avanceActual01 * 10000) / 100,
          avancePlanPct: Math.round(avancePlan01 * 10000) / 100,
          desviacion_devengado: devengadoAcumulado - devengadoProyectado,
          desviacion_avance: Math.round((avanceActual01 - avancePlan01) * 10000) / 100,
          saludPct: Math.round(avanceActual01 * 100),
        }
      },
      compras: comprasList,
      empleados: empleadosList,
      weekly: { history: weeklyHistory }
    });
  } catch (err) {
    console.error("ERROR DEVENGADO:", err);
    return reply.code(500).send({ ok: false, error: err.message });
  }
}
