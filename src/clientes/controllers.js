import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { pipeline } from "stream/promises";

const prisma = new PrismaClient();
const PAGE = 1,
  SIZE = 10000;

/* =========================
   Helpers
========================= */
function boolish(v) {
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  return false;
}

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function ensureClienteOwned({ scope, clienteId, includeDeleted = true }) {
  const where = {
    id: clienteId,
    empresa_id: scope.empresaId,
    ...(includeDeleted ? {} : { eliminado: false }),
  };

  const c = await prisma.cliente.findFirst({
    where,
    select: { id: true, empresa_id: true, eliminado: true },
  });

  return c;
}

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "clientes", "logo");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function safeExt(filename = "") {
  const ext = path.extname(filename).toLowerCase();
  const ok = [".png", ".jpg", ".jpeg", ".webp"];
  return ok.includes(ext) ? ext : ".png";
}

/* =========================
   CLIENTES (base)
========================= */
export async function listClientes(request, reply) {
  const scope = resolveScope(request);
  const {
    q,
    page = PAGE,
    pageSize = SIZE,
    includeDeleted,
  } = request.query || {};

  const where = {
    empresa_id: scope.empresaId,
    ...(q
      ? {
          OR: [
            { nombre: { contains: q, mode: "insensitive" } },
            { correo: { contains: q, mode: "insensitive" } },
            { rut: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(boolish(includeDeleted) ? {} : { eliminado: false }),
  };

  const skip = (Number(page) - 1) * Number(pageSize);
  const take = Number(pageSize);

  const [total, data] = await Promise.all([
    prisma.cliente.count({ where }),
    prisma.cliente.findMany({
      where,
      skip,
      take,
      orderBy: { creado_en: "desc" },
      include: {
        cuenta_principal: true,

        // ✅ TRAER RESPONSABLES PARA EL SELECT DEL MODAL
        responsables: {
          where: { eliminado: false },
          orderBy: [{ es_principal: "desc" }, { creado_en: "asc" }],
          select: {
            id: true,
            nombre: true,
            correo: true,
            telefono: true,
            cargo: true,
            area: true,
            es_principal: true,
          },
        },

        // (opcional) también puedes traer cuentas si las ocupas en UI
        // cuentas_bancarias: { where: { eliminado: false }, orderBy: { creado_en: "desc" } },

        _count: {
          select: {
            cotizaciones: true,
            ventas: true,
            cuentas_bancarias: true,
            responsables: true,
          },
        },
      },
    }),
  ]);

  return reply.send({ total, data, page: Number(page), pageSize: take });
}

export async function getCliente(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.cliente.findFirst({
    where: { id, empresa_id: scope.empresaId },
    include: {
      cotizaciones: true,
      // si tu modelo tiene ventas:
      ventas: true,

      // ✅ nuevos
      cuenta_principal: true,
      cuentas_bancarias: {
        where: { eliminado: false },
        orderBy: { creado_en: "desc" },
      },
      responsables: {
        where: { eliminado: false },
        orderBy: [{ es_principal: "desc" }, { creado_en: "asc" }],
      },
    },
  });

  if (!row) return reply.notFound("Cliente no encontrado");
  return reply.send(row);
}

export async function createCliente(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};

  const row = await prisma.cliente.create({
    data: {
      empresa_id: scope.empresaId,
      nombre: body.nombre,
      rut: body.rut ?? null,
      correo: body.correo ?? null,
      telefono: body.telefono ?? null,
      notas: body.notas ?? null,

      // ✅ nuevos
      logo_url: body.logo_url ?? null,
      logo_public_id: body.logo_public_id ?? null,
    },
  });

  return reply.code(201).send(row);
}

export async function updateCliente(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const body = request.body || {};

  const exists = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: true,
  });
  if (!exists) return reply.notFound("Cliente no encontrado");

  const row = await prisma.cliente.update({
    where: { id },
    data: {
      nombre: body.nombre ?? undefined,
      rut: body.rut ?? undefined,
      correo: body.correo ?? undefined,
      telefono: body.telefono ?? undefined,
      notas: body.notas ?? undefined,

      // ✅ nuevos (si los mandas)
      logo_url: body.logo_url ?? undefined,
      logo_public_id: body.logo_public_id ?? undefined,
    },
  });

  return reply.send(row);
}

/** ✅ Actualizar SOLO logo (por si lo separas del update general) */
export async function uploadClienteLogo(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  // valida ownership
  const exists = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: false,
  });
  if (!exists) return reply.notFound("Cliente no encontrado");

  ensureDir(UPLOAD_DIR);

  const file = await request.file(); // <-- requiere @fastify/multipart
  if (!file)
    return reply.code(400).send({ message: "Archivo requerido (field: file)" });

  const ext = safeExt(file.filename);
  const filename = `cliente_${id}_${Date.now()}${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);

  await pipeline(file.file, fs.createWriteStream(filepath));

  // URL pública (asumiendo que expones /uploads como estático)
  const logo_url = `/uploads/clientes/logo/${filename}`;

  const row = await prisma.cliente.update({
    where: { id },
    data: {
      logo_url,
      // si NO usas cloudinary, puedes guardar el filename como "public_id"
      logo_public_id: filename,
    },
  });

  return reply.send({
    logo_url: row.logo_url,
    logo_public_id: row.logo_public_id,
  });
}

/** Soft delete */
export async function disableCliente(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const exists = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: false,
  });
  if (!exists) return reply.notFound("Cliente no encontrado o ya eliminado");

  await prisma.cliente.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });

  return reply.send({ success: true });
}

/** Restore */
export async function restoreCliente(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const exists = await prisma.cliente.findFirst({
    where: { id, empresa_id: scope.empresaId, eliminado: true },
    select: { id: true },
  });
  if (!exists) return reply.notFound("Cliente no está eliminado o no existe");

  await prisma.cliente.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });

  return reply.send({ success: true });
}

/** Delete físico (solo si no tiene movimientos, o con force) */
export async function deleteCliente(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { force } = request.query || {};

  const c = await prisma.cliente.findFirst({
    where: { id, empresa_id: scope.empresaId },
    include: {
      _count: {
        select: {
          cotizaciones: true,
          ventas: true,
          cuentas_bancarias: true,
          responsables: true,
        },
      },
    },
  });

  if (!c) return reply.notFound("Cliente no encontrado");

  const hasMoves =
    (c._count.cotizaciones || 0) > 0 || (c._count.ventas || 0) > 0;

  if (!boolish(force) && hasMoves) {
    return reply.conflict(
      "Cliente con movimientos. Usa ?force=true para borrado definitivo.",
    );
  }

  await prisma.cliente.delete({ where: { id } });
  return reply.send({ success: true });
}

/* =========================
   CUENTAS BANCARIAS
========================= */

export async function listClienteCuentas(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { includeDeleted } = request.query || {};

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: true,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  const rows = await prisma.clienteCuentaBancaria.findMany({
    where: {
      cliente_id: id,
      ...(boolish(includeDeleted) ? {} : { eliminado: false }),
    },
    orderBy: { creado_en: "desc" },
  });

  return reply.send(rows);
}

export async function createClienteCuenta(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params; // clienteId
  const body = request.body || {};

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: false,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  const row = await prisma.clienteCuentaBancaria.create({
    data: {
      cliente_id: id,
      banco: String(body.banco || "").trim(),
      tipo_cuenta: body.tipo_cuenta ?? null,
      numero: String(body.numero || "").trim(),
      titular: body.titular ?? null,
      rut_titular: body.rut_titular ?? null,
      correo_pago: body.correo_pago ?? null,
      swift: body.swift ?? null,
      iban: body.iban ?? null,
    },
  });

  // si viene como principal => set cliente.cuenta_principal_id
  if (boolish(body.es_principal)) {
    await prisma.cliente.update({
      where: { id },
      data: { cuenta_principal_id: row.id },
    });
  }

  return reply.code(201).send(row);
}

export async function updateClienteCuenta(request, reply) {
  const scope = resolveScope(request);
  const { id, cuentaId } = request.params;
  const body = request.body || {};

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: true,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  const exists = await prisma.clienteCuentaBancaria.findFirst({
    where: { id: cuentaId, cliente_id: id },
    select: { id: true, eliminado: true },
  });
  if (!exists) return reply.notFound("Cuenta bancaria no encontrada");

  const row = await prisma.clienteCuentaBancaria.update({
    where: { id: cuentaId },
    data: {
      banco: body.banco ?? undefined,
      tipo_cuenta: body.tipo_cuenta ?? undefined,
      numero: body.numero ?? undefined,
      titular: body.titular ?? undefined,
      rut_titular: body.rut_titular ?? undefined,
      correo_pago: body.correo_pago ?? undefined,
      swift: body.swift ?? undefined,
      iban: body.iban ?? undefined,
    },
  });

  if (boolish(body.es_principal)) {
    await prisma.cliente.update({
      where: { id },
      data: { cuenta_principal_id: cuentaId },
    });
  }

  return reply.send(row);
}

export async function setClienteCuentaPrincipal(request, reply) {
  const scope = resolveScope(request);
  const { id, cuentaId } = request.params;

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: true,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  const cuenta = await prisma.clienteCuentaBancaria.findFirst({
    where: { id: cuentaId, cliente_id: id, eliminado: false },
    select: { id: true },
  });
  if (!cuenta) return reply.notFound("Cuenta no encontrada o está eliminada");

  const row = await prisma.cliente.update({
    where: { id },
    data: { cuenta_principal_id: cuentaId },
    include: { cuenta_principal: true },
  });

  return reply.send({ success: true, cliente: row });
}

export async function disableClienteCuenta(request, reply) {
  const scope = resolveScope(request);
  const { id, cuentaId } = request.params;

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: true,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  const cuenta = await prisma.clienteCuentaBancaria.findFirst({
    where: { id: cuentaId, cliente_id: id, eliminado: false },
    select: { id: true },
  });
  if (!cuenta) return reply.notFound("Cuenta no encontrada o ya eliminada");

  await prisma.$transaction(async (tx) => {
    // si estaba como principal, la soltamos
    const cli = await tx.cliente.findUnique({
      where: { id },
      select: { cuenta_principal_id: true },
    });

    if (cli?.cuenta_principal_id === cuentaId) {
      await tx.cliente.update({
        where: { id },
        data: { cuenta_principal_id: null },
      });
    }

    await tx.clienteCuentaBancaria.update({
      where: { id: cuentaId },
      data: { eliminado: true, eliminado_en: new Date() },
    });
  });

  return reply.send({ success: true });
}

export async function restoreClienteCuenta(request, reply) {
  const scope = resolveScope(request);
  const { id, cuentaId } = request.params;

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: true,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  const cuenta = await prisma.clienteCuentaBancaria.findFirst({
    where: { id: cuentaId, cliente_id: id, eliminado: true },
    select: { id: true },
  });
  if (!cuenta) return reply.notFound("Cuenta no está eliminada o no existe");

  await prisma.clienteCuentaBancaria.update({
    where: { id: cuentaId },
    data: { eliminado: false, eliminado_en: null },
  });

  return reply.send({ success: true });
}

export async function deleteClienteCuenta(request, reply) {
  const scope = resolveScope(request);
  const { id, cuentaId } = request.params;

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: true,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  await prisma.$transaction(async (tx) => {
    const cli = await tx.cliente.findUnique({
      where: { id },
      select: { cuenta_principal_id: true },
    });

    if (cli?.cuenta_principal_id === cuentaId) {
      await tx.cliente.update({
        where: { id },
        data: { cuenta_principal_id: null },
      });
    }

    await tx.clienteCuentaBancaria.delete({
      where: { id: cuentaId },
    });
  });

  return reply.send({ success: true });
}

/* =========================
   RESPONSABLES / CONTACTOS
========================= */

export async function listClienteResponsables(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { includeDeleted } = request.query || {};

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: true,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  const rows = await prisma.clienteResponsable.findMany({
    where: {
      cliente_id: id,
      ...(boolish(includeDeleted) ? {} : { eliminado: false }),
    },
    orderBy: [{ es_principal: "desc" }, { creado_en: "asc" }],
  });

  return reply.send(rows);
}

export async function createClienteResponsable(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params; // clienteId
  const body = request.body || {};

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: false,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  const willBePrincipal = boolish(body.es_principal);

  const row = await prisma.$transaction(async (tx) => {
    if (willBePrincipal) {
      await tx.clienteResponsable.updateMany({
        where: { cliente_id: id, eliminado: false },
        data: { es_principal: false },
      });
    }

    return tx.clienteResponsable.create({
      data: {
        cliente_id: id,
        nombre: String(body.nombre || "").trim(),
        correo: body.correo ?? null,
        telefono: body.telefono ?? null,
        cargo: body.cargo ?? null,
        area: body.area ?? null,
        es_principal: willBePrincipal,
      },
    });
  });

  return reply.code(201).send(row);
}

export async function updateClienteResponsable(request, reply) {
  const scope = resolveScope(request);
  const { id, responsableId } = request.params;
  const body = request.body || {};

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: true,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  const exists = await prisma.clienteResponsable.findFirst({
    where: { id: responsableId, cliente_id: id },
    select: { id: true, eliminado: true },
  });
  if (!exists) return reply.notFound("Responsable no encontrado");

  const willBePrincipal =
    body.es_principal != null ? boolish(body.es_principal) : null;

  const row = await prisma.$transaction(async (tx) => {
    if (willBePrincipal === true) {
      await tx.clienteResponsable.updateMany({
        where: { cliente_id: id, eliminado: false },
        data: { es_principal: false },
      });
    }

    return tx.clienteResponsable.update({
      where: { id: responsableId },
      data: {
        nombre: body.nombre ?? undefined,
        correo: body.correo ?? undefined,
        telefono: body.telefono ?? undefined,
        cargo: body.cargo ?? undefined,
        area: body.area ?? undefined,
        ...(willBePrincipal === null ? {} : { es_principal: willBePrincipal }),
      },
    });
  });

  return reply.send(row);
}

export async function setClienteResponsablePrincipal(request, reply) {
  const scope = resolveScope(request);
  const { id, responsableId } = request.params;

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: true,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  const r = await prisma.clienteResponsable.findFirst({
    where: { id: responsableId, cliente_id: id, eliminado: false },
    select: { id: true },
  });
  if (!r) return reply.notFound("Responsable no encontrado o está eliminado");

  await prisma.$transaction(async (tx) => {
    await tx.clienteResponsable.updateMany({
      where: { cliente_id: id, eliminado: false },
      data: { es_principal: false },
    });

    await tx.clienteResponsable.update({
      where: { id: responsableId },
      data: { es_principal: true },
    });
  });

  return reply.send({ success: true });
}

export async function disableClienteResponsable(request, reply) {
  const scope = resolveScope(request);
  const { id, responsableId } = request.params;

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: true,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  const r = await prisma.clienteResponsable.findFirst({
    where: { id: responsableId, cliente_id: id, eliminado: false },
    select: { id: true, es_principal: true },
  });
  if (!r) return reply.notFound("Responsable no encontrado o ya eliminado");

  await prisma.clienteResponsable.update({
    where: { id: responsableId },
    data: {
      eliminado: true,
      eliminado_en: new Date(),
      es_principal: false, // si era principal, lo bajamos
    },
  });

  return reply.send({ success: true });
}

export async function restoreClienteResponsable(request, reply) {
  const scope = resolveScope(request);
  const { id, responsableId } = request.params;

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: true,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  const r = await prisma.clienteResponsable.findFirst({
    where: { id: responsableId, cliente_id: id, eliminado: true },
    select: { id: true },
  });
  if (!r) return reply.notFound("Responsable no está eliminado o no existe");

  await prisma.clienteResponsable.update({
    where: { id: responsableId },
    data: { eliminado: false, eliminado_en: null },
  });

  return reply.send({ success: true });
}

export async function deleteClienteResponsable(request, reply) {
  const scope = resolveScope(request);
  const { id, responsableId } = request.params;

  const c = await ensureClienteOwned({
    scope,
    clienteId: id,
    includeDeleted: true,
  });
  if (!c) return reply.notFound("Cliente no encontrado");

  await prisma.clienteResponsable.delete({
    where: { id: responsableId },
  });

  return reply.send({ success: true });
}
