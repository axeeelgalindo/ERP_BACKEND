// src/usuarios/controllers.js
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/* ============= AUTH ============= */
export const makeLogin = (server) => async (request, reply) => {
  const { correo, contrasena } = request.body || {};
  const rawEmail = String(correo || "").trim().toLowerCase();

  if (!rawEmail || !contrasena) {
    return reply.badRequest("Correo y contraseña son obligatorios");
  }

  // buscamos por correo + eliminado = false
  const user = await prisma.usuario.findFirst({
    where: {
      correo: rawEmail,
      eliminado: false,
    },
    include: {
      empresa: { select: { id: true, nombre: true } },
      rol: { select: { id: true, nombre: true, codigo: true } },
    },
  });

  if (!user) {
    console.log("[LOGIN] usuario no encontrado para correo:", rawEmail);
    return reply.unauthorized("Credenciales inválidas");
  }

  // 🔐 compara contra el hash bcrypt del seed
  const ok = await bcrypt.compare(String(contrasena), user.contrasena);

  if (!ok) {
    console.log("[LOGIN] contraseña incorrecta para:", rawEmail);
    return reply.unauthorized("Credenciales inválidas");
  }

  const payload = {
    sub: user.id,
    userId: user.id,
    nombre: user.nombre,
    correo: user.correo,
    rol: user.rol,
    empresa: user.empresa,
  };

  const token = server.jwt.sign(payload, { expiresIn: "24h" });

  return reply.send({ token, user: payload });
};


export const me = async (request, reply) => {
  // requiere server.authenticate en la ruta
  return reply.send({ user: request.user, scope: request.scope });
};

/* ============= CRUD USUARIOS ============= */
export const listUsuarios = async (request, reply) => {
  const { q, page = 1, pageSize = 1000, empresaId, all } = request.query;
  const { scope } = request;

  // si no es master o superadmin, fuerza empresaId del scope
  const isSuper = scope?.rolCodigo === "SUPERADMIN" || scope?.rolCodigo === "MASTER";
  const targetEmpresaId = isSuper ? (empresaId ?? scope?.empresaId) : scope?.empresaId;

  const where = {
    ...(q ? { OR: [{ nombre: { contains: q, mode: "insensitive" } }, { correo: { contains: q, mode: "insensitive" } }] } : {}),
    empresa_id: targetEmpresaId,
    eliminado: false,
  };

  const isAll = all === "true" || all === true;
  const takeVal = isAll ? undefined : Number(pageSize || 1000);
  const skipVal = isAll ? undefined : (Number(page || 1) - 1) * Number(pageSize || 1000);

  const total = await prisma.usuario.count({ where });
  const data = await prisma.usuario.findMany({
    where,
    ...(takeVal ? { take: takeVal } : {}),
    ...(skipVal ? { skip: skipVal } : {}),
    orderBy: { nombre: "asc" },
    include: {
      empresa: { select: { id: true, nombre: true } },
      rol: { select: { id: true, nombre: true, codigo: true } },
      empleado: { select: { id: true, cargo: true, telefono: true } },
    },
  });

  return reply.send({ total, data });
};

export const getUsuario = async (request, reply) => {
  const { id } = request.params;
  const u = await prisma.usuario.findUnique({
    where: { id },
    include: {
      empresa: true,
      rol: true,
      empleado: true,
    },
  });
  if (!u) return reply.notFound("Usuario no encontrado");
  return reply.send(u);
};

export const createUsuario = async (request, reply) => {
  const body = request.body;
  
  // si no es master o superadmin, fuerza empresa del scope
  const isSuper = request.scope?.rolCodigo === "SUPERADMIN" || request.scope?.rolCodigo === "MASTER";
  const empresa_id = isSuper ? (body.empresa_id ?? request.scope?.empresaId) : (request.scope?.empresaId ?? body.empresa_id);

  const hashedPassword = await bcrypt.hash(body.contrasena, 10);

  const u = await prisma.usuario.create({
    data: {
      empresa_id,
      rol_id: body.rol_id,
      nombre: body.nombre,
      correo: body.correo,
      contrasena: hashedPassword,
    },
  });
  return reply.code(201).send(u);
};

export const updateUsuario = async (request, reply) => {
  const { id } = request.params;
  const data = { ...request.body };
  if (data.contrasena) {
    data.contrasena = await bcrypt.hash(data.contrasena, 10);
  }

  const u = await prisma.usuario.update({
    where: { id },
    data,
  });
  return reply.send(u);
};

export const deleteUsuario = async (request, reply) => {
  const { id } = request.params;
  await prisma.usuario.delete({ where: { id } });
  return reply.send({ success: true });
};

export const disableUsuario = async (request, reply) => {
  const { id } = request.params;

  const u = await prisma.usuario.findUnique({ where: { id }, select: { id: true, eliminado: true } });
  if (!u) return reply.notFound("Usuario no encontrado");
  if (u.eliminado) return reply.conflict("Usuario ya está deshabilitado");

  await prisma.usuario.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });
  return reply.send({ success: true });
};

export const restoreUsuario = async (request, reply) => {
  const { id } = request.params;

  const u = await prisma.usuario.findUnique({ where: { id }, select: { id: true, eliminado: true } });
  if (!u) return reply.notFound("Usuario no encontrado");
  if (!u.eliminado) return reply.conflict("Usuario no está deshabilitado");

  await prisma.usuario.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });
  return reply.send({ success: true });
};




//ROL USUARIO
// Listar roles (por defecto sin eliminados)
export const listRoles = async (request, reply) => {
  const { q, includeDeleted } = request.query || {};
  const where = {
    ...(q ? {
      OR: [
        { nombre: { contains: q, mode: "insensitive" } },
        { codigo: { contains: q, mode: "insensitive" } },
        { descripcion: { contains: q, mode: "insensitive" } },
      ]
    } : {}),
    ...(includeDeleted ? {} : { eliminado: false }),
  };

  const data = await prisma.rolUsuario.findMany({
    where,
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
  });
  return reply.send({ total: data.length, data });
};

export const getRol = async (request, reply) => {
  const { id } = request.params;
  const row = await prisma.rolUsuario.findUnique({ where: { id } });
  if (!row) return reply.notFound("Rol no encontrado");
  return reply.send(row);
};

export const createRol = async (request, reply) => {
  const { nombre, codigo, descripcion, orden, activo = true } = request.body || {};

  // validación de unicidad manual con tolerancia a soft-delete
  const dup = await prisma.rolUsuario.findFirst({
    where: {
      OR: [
        { nombre: { equals: nombre, mode: "insensitive" } },
        ...(codigo ? [{ codigo: { equals: codigo, mode: "insensitive" } }] : []),
      ],
      eliminado: false,
    },
    select: { id: true, nombre: true, codigo: true },
  });
  if (dup) return reply.conflict("Ya existe un rol con el mismo nombre o código");

  const row = await prisma.rolUsuario.create({
    data: { nombre, codigo: codigo || null, descripcion: descripcion || null, orden: orden ?? null, activo },
  });
  return reply.code(201).send(row);
};

export const updateRol = async (request, reply) => {
  const { id } = request.params;
  const data = { ...request.body };

  // proteger unicidad si cambian nombre/codigo
  if (data.nombre || data.codigo) {
    const dup = await prisma.rolUsuario.findFirst({
      where: {
        id: { not: id },
        eliminado: false,
        OR: [
          ...(data.nombre ? [{ nombre: { equals: data.nombre, mode: "insensitive" } }] : []),
          ...(data.codigo ? [{ codigo: { equals: data.codigo, mode: "insensitive" } }] : []),
        ],
      },
      select: { id: true },
    });
    if (dup) return reply.conflict("Ya existe un rol con ese nombre/código");
  }

  const row = await prisma.rolUsuario.update({ where: { id }, data });
  return reply.send(row);
};

// Borrado físico solo si no tiene usuarios o con ?force=true
export const deleteRol = async (request, reply) => {
  const { id } = request.params;
  const { force } = request.query || {};

  const r = await prisma.rolUsuario.findUnique({
    where: { id },
    include: { usuarios: { select: { id: true }, take: 1 } },
  });
  if (!r) return reply.notFound("Rol no encontrado");

  if (!force && r.usuarios.length > 0) {
    return reply.conflict("Rol en uso por usuarios. Usa ?force=true para eliminar definitivamente.");
  }

  await prisma.rolUsuario.delete({ where: { id } });
  return reply.send({ success: true });
};

// Soft delete / restore
export const disableRol = async (request, reply) => {
  const { id } = request.params;
  const r = await prisma.rolUsuario.findUnique({ where: { id } });
  if (!r) return reply.notFound("Rol no encontrado");
  if (r.eliminado) return reply.conflict("Rol ya está deshabilitado");

  await prisma.rolUsuario.update({ where: { id }, data: { eliminado: true, eliminado_en: new Date() } });
  return reply.send({ success: true });
};

export const restoreRol = async (request, reply) => {
  const { id } = request.params;
  const r = await prisma.rolUsuario.findUnique({ where: { id } });
  if (!r) return reply.notFound("Rol no encontrado");
  if (!r.eliminado) return reply.conflict("Rol no está deshabilitado");

  await prisma.rolUsuario.update({ where: { id }, data: { eliminado: false, eliminado_en: null } });
  return reply.send({ success: true });
};