// src/usuarios/controllers.js
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
const prisma = new PrismaClient();

// Hash simple (igual al seed). Si quieres, cambia a bcrypt.
const hash = (txt) => crypto.createHash("sha256").update(String(txt)).digest("hex");

/* ============= AUTH ============= */
export const makeLogin = (server) => async (request, reply) => {
  const { correo, contrasena } = request.body || {};
  const email = String(correo || "").trim().toLowerCase();

  const user = await prisma.usuario.findUnique({
    where: {
      // usa la unique compuesta definida en el schema
      correo_eliminado: { correo: email, eliminado: false },
    },
    include: {
      empresa: { select: { id: true, nombre: true } },
      rol:     { select: { id: true, nombre: true, codigo: true } },
    },
  });

  if (!user) return reply.unauthorized("Credenciales inválidas");

  const ok = user.contrasena === hash(contrasena); // tu función hash
  if (!ok) return reply.unauthorized("Credenciales inválidas");

  const payload = {
    sub: user.id,
    userId: user.id,
    nombre: user.nombre,
    correo: user.correo,
    rol: user.rol,
    empresa: user.empresa,
  };
  const token = server.jwt.sign(payload, { expiresIn: "8h" });

  return reply.send({ token, user: payload });
};

export const me = async (request, reply) => {
  // requiere server.authenticate en la ruta
  return reply.send({ user: request.user, scope: request.scope });
};

/* ============= CRUD USUARIOS ============= */
export const listUsuarios = async (request, reply) => {
  const { q, page = 1, pageSize = 20, empresaId } = request.query;
  const { scope } = request;

  // si no es master, fuerza empresaId del scope
  const where = {
    ...(q ? { OR: [{ nombre: { contains: q, mode: "insensitive" } }, { correo: { contains: q, mode: "insensitive" } }] } : {}),
    empresa_id: empresaId ?? scope.empresaId,
  };

  const total = await prisma.usuario.count({ where });
  const data = await prisma.usuario.findMany({
    where,
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: { creado_en: "desc" },
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
  // si no es master, fuerza empresa del scope
  const empresa_id = request.scope?.empresaId ?? body.empresa_id;

  const u = await prisma.usuario.create({
    data: {
      empresa_id,
      rol_id: body.rol_id,
      nombre: body.nombre,
      correo: body.correo,
      contrasena: hash(body.contrasena),
    },
  });
  return reply.code(201).send(u);
};

export const updateUsuario = async (request, reply) => {
  const { id } = request.params;
  const data = { ...request.body };
  if (data.contrasena) data.contrasena = hash(data.contrasena);

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