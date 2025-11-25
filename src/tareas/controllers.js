// src/controllers/tareas.controller.js
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";

const prisma = new PrismaClient();
const PAGE = 1,
  SIZE = 100;

const daysBetween = (a, b) =>
  Math.max(1, Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)));
const parseDate = (d) => (d ? new Date(d) : null);

async function assertProyectoInEmpresa(tx, proyectoId, empresaId) {
  const p = await tx.proyecto.findFirst({
    where: {
      id: proyectoId,
      empresa_id: empresaId,
      eliminado: false,
      empresa: { eliminado: false },
    },
    select: { id: true },
  });
  if (!p) {
    const err = new Error(
      "Proyecto no pertenece a tu empresa o está deshabilitado"
    );
    err.statusCode = 403;
    throw err;
  }
}

/* ========== LISTAR ========== */
export async function listTareas(request, reply) {
  const scope = resolveScope(request);
  const {
    proyectoId,
    responsableId,
    estado,
    desde,
    hasta,
    page = PAGE,
    pageSize = SIZE,
    sort = "orden:asc,fecha_inicio_plan:asc",
    includeDeleted,
  } = request.query || {};

  const orderBy = sort
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [k, dir] = s.split(":");
      return { [k]: (dir || "asc").toLowerCase() };
    });

  const rango =
    desde || hasta
      ? {
          NOT: [
            ...(desde ? [{ fecha_fin_plan: { lt: new Date(desde) } }] : []),
            ...(hasta ? [{ fecha_inicio_plan: { gt: new Date(hasta) } }] : []),
          ],
        }
      : {};

  const where = {
    proyecto: {
      empresa_id: scope.empresaId,
      eliminado: false,
      empresa: { eliminado: false },
    },
    ...(includeDeleted ? {} : { eliminado: false }),
    ...(proyectoId ? { proyecto_id: proyectoId } : {}),
    ...(responsableId ? { responsable_id: responsableId } : {}),
    ...(estado ? { estado } : {}),
    ...rango,
  };

  const [total, rows] = await Promise.all([
    prisma.tarea.count({ where }),
    prisma.tarea.findMany({
      where,
      orderBy: orderBy.length
        ? orderBy
        : [{ orden: "asc" }, { fecha_inicio_plan: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        responsable: {
          include: { usuario: { select: { nombre: true, correo: true } } },
        },
        dependencias: { select: { predecesora_id: true, tipo: true } },
      },
    }),
  ]);

  const rowsMapped = rows.map((t) => ({
    ...t,
    dependencies: t.dependencias.map((d) => d.predecesora_id),
  }));

  return reply.send({ ok: true, total, page, pageSize, rows: rowsMapped });
}

/* ========== DETALLE ========== */
export async function getTarea(request, reply) {
  const scope = resolveScope(request);
  const id = request.params.id;

  const row = await prisma.tarea.findFirst({
    where: {
      id,
      eliminado: false,
      proyecto: {
        empresa_id: scope.empresaId,
        eliminado: false,
        empresa: { eliminado: false },
      },
    },
    include: {
      responsable: { include: { usuario: true } },
      dependencias: { include: { predecesora: true } },
      sucesoras: true,
    },
  });
  if (!row) return httpError(reply, 404, "Tarea no encontrada");
  return reply.send({ ok: true, row });
}

/* ========== CREAR (responsable debe ser miembro del proyecto) ========== */
export async function createTarea(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};
  const {
    proyecto_id,
    nombre,
    descripcion,
    responsable_id,
    prioridad,
    // aunque vengan en el body, los normalizamos igual
    estado,
    avance,
    es_hito = false,
    orden,
    fecha_inicio_plan,
    fecha_fin_plan,
    fecha_inicio_real,
    fecha_fin_real,
  } = body;

  const fip = parseDate(fecha_inicio_plan);
  const ffp = parseDate(fecha_fin_plan);
  if (!fip || !ffp || fip > ffp)
    return httpError(reply, 400, "Rango plan inválido");

  const fir = parseDate(fecha_inicio_real);
  const ffr = parseDate(fecha_fin_real);
  if (fir && ffr && fir > ffr)
    return httpError(reply, 400, "Rango real inválido");

  // === normalizar avance y estado ===
  let finalAvance =
    typeof avance === "number" && !Number.isNaN(avance) ? avance : 0;
  if (finalAvance < 0) finalAvance = 0;
  if (finalAvance > 100) finalAvance = 100;

  let finalEstado;
  if (finalAvance >= 100) finalEstado = "completada";
  else if (finalAvance > 0) finalEstado = "en_progreso";
  else finalEstado = "pendiente";

  const row = await prisma.$transaction(async (tx) => {
    await assertProyectoInEmpresa(tx, proyecto_id, scope.empresaId);

    if (responsable_id) {
      const miembro = await tx.proyectoMiembro.findFirst({
        where: {
          proyecto_id,
          empleado_id: responsable_id,
          empleado: {
            eliminado: false,
            usuario: {
              empresa_id: scope.empresaId,
              empresa: { eliminado: false },
            },
          },
        },
        select: { id: true },
      });

      if (!miembro) {
        throw Object.assign(
          new Error(
            "Responsable no es miembro de este proyecto o está deshabilitado"
          ),
          { statusCode: 403 }
        );
      }
    }

    const dias_plan = daysBetween(fip, ffp);
    const dias_reales = fir && ffr ? daysBetween(fir, ffr) : null;

    return tx.tarea.create({
      data: {
        proyecto_id,
        nombre,
        descripcion,
        responsable_id,
        prioridad,
        estado: finalEstado,
        avance: finalAvance,
        es_hito,
        orden,
        fecha_inicio_plan: fip,
        fecha_fin_plan: ffp,
        dias_plan,
        fecha_inicio_real: fir,
        fecha_fin_real: ffr,
        dias_reales,
      },
    });
  });

  return reply.code(201).send({ ok: true, row });
}


/* ========== ACTUALIZAR ========== */
export async function updateTarea(request, reply) {
  const scope = resolveScope(request);
  const id = request.params.id;
  const data = request.body || {};

  const row = await prisma.$transaction(async (tx) => {
    const tarea = await tx.tarea.findFirst({
      where: {
        id,
        eliminado: false,
        proyecto: {
          empresa_id: scope.empresaId,
          eliminado: false,
          empresa: { eliminado: false },
        },
      },
      include: { proyecto: true },
    });
    if (!tarea)
      throw Object.assign(new Error("Tarea no encontrada o deshabilitada"), {
        statusCode: 404,
      });

    if (data.proyecto_id && data.proyecto_id !== tarea.proyecto_id) {
      await assertProyectoInEmpresa(tx, data.proyecto_id, scope.empresaId);
    }

    if (data.responsable_id) {
      const miembro = await tx.proyectoMiembro.findFirst({
        where: {
          proyecto_id: data.proyecto_id || tarea.proyecto_id,
          empleado_id: data.responsable_id,
          empleado: {
            eliminado: false,
            usuario: {
              empresa_id: scope.empresaId,
              empresa: { eliminado: false },
            },
          },
        },
        select: { id: true },
      });
      if (!miembro) {
        throw Object.assign(
          new Error(
            "Responsable no es miembro de este proyecto o está deshabilitado"
          ),
          { statusCode: 403 }
        );
      }
    }

    const fip = data.fecha_inicio_plan
      ? new Date(data.fecha_inicio_plan)
      : tarea.fecha_inicio_plan;
    const ffp = data.fecha_fin_plan
      ? new Date(data.fecha_fin_plan)
      : tarea.fecha_fin_plan;
    if (fip > ffp)
      throw Object.assign(new Error("Rango plan inválido"), {
        statusCode: 400,
      });

    const fir = data.fecha_inicio_real
      ? new Date(data.fecha_inicio_real)
      : tarea.fecha_inicio_real;
    const ffr = data.fecha_fin_real
      ? new Date(data.fecha_fin_real)
      : tarea.fecha_fin_real;
    if (fir && ffr && fir > ffr)
      throw Object.assign(new Error("Rango real inválido"), {
        statusCode: 400,
      });

    const dias_plan = daysBetween(fip, ffp);
    const dias_reales = fir && ffr ? daysBetween(fir, ffr) : null;

    // === normalizar avance/estado si se está actualizando avance ===
    const updateData = {
      ...data,
      fecha_inicio_plan: fip,
      fecha_fin_plan: ffp,
      dias_plan,
      fecha_inicio_real: fir,
      fecha_fin_real: ffr,
      dias_reales,
    };

    if (Object.prototype.hasOwnProperty.call(data, "avance")) {
      let a =
        typeof data.avance === "number" && !Number.isNaN(data.avance)
          ? data.avance
          : 0;
      if (a < 0) a = 0;
      if (a > 100) a = 100;
      updateData.avance = a;

      if (a >= 100) updateData.estado = "completada";
      else if (a > 0) updateData.estado = "en_progreso";
      else updateData.estado = "pendiente";
    }

    return tx.tarea.update({
      where: { id },
      data: updateData,
    });
  });

  return reply.send({ ok: true, row });
}



/* ========== HARD DELETE ========== */
export async function deleteTarea(request, reply) {
  const scope = resolveScope(request);
  const id = request.params.id;

  await prisma.$transaction(async (tx) => {
    const tarea = await tx.tarea.findFirst({
      where: {
        id,
        proyecto: {
          empresa_id: scope.empresaId,
          eliminado: false,
          empresa: { eliminado: false },
        },
      },
      select: { id: true },
    });
    if (!tarea)
      throw Object.assign(new Error("Tarea no encontrada"), {
        statusCode: 404,
      });

    await tx.tareaDependencia.deleteMany({
      where: { OR: [{ tarea_id: id }, { predecesora_id: id }] },
    });
    await tx.tarea.delete({ where: { id } });
  });

  return reply.send({ ok: true, msg: "Tarea eliminada" });
}

/* ========== SOFT DELETE / RESTORE ========== */
export async function disableTarea(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const t = await prisma.tarea.findFirst({
    where: {
      id,
      proyecto: {
        empresa_id: scope.empresaId,
        eliminado: false,
        empresa: { eliminado: false },
      },
    },
    select: { id: true, eliminado: true },
  });
  if (!t) return httpError(reply, 404, "Tarea no encontrada");
  if (t.eliminado) return httpError(reply, 409, "Tarea ya está deshabilitada");

  await prisma.tarea.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });
  return reply.send({ ok: true });
}

export async function restoreTarea(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const t = await prisma.tarea.findFirst({
    where: {
      id,
      proyecto: {
        empresa_id: scope.empresaId,
        eliminado: false,
        empresa: { eliminado: false },
      },
    },
    select: { id: true, eliminado: true },
  });
  if (!t) return httpError(reply, 404, "Tarea no encontrada");
  if (!t.eliminado) return httpError(reply, 409, "Tarea no está deshabilitada");

  await prisma.tarea.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });
  return reply.send({ ok: true });
}

/* ========== DEPENDENCIAS ========== */
// helper DFS: ¿existe un camino desde fromId hasta targetId?
async function createsCycle(tx, fromId, targetId) {
  if (fromId === targetId) return true;
  const stack = [fromId];
  const visited = new Set();

  while (stack.length) {
    const cur = stack.pop();
    if (cur === targetId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);

    const edges = await tx.tareaDependencia.findMany({
      where: { predecesora_id: cur },
      select: { tarea_id: true },
    });
    for (const e of edges) {
      if (!visited.has(e.tarea_id)) stack.push(e.tarea_id);
    }
  }
  return false;
}

export async function addDependencia(request, reply) {
  const scope = resolveScope(request);
  const { tarea_id, predecesora_id, tipo = "FS" } = request.body || {};
  if (tarea_id === predecesora_id)
    return httpError(reply, 400, "Una tarea no puede depender de sí misma");

  const row = await prisma.$transaction(async (tx) => {
    const [t1, t2] = await Promise.all([
      tx.tarea.findFirst({
        where: {
          id: tarea_id,
          eliminado: false,
          proyecto: {
            empresa_id: scope.empresaId,
            eliminado: false,
            empresa: { eliminado: false },
          },
        },
        select: { id: true, proyecto_id: true },
      }),
      tx.tarea.findFirst({
        where: {
          id: predecesora_id,
          eliminado: false,
          proyecto: {
            empresa_id: scope.empresaId,
            eliminado: false,
            empresa: { eliminado: false },
          },
        },
        select: { id: true, proyecto_id: true },
      }),
    ]);
    if (!t1 || !t2)
      throw Object.assign(
        new Error("Tarea o predecesora inexistente/deshabilitada"),
        { statusCode: 404 }
      );
    if (t1.proyecto_id !== t2.proyecto_id)
      throw Object.assign(new Error("Deben ser del mismo proyecto"), {
        statusCode: 400,
      });

    // chequeo de ciclo: ¿ya hay un camino desde predecesora -> tarea?
    const cycle = await createsCycle(tx, predecesora_id, tarea_id);
    if (cycle)
      throw Object.assign(new Error("La dependencia genera un ciclo"), {
        statusCode: 400,
      });

    // respeta constraint única (tarea_id, predecesora_id)
    const exists = await tx.tareaDependencia.findFirst({
      where: { tarea_id, predecesora_id },
      select: { id: true },
    });
    if (exists) return exists;

    return tx.tareaDependencia.create({
      data: { tarea_id, predecesora_id, tipo },
    });
  });

  return reply.code(201).send({ ok: true, row });
}

export async function removeDependencia(request, reply) {
  const scope = resolveScope(request);
  const id = request.params.id;

  const dep = await prisma.tareaDependencia.findFirst({
    where: {
      id,
      tarea: { proyecto: { empresa_id: scope.empresaId } },
    },
    select: { id: true },
  });
  if (!dep) return httpError(reply, 404, "Dependencia no encontrada");

  await prisma.tareaDependencia.delete({ where: { id } });
  return reply.send({ ok: true, msg: "Dependencia eliminada" });
}
