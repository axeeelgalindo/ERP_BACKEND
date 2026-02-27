// src/controllers/proyectos.controller.js
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PAGE = 1,
  SIZE = 20;

/* helpers generales */
const randCode = () => String(Math.floor(100000 + Math.random() * 900000)); // 6 dígitos

const toFloatOrNull = (v) => {
  if (typeof v === "number") return v;
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

/* ========== LISTAR ========== */
export async function listProyectos(request, reply) {
  const scope = resolveScope(request);
  const {
    q = "",
    estado = "",
    page = PAGE,
    pageSize = SIZE,
    includeDeleted = "false",
    empresaId,
    sort = "creada_en",
    order = "desc",
  } = request.query || {};

  const empresa_id = scope.isMaster
    ? empresaId || scope.empresaId
    : scope.empresaId;

  const where = {
    empresa_id,
    ...(includeDeleted !== "true" ? { eliminado: false } : {}),
    ...(q
      ? {
          OR: [
            { nombre: { contains: q, mode: "insensitive" } },
            { descripcion: { contains: q, mode: "insensitive" } },
            { id: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(estado ? { estado } : {}),
  };

  const allowedSort = [
    "creada_en",
    "actualizado_en",
    "nombre",
    "estado",
    "presupuesto",
    "fecha_inicio_plan",
    "fecha_fin_plan",
    "fecha_inicio_real",
    "fecha_fin_real",
  ];
  const sortField = allowedSort.includes(String(sort)) ? sort : "creada_en";
  const sortDir = String(order).toLowerCase() === "asc" ? "asc" : "desc";

  const skip = Math.max(0, (Number(page) - 1) * Number(pageSize));
  const take = Math.min(100, Number(pageSize) || SIZE);

  const [total, items] = await Promise.all([
    prisma.proyecto.count({ where }),
    prisma.proyecto.findMany({
      where,
      orderBy: { [sortField]: sortDir },
      include: {
        cotizaciones: {
          where: { eliminado: false },
          include: {
            cliente: true,
            ventas: true,
          },
        },
      },
      skip,
      take,
    }),
  ]);

  return reply.send({ total, page: Number(page), pageSize: take, items });
}

/* ========== DETALLE ========== */
export async function getProyecto(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const where = {
    id,
    eliminado: false,
    empresa: { eliminado: false },
    ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }),
  };

  const row = await prisma.proyecto.findFirst({
    where,
    include: {
      tareas: {
        where: { eliminado: false },
        orderBy: [{ orden: "asc" }, { fecha_inicio_plan: "asc" }],
        include: {
          // ✅ PARA MOSTRAR NOMBRE DE ÉPICA EN FRONTEND (GANTT)
          epica: { select: { id: true, nombre: true } },

          responsable: { include: { usuario: true } },
          detalles: {
            where: { eliminado: false },
            orderBy: [{ fecha_inicio_plan: "asc" }],
            include: {
              responsable: {
                include: {
                  usuario: { select: { nombre: true, correo: true } },
                },
              },
            },
          },
        },
      },
      miembros: {
        include: {
          empleado: {
            include: { usuario: true },
          },
        },
      },
      cotizaciones: true,
      compras: { where: { eliminado: false } },
      rendiciones: { where: { eliminado: false } },
    },
  });

  if (!row) return httpError(reply, 404, "Proyecto no encontrado");
  if (!scope.isMaster && row.empresa_id !== scope.empresaId) {
    return httpError(reply, 403, "Proyecto fuera de tu empresa");
  }

  // ====== TAREAS Y SUBTAREAS ======
  const tareas = row.tareas || [];
  const subtareas = tareas.flatMap((t) => t.detalles || []);

  // HH PLAN
  const valorHHPlan = subtareas.reduce((sum, d) => {
    const costoPlanDirecto = d.costo_plan ?? null;
    const costoPlanCalc =
      d.horas_plan != null && d.valor_hora != null ? d.horas_plan * d.valor_hora : 0;
    const costoPlan = costoPlanDirecto != null ? costoPlanDirecto : costoPlanCalc;
    return sum + (costoPlan || 0);
  }, 0);

  // HH REAL
  const valorHHReal = subtareas.reduce((sum, d) => {
    const costoRealDirecto = d.costo_real ?? null;
    const costoRealCalc =
      d.horas_real != null && d.valor_hora != null ? d.horas_real * d.valor_hora : 0;
    const costoReal = costoRealDirecto != null ? costoRealDirecto : costoRealCalc;
    return sum + (costoReal || 0);
  }, 0);

  // ====== FINANCIERO ======
  const ventas = [];
  const compras = row.compras || [];
  const rendiciones = row.rendiciones || [];

  const totalVentas = ventas.reduce((sum, v) => sum + (v.total ?? 0), 0);
  const totalCompras = compras.reduce((sum, c) => sum + (c.total ?? 0), 0);
  const totalRendiciones = rendiciones.reduce((sum, r) => sum + (r.monto_total ?? 0), 0);

  const presupuesto = row.presupuesto ?? 0;

  const costoTotal = totalCompras + totalRendiciones + valorHHReal;
  const margenBruto = totalVentas - (totalCompras + valorHHReal);
  const utilidadNeta = totalVentas - costoTotal;

  const presupuestoUsado = costoTotal;
  const presupuestoRestante = presupuesto - presupuestoUsado;

  const margenBrutoPct = totalVentas > 0 ? (margenBruto / totalVentas) * 100 : 0;
  const utilidadNetaPct = totalVentas > 0 ? (utilidadNeta / totalVentas) * 100 : 0;
  const usoPresupuestoPct = presupuesto > 0 ? (presupuestoUsado / presupuesto) * 100 : 0;

  // ====== MÉTRICAS TAREAS ======
  const totalTareas = tareas.length;
  const tareasCompletas = tareas.filter((t) => t.estado === "completa" || (t.avance ?? 0) >= 100).length;
  const tareasEnCurso = tareas.filter(
    (t) => t.estado === "en_progreso" || ((t.avance ?? 0) > 0 && (t.avance ?? 0) < 100)
  ).length;
  const tareasPendientes = totalTareas - tareasCompletas - tareasEnCurso;

  const avancePromedio =
    totalTareas > 0
      ? Math.round(tareas.reduce((sum, t) => sum + (t.avance ?? 0), 0) / totalTareas)
      : 0;

  const porcentajeCompletado = totalTareas > 0 ? Math.round((tareasCompletas / totalTareas) * 100) : 0;

  const costoPromedioPorTarea = totalTareas > 0 ? costoTotal / totalTareas : 0;
  const ventaPromedioPorTarea = totalTareas > 0 ? totalVentas / totalTareas : 0;

  const metrics = {
    financiero: {
      totalVentas,
      totalCompras,
      totalRendiciones,
      costoTotal,
      margenBruto,
      utilidadNeta,
      presupuesto,
      presupuestoUsado,
      presupuestoRestante,
      margenBrutoPct,
      utilidadNetaPct,
      usoPresupuestoPct,
      valorHHPlan,
      valorHHReal,
    },
    tareas: {
      totalTareas,
      tareasCompletas,
      tareasEnCurso,
      tareasPendientes,
      avancePromedio,
      porcentajeCompletado,
      costoPromedioPorTarea,
      ventaPromedioPorTarea,
    },
    clientePrincipal: null,
  };

  return reply.send({ ok: true, row, metrics });
}

export async function createProyecto(req, reply) {
  try {
    const scope = resolveScope(req);

    req.log.info(
      {
        ct: req.headers["content-type"],
        bodyType: typeof req.body,
        body: req.body,
      },
      "CREATE_PROYECTO_IN"
    );

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const payload =
      body?.proyecto && typeof body.proyecto === "object" ? body.proyecto : body;

    const nombre = payload?.nombre;
    const descripcion = payload?.descripcion;
    const presupuesto = payload?.presupuesto;

    // ✅ soporta ambos nombres (tu frontend manda "miembros")
    const miembrosIds = Array.isArray(payload?.miembrosIds)
      ? payload.miembrosIds
      : Array.isArray(payload?.miembros)
      ? payload.miembros
      : [];

    if (!String(nombre || "").trim()) {
      return reply.code(400).send({
        message: "Nombre es obligatorio",
        debug: {
          ct: req.headers["content-type"],
          bodyKeys: Object.keys(body || {}),
          payloadKeys: Object.keys(payload || {}),
        },
      });
    }

    const empresa_id = scope?.empresaId;
    if (!empresa_id) {
      return reply
        .code(401)
        .send({ message: "No autorizado (empresa_id no encontrado)" });
    }

    const presupuestoNum =
      presupuesto == null || presupuesto === "" ? 0 : Number(presupuesto);

    const proyecto = await prisma.proyecto.create({
      data: {
        empresa_id,
        nombre: String(nombre).trim(),
        descripcion: descripcion ? String(descripcion).trim() : null,
        presupuesto: Number.isFinite(presupuestoNum) ? presupuestoNum : 0,

        // ✅ crea ProyectoMiembro
        ...(miembrosIds.length
          ? {
              miembros: {
                create: miembrosIds.map((empleado_id) => ({ empleado_id })),
              },
            }
          : {}),
      },
      include: {
        miembros: { include: { empleado: { include: { usuario: true } } } },
      },
    });

    return reply.code(201).send({ ok: true, proyecto });
  } catch (err) {
    req.log.error({ err }, "Error creando proyecto");
    return reply.code(500).send({
      message: "Error creando proyecto",
      error: err?.message,
    });
  }
}


export async function updateProyecto(request, reply) {
  const scope = resolveScope(request);
  const id = request.params.id;

  const body = request.body && typeof request.body === "object" ? request.body : {};

  const exists = await prisma.proyecto.findUnique({
    where: { id },
    select: { id: true, empresa_id: true, eliminado: true },
  });

  if (!exists) return httpError(reply, 404, "Proyecto no encontrado");
  if (exists.eliminado) return httpError(reply, 409, "Proyecto está deshabilitado");
  if (!scope.isMaster && exists.empresa_id !== scope.empresaId) {
    return httpError(reply, 403, "Proyecto fuera de tu empresa");
  }

  // ✅ whitelist campos editables
  const data = {};
  if (typeof body.nombre === "string") data.nombre = body.nombre.trim();
  if (typeof body.descripcion === "string") data.descripcion = body.descripcion.trim() || null;
  if (body.descripcion === null) data.descripcion = null;

  if (body.presupuesto === null) data.presupuesto = null;
  if (typeof body.presupuesto === "number") data.presupuesto = body.presupuesto;

  // (opcional) permitir editar estado/fechas si lo usas
  if (typeof body.estado === "string") data.estado = body.estado;
  if (body.fecha_inicio_plan) data.fecha_inicio_plan = new Date(body.fecha_inicio_plan);
  if (body.fecha_fin_plan) data.fecha_fin_plan = new Date(body.fecha_fin_plan);

  // seguridad: empresa_id no se toca si no es master
  if (data.empresa_id && !scope.isMaster) delete data.empresa_id;

  // ✅ miembros
  const miembros = Array.isArray(body.miembros) ? body.miembros.filter(Boolean) : null;

  const row = await prisma.$transaction(async (tx) => {
    const upd = await tx.proyecto.update({ where: { id }, data });

    if (miembros) {
      await tx.proyectoMiembro.deleteMany({ where: { proyecto_id: id } });
      if (miembros.length) {
        await tx.proyectoMiembro.createMany({
          data: miembros.map((empleado_id) => ({ proyecto_id: id, empleado_id })),
          skipDuplicates: true,
        });
      }
    }

    return upd;
  });

  return reply.send({ ok: true, row });
}

/* ========== ✅ INICIAR PROYECTO (fecha real) ========== */
export async function iniciarProyecto(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const p = await prisma.proyecto.findUnique({
    where: { id },
    select: {
      id: true,
      empresa_id: true,
      eliminado: true,
      fecha_inicio_real: true,
      fecha_fin_real: true,
    },
  });

  if (!p) return httpError(reply, 404, "Proyecto no encontrado");
  if (p.eliminado) return httpError(reply, 409, "Proyecto está deshabilitado");
  if (!scope.isMaster && p.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Proyecto fuera de tu empresa");

  if (p.fecha_inicio_real) return httpError(reply, 400, "El proyecto ya está iniciado");
  if (p.fecha_fin_real) return httpError(reply, 400, "El proyecto ya está finalizado");

  const upd = await prisma.proyecto.update({
    where: { id },
    data: {
      fecha_inicio_real: new Date(),
      // opcional: estado si quieres
      estado: p.estado === "activo" ? "en_progreso" : p.estado,
    },
  });

  return reply.send({ ok: true, row: upd });
}

/* ========== ✅ FINALIZAR PROYECTO (fecha real) ========== */
export async function finalizarProyecto(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const p = await prisma.proyecto.findUnique({
    where: { id },
    select: {
      id: true,
      empresa_id: true,
      eliminado: true,
      fecha_inicio_real: true,
      fecha_fin_real: true,
    },
  });

  if (!p) return httpError(reply, 404, "Proyecto no encontrado");
  if (p.eliminado) return httpError(reply, 409, "Proyecto está deshabilitado");
  if (!scope.isMaster && p.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Proyecto fuera de tu empresa");

  if (!p.fecha_inicio_real)
    return httpError(reply, 400, "No puedes finalizar un proyecto que no ha sido iniciado");
  if (p.fecha_fin_real) return httpError(reply, 400, "El proyecto ya está finalizado");

  const upd = await prisma.proyecto.update({
    where: { id },
    data: {
      fecha_fin_real: new Date(),
      // opcional: estado si quieres
      estado: "finalizado",
    },
  });

  return reply.send({ ok: true, row: upd });
}

/* ========== SOFT DELETE ========== */
export async function disableProyecto(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const p = await prisma.proyecto.findUnique({
    where: { id },
    select: { id: true, empresa_id: true, eliminado: true },
  });
  if (!p) return httpError(reply, 404, "Proyecto no encontrado");
  if (!scope.isMaster && p.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Proyecto fuera de tu empresa");
  if (p.eliminado) return httpError(reply, 409, "Proyecto ya está deshabilitado");

  await prisma.proyecto.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });
  return reply.send({ ok: true });
}

/* ========== RESTORE ========== */
export async function restoreProyecto(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const p = await prisma.proyecto.findUnique({
    where: { id },
    select: { id: true, empresa_id: true, eliminado: true },
  });
  if (!p) return httpError(reply, 404, "Proyecto no encontrado");
  if (!scope.isMaster && p.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Proyecto fuera de tu empresa");
  if (!p.eliminado) return httpError(reply, 409, "Proyecto no está deshabilitado");

  await prisma.proyecto.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });
  return reply.send({ ok: true });
}

/* ========== APROBAR ========== */
export async function approveProyecto(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const p = await prisma.proyecto.findUnique({
    where: { id },
    select: { id: true, empresa_id: true, eliminado: true },
  });
  if (!p) return httpError(reply, 404, "Proyecto no encontrado");
  if (p.eliminado) return httpError(reply, 409, "Proyecto deshabilitado");
  if (!scope.isMaster && p.empresa_id !== scope.empresaId) {
    return httpError(reply, 403, "No autorizado para aprobar este proyecto");
  }

  const upd = await prisma.proyecto.update({
    where: { id },
    data: { estado: "aprobado" },
  });

  return reply.send({ ok: true, row: upd });
}

/* ========== HARD DELETE ========== */
export async function deleteProyecto(request, reply) {
  const scope = resolveScope(request);
  const id = request.params.id;

  const exists = await prisma.proyecto.findUnique({
    where: { id },
    select: { id: true, empresa_id: true },
  });
  if (!exists) return httpError(reply, 404, "Proyecto no encontrado");
  if (!scope.isMaster && exists.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Proyecto fuera de tu empresa");

  await prisma.$transaction(async (tx) => {
    await tx.tareaDependencia.deleteMany({
      where: {
        OR: [{ tarea: { proyecto_id: id } }, { predecesora: { proyecto_id: id } }],
      },
    });
    await tx.tarea.deleteMany({ where: { proyecto_id: id } });
    await tx.proyectoMiembro.deleteMany({ where: { proyecto_id: id } });
    await tx.proyecto.delete({ where: { id } });
  });

  return reply.send({ ok: true, msg: "Proyecto eliminado" });
}

/* =========================================================
   REPORTE DEVENGADO (por proyecto)
   - tareas semana pasada / esta semana / pendientes
   - % avance ponderado (costo plan / horas plan / igual)
   - devengado $ (venta|cotización) * avance
   - costo acumulado real (compras + rendiciones + HH real)
   - ✅ costo plan (HH plan + compras plan si existe campo)
   - ✅ utilidad real vs teórica
   - ✅ equilibrio real vs teórico
   - ✅ desviaciones plan vs real
========================================================= */
export async function reporteDevengadoProyecto(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  // -----------------------------
  // helpers
  // -----------------------------
  const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
  const clampPct01 = (pct) => clamp01((Number(pct) || 0) / 100);

  const isCompleted = (x) =>
    (x?.estado || "").toLowerCase() === "completa" || (Number(x?.avance) || 0) >= 100;

  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };

  // Lunes como inicio de semana
  const startOfWeekMonday = (date) => {
    const d = startOfDay(date);
    const day = d.getDay(); // 0 dom, 1 lun...
    const diff = (day === 0 ? -6 : 1 - day); // si domingo, retrocede 6
    d.setDate(d.getDate() + diff);
    return d;
  };

  const addDays = (date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  };

  const inRange = (d, a, b) => {
    if (!d) return false;
    const t = new Date(d).getTime();
    return t >= a.getTime() && t <= b.getTime();
  };

  const overlapPlanWithRange = (startPlan, endPlan, rangeStart, rangeEnd) => {
    if (!startPlan || !endPlan) return false;
    const s = new Date(startPlan).getTime();
    const e = new Date(endPlan).getTime();
    const a = rangeStart.getTime();
    const b = rangeEnd.getTime();
    return s <= b && e >= a; // intersección
  };

  const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // -----------------------------
  // seguridad / scope
  // -----------------------------
  const where = {
    id,
    eliminado: false,
    empresa: { eliminado: false },
    ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }),
  };

  const row = await prisma.proyecto.findFirst({
    where,
    include: {
      tareas: {
        where: { eliminado: false },
        orderBy: [{ orden: "asc" }, { fecha_inicio_plan: "asc" }],
        include: {
          responsable: { include: { usuario: true } },
          detalles: {
            where: { eliminado: false },
            orderBy: [{ fecha_inicio_plan: "asc" }],
            include: {
              responsable: { include: { usuario: { select: { nombre: true, correo: true } } } },
            },
          },
        },
      },
      compras: { where: { eliminado: false } },
      rendiciones: { where: { eliminado: false } },
      cotizaciones: {
        where: { eliminado: false },
        include: {
          cliente: true,
          ventas: {
            where: { eliminado: false },
            include: {
              detalles: { where: { eliminado: false } },
            },
          },
        },
      },
    },
  });

  if (!row) return httpError(reply, 404, "Proyecto no encontrado");
  if (!scope.isMaster && row.empresa_id !== scope.empresaId) {
    return httpError(reply, 403, "Proyecto fuera de tu empresa");
  }

  // -----------------------------
  // universo de items (subtareas si existen; si no, tareas)
  // -----------------------------
  const tareas = Array.isArray(row.tareas) ? row.tareas : [];
  const subtareas = tareas.flatMap((t) => (Array.isArray(t.detalles) ? t.detalles : []));

  const itemsBase =
    subtareas.length > 0
      ? subtareas.map((d) => ({
          tipo: "SUBTAREA",
          id: d.id,
          parentId: d.tarea_id,
          nombre: d.titulo,
          estado: d.estado,
          avance: d.avance,
          fecha_inicio_plan: d.fecha_inicio_plan,
          fecha_fin_plan: d.fecha_fin_plan,
          fecha_inicio_real: d.fecha_inicio_real,
          fecha_fin_real: d.fecha_fin_real,
          horas_plan: d.horas_plan,
          horas_real: d.horas_real,
          valor_hora: d.valor_hora,
          costo_plan: d.costo_plan,
          costo_real: d.costo_real,
          responsable: d.responsable,
        }))
      : tareas.map((t) => ({
          tipo: "TAREA",
          id: t.id,
          parentId: null,
          nombre: t.nombre,
          estado: t.estado,
          avance: t.avance,
          fecha_inicio_plan: t.fecha_inicio_plan,
          fecha_fin_plan: t.fecha_fin_plan,
          fecha_inicio_real: t.fecha_inicio_real,
          fecha_fin_real: t.fecha_fin_real,
          horas_plan: t.total_horas_plan ?? null,
          horas_real: t.total_horas_reales ?? null,
          valor_hora: null,
          costo_plan: t.total_costo_plan ?? null,
          costo_real: t.total_costo_real ?? null,
          responsable: t.responsable,
        }));

  // -----------------------------
  // rangos semana pasada / esta semana
  // -----------------------------
  const now = new Date();
  const today = startOfDay(now);

  const thisWeekStart = startOfWeekMonday(today);
  const thisWeekEnd = addDays(thisWeekStart, 6);
  thisWeekEnd.setHours(23, 59, 59, 999);

  const lastWeekStart = addDays(thisWeekStart, -7);
  const lastWeekEnd = addDays(thisWeekStart, -1);
  lastWeekEnd.setHours(23, 59, 59, 999);

  // -----------------------------
  // clasificar tareas
  // -----------------------------
  const completadasSemanaPasada = [];
  const enSemanaActual = [];
  const pendientesFuturas = [];
  const atrasadas = [];

  for (const it of itemsBase) {
    const completed = isCompleted(it);
    const finReal = it.fecha_fin_real ? new Date(it.fecha_fin_real) : null;
    const finPlan = it.fecha_fin_plan ? new Date(it.fecha_fin_plan) : null;

    const endedLastWeek =
      completed &&
      (inRange(finReal, lastWeekStart, lastWeekEnd) ||
        (!finReal && inRange(finPlan, lastWeekStart, lastWeekEnd)));

    if (endedLastWeek) completadasSemanaPasada.push(it);

    if (!completed && finPlan && finPlan.getTime() < today.getTime()) {
      atrasadas.push(it);
      continue;
    }

    const overlapsThisWeek = overlapPlanWithRange(
      it.fecha_inicio_plan,
      it.fecha_fin_plan,
      thisWeekStart,
      thisWeekEnd
    );

    if (!completed && overlapsThisWeek) {
      enSemanaActual.push(it);
      continue;
    }

    const startsAfterThisWeek = it.fecha_inicio_plan
      ? new Date(it.fecha_inicio_plan).getTime() > thisWeekEnd.getTime()
      : false;

    const endsAfterThisWeek = it.fecha_fin_plan
      ? new Date(it.fecha_fin_plan).getTime() > thisWeekEnd.getTime()
      : false;

    if (!completed && (startsAfterThisWeek || endsAfterThisWeek)) {
      pendientesFuturas.push(it);
    }
  }

  // -----------------------------
  // avance ponderado
  // peso: costo_plan -> horas_plan*valor_hora -> horas_plan -> 1
  // -----------------------------
  const calcPeso = (it) => {
    const costoPlan = it.costo_plan != null ? Number(it.costo_plan) : null;
    if (Number.isFinite(costoPlan) && costoPlan > 0) return costoPlan;

    const horasPlan = it.horas_plan != null ? Number(it.horas_plan) : null;
    const valorHora = it.valor_hora != null ? Number(it.valor_hora) : null;

    if (Number.isFinite(horasPlan) && horasPlan > 0 && Number.isFinite(valorHora) && valorHora > 0) {
      return horasPlan * valorHora;
    }
    if (Number.isFinite(horasPlan) && horasPlan > 0) return horasPlan;

    return 1;
  };

  let sumW = 0;
  let sumDoneW = 0;

  for (const it of itemsBase) {
    const w = calcPeso(it);
    const p = isCompleted(it) ? 1 : clampPct01(it.avance);
    sumW += w;
    sumDoneW += w * p;
  }

  const avancePct = sumW > 0 ? Math.round((sumDoneW / sumW) * 100) : 0;
  const avanceRatio = sumW > 0 ? sumDoneW / sumW : 0;

  // -----------------------------
  // COSTOS REALES acumulados (compras + rendiciones + HH real)
  // -----------------------------
  const compras = Array.isArray(row.compras) ? row.compras : [];
  const rendiciones = Array.isArray(row.rendiciones) ? row.rendiciones : [];

  const totalCompras = compras.reduce((s, c) => s + n0(c.total), 0);
  const totalRendiciones = rendiciones.reduce((s, r) => s + n0(r.monto_total), 0);

  const valorHHReal = subtareas.reduce((sum, d) => {
    const costoRealDirecto = d.costo_real ?? null;
    const costoRealCalc =
      d.horas_real != null && d.valor_hora != null ? n0(d.horas_real) * n0(d.valor_hora) : 0;
    const costoReal = costoRealDirecto != null ? n0(costoRealDirecto) : n0(costoRealCalc);
    return sum + costoReal;
  }, 0);

  const costoAcumuladoReal = totalCompras + totalRendiciones + valorHHReal;

  // -----------------------------
  // ✅ COSTOS PLAN (HH plan + compras plan si existe)
  // - HH plan: costo_plan o horas_plan*valor_hora
  // - Compras plan: intenta leer "total_plan" o "totalPlan" si existen.
  //   (si tu schema no los tiene aún, queda 0 y no rompe)
  // -----------------------------
  const valorHHPlan = subtareas.reduce((sum, d) => {
    const costoPlanDirecto = d.costo_plan ?? null;
    const costoPlanCalc =
      d.horas_plan != null && d.valor_hora != null ? n0(d.horas_plan) * n0(d.valor_hora) : 0;
    const costoPlan = costoPlanDirecto != null ? n0(costoPlanDirecto) : n0(costoPlanCalc);
    return sum + costoPlan;
  }, 0);

  const totalComprasPlan = compras.reduce((s, c) => {
    // soporta varios nombres por si ya los agregas después
    const plan = c.total_plan ?? c.totalPlan ?? c.presupuesto ?? null;
    return s + n0(plan);
  }, 0);

  // si no tienes compras plan, al menos HH plan te da control
  const costoPlanTotal = valorHHPlan + totalComprasPlan;

  // ✅ “plan a la fecha”: aproximación gerencial:
  // cuánto *deberías* haber consumido de costo según avance actual
  const costoPlanALaFecha = costoPlanTotal * avanceRatio;

  // -----------------------------
  // base venta/cotización del proyecto
  // -----------------------------
  const cotizaciones = Array.isArray(row.cotizaciones) ? row.cotizaciones : [];
  const cotizacionesNoRechazadas = cotizaciones.filter(
    (c) => c && c.eliminado === false && String(c.estado || "") !== "RECHAZADA"
  );

  const valorCotizado = cotizacionesNoRechazadas.reduce((s, c) => s + n0(c.total), 0);

  const ventas = cotizacionesNoRechazadas.flatMap((c) => (Array.isArray(c.ventas) ? c.ventas : []));
  const valorVendido = ventas.reduce((s, v) => {
    const dets = Array.isArray(v.detalles) ? v.detalles : [];
    const totalVenta = dets.reduce((ss, d) => ss + n0(d.ventaTotal ?? d.total), 0);
    return s + totalVenta;
  }, 0);

  const base = valorVendido > 0 ? valorVendido : valorCotizado;
  const baseFuente = valorVendido > 0 ? "VENTA" : "COTIZACION";

  // -----------------------------
  // devengado y utilidades
  // -----------------------------
  const devengado = base * avanceRatio;

  // ✅ utilidad REAL (contra costos reales)
  const utilidadReal = devengado - costoAcumuladoReal;

  // ✅ utilidad TEÓRICA (contra costo plan a la fecha)
  // si no hay costo plan, utilidad teórica queda igual a devengado (y lo marcamos como “sin plan”)
  const utilidadTeorica = devengado - costoPlanALaFecha;

  const margenRealPct = devengado > 0 ? (utilidadReal / devengado) * 100 : 0;
  const margenTeoricoPct = devengado > 0 ? (utilidadTeorica / devengado) * 100 : 0;

  // ✅ equilibrio real: devengado >= costo real
  const equilibrioReal = costoAcumuladoReal > 0 ? devengado >= costoAcumuladoReal : false;

  // ✅ equilibrio teórico: devengado >= costo plan a la fecha
  const equilibrioTeorico = costoPlanALaFecha > 0 ? devengado >= costoPlanALaFecha : false;

  // ✅ cuando no hay costos reales imputados:
  const sinCostosReales = costoAcumuladoReal <= 0;

  // % avance mínimo para cubrir costos (si base>0)
  const breakevenRealPct = base > 0 ? (costoAcumuladoReal / base) * 100 : null;
  const breakevenPlanPct = base > 0 ? (costoPlanALaFecha / base) * 100 : null;

  const faltanteEquilibrioReal = sinCostosReales
    ? null
    : Math.max(0, costoAcumuladoReal - devengado);

  // -----------------------------
  // desviaciones plan vs real (gerencia)
  // -----------------------------
  // Variación de costos (CV): Plan a la fecha - Real a la fecha (positivo = bien)
  const variacionCostos = costoPlanALaFecha - costoAcumuladoReal;
  const variacionCostosPct =
    costoPlanALaFecha > 0 ? (variacionCostos / costoPlanALaFecha) * 100 : null;

  // Índice desempeño costos (CPI): EV/AC  (mayor a 1 es bueno)
  const cpi = costoAcumuladoReal > 0 ? devengado / costoAcumuladoReal : null;

  // Índice desempeño plan (SPI) real requiere PV (plan value). No lo tenemos.
  // No lo inventamos. Mejor mostrar “N/D” hasta que tengas plan de avance por calendario.

  const pickTaskOut = (it) => ({
    tipo: it.tipo,
    id: it.id,
    parentId: it.parentId,
    nombre: it.nombre,
    estado: it.estado,
    avance: Number(it.avance) || 0,
    fecha_inicio_plan: it.fecha_inicio_plan,
    fecha_fin_plan: it.fecha_fin_plan,
    fecha_inicio_real: it.fecha_inicio_real,
    fecha_fin_real: it.fecha_fin_real,
    responsable: it?.responsable?.usuario
      ? { nombre: it.responsable.usuario.nombre, correo: it.responsable.usuario.correo }
      : null,
  });

  return reply.send({
    ok: true,
    proyecto: {
      id: row.id,
      nombre: row.nombre,
      estado: row.estado,
    },
    rango: {
      hoy: today.toISOString(),
      semanaPasada: { inicio: lastWeekStart.toISOString(), fin: lastWeekEnd.toISOString() },
      semanaActual: { inicio: thisWeekStart.toISOString(), fin: thisWeekEnd.toISOString() },
    },
    tareas: {
      usandoSubtareas: subtareas.length > 0,
      completadasSemanaPasada: completadasSemanaPasada.map(pickTaskOut),
      enSemanaActual: enSemanaActual.map(pickTaskOut),
      atrasadas: atrasadas.map(pickTaskOut),
      pendientesFuturas: pendientesFuturas.map(pickTaskOut),
      avancePct,
      conteo: {
        total: itemsBase.length,
        completadasSemanaPasada: completadasSemanaPasada.length,
        enSemanaActual: enSemanaActual.length,
        atrasadas: atrasadas.length,
        pendientesFuturas: pendientesFuturas.length,
      },
    },
    financiero: {
      base: {
        fuente: baseFuente, // VENTA o COTIZACION
        valor: base,
        valorVendido,
        valorCotizado,
      },

      // ✅ REAL
      real: {
        compras: totalCompras,
        rendiciones: totalRendiciones,
        hh: valorHHReal,
        costoAcumulado: costoAcumuladoReal,
        sinCostosReales,
      },

      // ✅ PLAN
      plan: {
        compras: totalComprasPlan,
        hh: valorHHPlan,
        costoTotal: costoPlanTotal,
        costoALaFecha: costoPlanALaFecha,
        sinPlan: costoPlanTotal <= 0,
      },

      // ✅ DEVENGADO
      devengado: {
        avancePct,
        devengado,
        // utilidades separadas
        utilidadReal,
        utilidadTeorica,
        margenRealPct,
        margenTeoricoPct,

        // equilibrio real / teórico (no mentimos si no hay costos)
        equilibrioReal,
        equilibrioTeorico,

        breakevenRealPct,
        breakevenPlanPct,
        faltanteEquilibrioReal,

        // variaciones para gerencia
        variacionCostos, // + = vas “mejor” que plan a la fecha
        variacionCostosPct,
        cpi,
      },
    },
  });
}

