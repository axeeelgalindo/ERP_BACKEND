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
            include: {
              usuario: true,
            },
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


/* ========== ACTUALIZAR ========== */
export async function updateProyecto(request, reply) {
  const scope = resolveScope(request);
  const id = request.params.id;
  const data = request.body || {};

  const exists = await prisma.proyecto.findUnique({
    where: { id },
    select: { id: true, empresa_id: true, eliminado: true },
  });
  if (!exists) return httpError(reply, 404, "Proyecto no encontrado");
  if (exists.eliminado) return httpError(reply, 409, "Proyecto está deshabilitado");
  if (!scope.isMaster && exists.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Proyecto fuera de tu empresa");

  if (data.empresa_id && !scope.isMaster) delete data.empresa_id;

  const row = await prisma.proyecto.update({ where: { id }, data });
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
