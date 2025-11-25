// src/empleados/controllers.js
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";

const prisma = new PrismaClient();

/* Helpers */
const toInt = (x, d = 0) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
};

const parseBool = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return undefined;
}

/* ================= LIST ================= */
export const listEmpleados = async (request, reply) => {
  const scope = resolveScope(request);
  const {
    q,
    activo,
    page = 1,
    pageSize = 20,
    empresaId: empresaIdQ,
    withUsuario,
    // filtros opcionales de rol
    rolCodigo,
    rolNombre,
  } = request.query || {};

  // empresa sacada del scope (o query si es master)
  const empresaId = scope.isMaster
    ? empresaIdQ || scope.empresaId
    : scope.empresaId;

  if (!empresaId) {
    return reply.badRequest("Falta empresaId en el contexto");
  }

  const activoFilter = parseBool(activo);

  const where = {
    ...(withUsuario ? { usuario_id: { not: null } } : {}),
    ...(typeof activoFilter === "boolean" ? { activo: activoFilter } : {}),
    // siempre filtrar por empresa del usuario
    usuario: {
      empresa_id: empresaId,
      eliminado: false,
      // solo filtrar por rol si te lo pasan
      ...(rolCodigo || rolNombre
        ? {
            rol: {
              ...(rolCodigo ? { codigo: rolCodigo } : {}),
              ...(rolNombre
                ? { nombre: { equals: rolNombre, mode: "insensitive" } }
                : {}),
            },
          }
        : {}),
    },
    ...(q
      ? {
          OR: [
            { cargo: { contains: q, mode: "insensitive" } },
            { usuario: { nombre: { contains: q, mode: "insensitive" } } },
            { usuario: { correo: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [total, data] = await Promise.all([
    prisma.empleado.count({ where }),
    prisma.empleado.findMany({
      where,
      skip: (toInt(page) - 1) * toInt(pageSize, 20),
      take: toInt(pageSize, 20),
      orderBy: { creado_en: "desc" },
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            correo: true,
            rol: { select: { id: true, nombre: true, codigo: true } },
            empresa: { select: { id: true, nombre: true } },
          },
        },
        _count: {
          select: { Rendicion: true, tareas: true },
        },
      },
    }),
  ]);

  return reply.send({ total, data });
};

/* ================= GET ================= */
export const getEmpleado = async (request, reply) => {
  const scope = resolveScope(request);
  const { id } = request.params;

  const emp = await prisma.empleado.findUnique({
    where: { id },
    include: {
      usuario: {
        select: {
          id: true,
          nombre: true,
          correo: true,
          empresa_id: true,
          empresa: { select: { id: true, nombre: true } },
          rol: { select: { id: true, nombre: true, codigo: true } },
        },
      },
      _count: { select: { Rendicion: true, tareas: true } },
    },
  });

  if (!emp) return reply.notFound("Empleado no encontrado");

  // Seguridad de empresa: el empleado debe pertenecer a la empresa del scope
  if (!scope.isMaster && emp?.usuario?.empresa_id !== scope.empresaId) {
    return reply.forbidden("Empleado fuera de tu empresa");
  }

  return reply.send(emp);
};


/* ============== CREATE ================= */
export const createEmpleado = async (request, reply) => {
  const scope = resolveScope(request);
  const body = request.body || {};

  // si viene usuario_id, validar que el usuario pertenezca a la empresa del scope
  if (body.usuario_id) {
    const usr = await prisma.usuario.findUnique({
      where: { id: body.usuario_id },
      select: { empresa_id: true },
    });
    if (!usr) return reply.badRequest("usuario_id inválido");
    if (!scope.isMaster && usr.empresa_id !== scope.empresaId) {
      return reply.forbidden("No puedes vincular usuario de otra empresa");
    }
  }

  const emp = await prisma.empleado.create({
    data: {
      usuario_id: body.usuario_id ?? null,
      cargo: body.cargo ?? null,
      telefono: body.telefono ?? null,
      fecha_ingreso: body.fecha_ingreso ? new Date(body.fecha_ingreso) : null,
      sueldo_base:
        typeof body.sueldo_base === "number" ? body.sueldo_base : null,
      activo: typeof body.activo === "boolean" ? body.activo : true,
    },
    include: {
      usuario: {
        select: {
          id: true,
          nombre: true,
          correo: true,
          empresa: { select: { id: true, nombre: true } },
          rol: { select: { id: true, nombre: true, codigo: true } },
        },
      },
    },
  });

  return reply.code(201).send(emp);
};

/* ============== UPDATE ================= */
export const updateEmpleado = async (request, reply) => {
  const scope = resolveScope(request);
  const { id } = request.params;
  const body = request.body || {};

  const current = await prisma.empleado.findUnique({
    where: { id },
    include: { usuario: { select: { empresa_id: true } } },
  });
  if (!current) return reply.notFound("Empleado no encontrado");
  if (!scope.isMaster && current?.usuario?.empresa_id !== scope.empresaId) {
    return reply.forbidden("Empleado fuera de tu empresa");
  }

  // si piden cambiar usuario vinculado, validar empresa
  if (body.usuario_id && body.usuario_id !== current.usuario_id) {
    const usr = await prisma.usuario.findUnique({
      where: { id: body.usuario_id },
      select: { empresa_id: true },
    });
    if (!usr) return reply.badRequest("usuario_id inválido");
    if (!scope.isMaster && usr.empresa_id !== scope.empresaId) {
      return reply.forbidden("No puedes vincular usuario de otra empresa");
    }
  }

  const data = {
    ...(body.usuario_id !== undefined ? { usuario_id: body.usuario_id } : {}),
    ...(body.cargo !== undefined ? { cargo: body.cargo } : {}),
    ...(body.telefono !== undefined ? { telefono: body.telefono } : {}),
    ...(body.fecha_ingreso !== undefined
      ? {
          fecha_ingreso: body.fecha_ingreso
            ? new Date(body.fecha_ingreso)
            : null,
        }
      : {}),
    ...(body.sueldo_base !== undefined
      ? { sueldo_base: body.sueldo_base }
      : {}),
    ...(body.activo !== undefined ? { activo: body.activo } : {}),
  };

  const emp = await prisma.empleado.update({
    where: { id },
    data,
    include: {
      usuario: {
        select: {
          id: true,
          nombre: true,
          correo: true,
          empresa: { select: { id: true, nombre: true } },
          rol: { select: { id: true, nombre: true, codigo: true } },
        },
      },
    },
  });

  return reply.send(emp);
};

/* ============== DELETE (BORRADO REAL) ================= */
export const deleteEmpleado = async (request, reply) => {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { force } = request.query || {};

  const emp = await prisma.empleado.findUnique({
    where: { id },
    include: {
      usuario: { select: { empresa_id: true } },
      _count: { select: { Rendicion: true, tareas: true } },
    },
  });
  if (!emp) return reply.notFound("Empleado no encontrado");

  // validar empresa
  if (!scope.isMaster && emp?.usuario?.empresa_id !== scope.empresaId)
    return reply.forbidden("Empleado fuera de tu empresa");

  // si tiene relaciones, solo si ?force=true
  if (!force && (emp._count.Rendicion > 0 || emp._count.tareas > 0)) {
    return reply.conflict(
      "Empleado tiene rendiciones o tareas asociadas. Usa ?force=true si realmente quieres eliminarlo."
    );
  }

  // por seguridad: si no está deshabilitado, pedir primero disable
  if (!emp.eliminado && !force) {
    return reply.conflict(
      "Empleado aún está activo. Debe deshabilitarlo primero o usar ?force=true para borrarlo definitivamente."
    );
  }

  await prisma.empleado.delete({ where: { id } });
  return reply.send({ success: true, msg: "Empleado eliminado permanentemente" });
};

/* ===== SOFT DELETE ===== */
export const disableEmpleado = async (request, reply) => {
  try {
    const { id } = request.params;
    const scope = resolveScope(request);

    const emp = await prisma.empleado.findUnique({
      where: { id },
      include: { usuario: { select: { empresa_id: true } } },
    });

    if (!emp) return reply.notFound("Empleado no encontrado");
    if (emp.eliminado)
      return reply.conflict("Empleado ya se encuentra deshabilitado");

    if (emp.usuario && emp.usuario.empresa_id !== scope.empresaId)
      return reply.forbidden("Empleado de otra empresa");

    await prisma.empleado.update({
      where: { id },
      data: { eliminado: true, eliminado_en: new Date(), activo: false },
    });

    return reply.send({ success: true, msg: "Empleado deshabilitado correctamente" });
  } catch (error) {
    console.error(error);
    return reply.status(500).send({ error: "Error al deshabilitar empleado" });
  }
};

/* ===== RESTORE ===== */
export const restoreEmpleado = async (request, reply) => {
  const { id } = request.params;
  const scope = resolveScope(request);

  const emp = await prisma.empleado.findUnique({
    where: { id },
    include: { usuario: { select: { empresa_id: true } } },
  });

  if (!emp) return reply.notFound("Empleado no encontrado");
  if (!emp.eliminado)
    return reply.conflict("Empleado ya está activo");
  if (emp.usuario && emp.usuario.empresa_id !== scope.empresaId)
    return reply.forbidden("Empleado de otra empresa");

  const restored = await prisma.empleado.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null, activo: true },
  });

  return reply.send({ success: true, msg: "Empleado restaurado correctamente", empleado: restored });
};