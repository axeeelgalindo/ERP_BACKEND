import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

console.log("!!! DEVENGADO_NEW.JS LOADED !!!");

/** ===== Helpers fecha (Lun-Dom) ===== */
function startOfWeekMonday(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
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

function taskWeight(t) {
  const costo = Number(t.total_costo_plan);
  if (Number.isFinite(costo) && costo > 0) return costo;
  const horas = Number(t.total_horas_plan);
  if (Number.isFinite(horas) && horas > 0) return horas;
  const dias = Number(t.dias_plan);
  if (Number.isFinite(dias) && dias > 0) return dias;
  return 1;
}

function pickBaseMoney(cot, base) {
  const vendido = Number(cot?.subtotal || 0);
  const cotizado = Number(cot?.total || 0);
  const b = String(base || "VENTA").toUpperCase();
  const monto = b === "COTIZADO" ? cotizado : vendido;
  return { fuente: b, valor: monto, valorVendido: vendido, valorCotizado: cotizado };
}

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
  let sumW = 0, sumWA = 0;
  for (const t of tareas) {
    const w = weightsById.get(t.id) || 1;
    const a100 = map.has(t.id) ? map.get(t.id) : Number(t.avance || 0);
    const a01 = pct01From100(a100);
    sumW += w; sumWA += w * a01;
  }
  return sumW > 0 ? sumWA / sumW : 0;
}

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

export async function reporteDevengadoProfesional(request, reply) {
  try {
    console.log("REPORTE_DEVENGADO_PROFESIONAL EXECUTED FROM NEW FILE");
    const proyectoId = request.params.id;
    const baseParam = (request.query.base || "VENTA").toUpperCase();

    const proyecto = await prisma.proyecto.findFirst({
      where: { id: proyectoId, eliminado: false },
      select: {
        id: true, nombre: true, estado: true,
        fecha_inicio_plan: true, fecha_fin_plan: true,
        epicas: {
          where: { eliminado: false },
          select: { id: true, nombre: true, avance: true, estado: true }
        }
      },
    });
    if (!proyecto) return reply.code(404).send({ ok: false, error: "Proyecto no encontrado" });

    const cotizacion = await prisma.cotizacion.findFirst({
      where: { proyecto_id: proyectoId, eliminado: false, estado: "ACEPTADA" },
      orderBy: { fecha_documento: "desc" },
      include: { ventas: { include: { detalles: true } } }
    });

    let margenObjetivo = 0, costoPlan = 0;
    if (cotizacion?.ventas?.[0]) {
      const v = cotizacion.ventas[0];
      margenObjetivo = v.utilidadObjetivoPct || 0;
      costoPlan = v.detalles.reduce((acc, d) => acc + (d.costoTotal || 0), 0);
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
      ...t, tipo: t.jira_tipo || "Tarea",
      nombre: t.jira_key ? `${t.jira_key} ${t.nombre || ""}`.trim() : (t.nombre || "Sin nombre"),
    }));

    const weightsById = new Map();
    let sumW = 0;
    for (const t of tareas) {
      const w = taskWeight(t); weightsById.set(t.id, w); sumW += w;
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

    const costos = {
      totalCompras: comprasList.reduce((acc, c) => acc + c.total, 0),
      valorHHReal: hhCostoReal,
      costoAcumulado: Math.max(costoPlan, comprasList.reduce((acc, c) => acc + c.total, 0) + hhCostoReal),
      costoPlan,
    };

    const weeklyHistory = [];
    const now = new Date();
    const historyEnd = new Date(Math.max(now.getTime(), (proyecto.fecha_fin_plan || now).getTime()));
    let curr = startOfWeekMonday(now); // Start from now for simplicity in this debug step
    for (let i = 1; i <= 8; i++) {
        weeklyHistory.push({
            num: i, label: `W${i}`, day: `W${i}`,
            plan: { amount: Math.round(base.valor / 8) },
            real: { devengadoSemana: 0 },
            ingreso: 0, costo: costos.costoAcumulado / 8
        });
    }

    return reply.send({
      ok: true, proyecto, financiero: {
        base, costos, devengado: {
          devengado: devengadoAcumulado, avancePct: Math.round(avanceActual01 * 10000) / 100,
          utilidadDevengada: Math.max(0, devengadoAcumulado - costos.costoAcumulado),
          faltanteParaEquilibrio: Math.max(0, costos.costoAcumulado - devengadoAcumulado),
          yaPasoCosto: devengadoAcumulado >= costos.costoAcumulado
        },
      },
      tareas: { conteo: { enSemanaActual: 0 } },
      compras: comprasList, weekly: { history: weeklyHistory }
    });
  } catch (err) {
    console.error("ERROR IN NEW CONTROLLER:", err);
    return reply.code(500).send({ ok: false, error: err.message, debug_id: "NEW_FILE_V1" });
  }
}
