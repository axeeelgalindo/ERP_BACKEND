import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";

const prisma = new PrismaClient();
const PAGE = 1, SIZE = 20;

/* ========== Helpers ========== */
const toNum = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const toBool = (v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return ["1","true","on","yes"].includes(v.toLowerCase());
  return false;
};

async function assertEmpleadoEmpresa(tx, empleadoId, empresaId) {
  const ok = await tx.empleado.findFirst({
    where: { id: empleadoId, usuario: { empresa_id: empresaId } },
    select: { id: true },
  });
  if (!ok) throw Object.assign(new Error("Empleado no pertenece a tu empresa"), { statusCode: 403 });
}
async function assertProyectoEmpresa(tx, proyectoId, empresaId) {
  const ok = await tx.proyecto.findFirst({
    where: { id: proyectoId, empresa_id: empresaId },
    select: { id: true },
  });
  if (!ok) throw Object.assign(new Error("Proyecto no pertenece a tu empresa"), { statusCode: 403 });
}

function normalizeItems(items = []) {
  // Asegura lineas únicas y consecutivas (1..N) en el orden recibido
  const norm = (Array.isArray(items) ? items : []).map((it) => ({
    linea: Number.isInteger(it?.linea) && it.linea > 0 ? it.linea : null,
    fecha: it?.fecha ? new Date(it.fecha) : new Date(),
    descripcion: String(it?.descripcion ?? ""),
    monto: toNum(it?.monto, 0),
    categoria: it?.categoria ?? null,
    comprobante_url: it?.comprobante_url ?? null,
  }));
  // Renumerar por si faltan/duplican
  return norm.map((it, i) => ({ ...it, linea: i + 1 }));
}
function totalFromItems(items = []) {
  return normalizeItems(items).reduce((acc, it) => acc + toNum(it.monto, 0), 0);
}

/* ========== LIST ========== */
export async function listRendiciones(request, reply) {
  const scope = resolveScope(request);
  const {
    q, estado, empleadoId, proyectoId,
    desde, hasta,
    page = PAGE, pageSize = SIZE,
    includeDeleted, empresaId,
  } = request.query || {};

  const empresa_id = scope.isMaster ? (empresaId || scope.empresaId) : scope.empresaId;

  const rango = (desde || hasta)
    ? {
        AND: [
          ...(desde ? [{ creada_en: { gte: new Date(desde) } }] : []),
          ...(hasta ? [{ creada_en: { lte: new Date(hasta) } }] : []),
        ]
      }
    : {};

  const where = {
    proyecto: { empresa_id },
    ...(estado ? { estado } : {}),
    ...(empleadoId ? { empleado_id: empleadoId } : {}),
    ...(proyectoId ? { proyecto_id: proyectoId } : {}),
    ...(q ? { descripcion: { contains: q, mode: "insensitive" } } : {}),
    ...(includeDeleted ? {} : { eliminado: false }),
    ...rango,
  };

  const [total, rows] = await Promise.all([
    prisma.rendicion.count({ where }),
    prisma.rendicion.findMany({
      where,
      orderBy: [{ creada_en: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        empleado: { include: { usuario: { select: { nombre: true, correo: true } } } },
        proyecto: { select: { id: true, nombre: true } },
        items: true,
      },
    }),
  ]);

  return reply.send({ total, page, pageSize, rows });
}

/* ========== GET ========== */
export async function getRendicion(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.rendicion.findFirst({
    where: { id, proyecto: { empresa_id: scope.isMaster ? undefined : scope.empresaId } },
    include: {
      empleado: { include: { usuario: true } },
      proyecto: true,
      items: true,
    },
  });
  if (!row) return httpError(reply, 404, "Rendición no encontrada");
  return reply.send(row);
}

/* ========== CREATE (con items) ========== */
export async function createRendicion(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};
  const { empleado_id, proyecto_id } = body;

  const items = normalizeItems(body.items || []);
  const monto_total = totalFromItems(items);

  const row = await prisma.$transaction(async (tx) => {
    await assertEmpleadoEmpresa(tx, empleado_id, scope.empresaId);
    await assertProyectoEmpresa(tx, proyecto_id, scope.empresaId);

    const r = await tx.rendicion.create({
      data: {
        empleado_id,
        proyecto_id,
        descripcion: body.descripcion ?? "",
        monto_total,
        estado: body.estado ?? "pendiente",
        items: {
          create: items.map((it) => ({
            linea: it.linea,
            fecha: it.fecha,
            descripcion: it.descripcion,
            monto: toNum(it.monto, 0),
            categoria: it.categoria,
            comprobante_url: it.comprobante_url,
          })),
        },
      },
      include: { items: true },
    });
    return r;
  });

  return reply.code(201).send(row);
}

/* ========== UPDATE (reemplaza items) ========== */
export async function updateRendicion(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const data = request.body || {};

  const exists = await prisma.rendicion.findFirst({
    where: { id, proyecto: { empresa_id: scope.isMaster ? undefined : scope.empresaId } },
    include: { items: true, proyecto: true, empleado: { include: { usuario: true } } },
  });
  if (!exists) return httpError(reply, 404, "Rendición no encontrada");

  const upd = await prisma.$transaction(async (tx) => {
    // Si cambian empleado/proyecto, validar pertenencia
    if (data.empleado_id && data.empleado_id !== exists.empleado_id) {
      await assertEmpleadoEmpresa(tx, data.empleado_id, exists.proyecto.empresa_id);
    }
    if (data.proyecto_id && data.proyecto_id !== exists.proyecto_id) {
      await assertProyectoEmpresa(tx, data.proyecto_id, exists.proyecto.empresa_id);
    }

    let monto_total = exists.monto_total;

    if (Array.isArray(data.items)) {
      const items = normalizeItems(data.items);
      monto_total = totalFromItems(items);
      // reemplazo total
      await tx.rendicionItem.deleteMany({ where: { rendicion_id: id } });
      if (items.length) {
        await tx.rendicionItem.createMany({
          data: items.map((it) => ({
            rendicion_id: id,
            linea: it.linea,
            fecha: it.fecha,
            descripcion: it.descripcion,
            monto: toNum(it.monto, 0),
            categoria: it.categoria,
            comprobante_url: it.comprobante_url,
          })),
        });
      }
    }

    const payload = {
      descripcion: data.descripcion ?? exists.descripcion,
      estado: data.estado ?? exists.estado,
      empleado_id: data.empleado_id ?? exists.empleado_id,
      proyecto_id: data.proyecto_id ?? exists.proyecto_id,
      monto_total,
    };

    return tx.rendicion.update({ where: { id }, data: payload, include: { items: true } });
  });

  return reply.send(upd);
}

/* ========== DELETE físico ========== */
export async function deleteRendicion(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { force } = request.query || {};

  const row = await prisma.rendicion.findFirst({
    where: { id, proyecto: { empresa_id: scope.isMaster ? undefined : scope.empresaId } },
    select: { id: true, estado: true },
  });
  if (!row) return httpError(reply, 404, "Rendición no encontrada");

  if (!toBool(force) && row.estado !== "pendiente") {
    return httpError(reply, 409, "Solo rendiciones en estado 'pendiente'. Usa ?force=true para borrar definitivamente.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.rendicionItem.deleteMany({ where: { rendicion_id: id } });
    await tx.rendicion.delete({ where: { id } });
  });

  return reply.send({ success: true });
}

/* ========== SOFT DELETE / RESTORE ========== */
export async function disableRendicion(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.rendicion.findFirst({
    where: { id, proyecto: { empresa_id: scope.isMaster ? undefined : scope.empresaId } },
  });
  if (!row) return httpError(reply, 404, "Rendición no encontrada");
  if (row.eliminado) return httpError(reply, 409, "Rendición ya eliminada");

  const upd = await prisma.rendicion.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });
  return reply.send({ success: true, rendicion: upd });
}

export async function restoreRendicion(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const row = await prisma.rendicion.findFirst({
    where: { id, proyecto: { empresa_id: scope.isMaster ? undefined : scope.empresaId } },
  });
  if (!row) return httpError(reply, 404, "Rendición no encontrada");
  if (!row.eliminado) return httpError(reply, 409, "Rendición no está eliminada");

  const upd = await prisma.rendicion.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });
  return reply.send({ success: true, rendicion: upd });
}

/* ========== Items individuales ========== */
export async function addRendicionItem(request, reply) {
  const scope = resolveScope(request);
  const { rendicion_id } = request.params;
  const body = request.body || {};

  const r = await prisma.rendicion.findFirst({
    where: { id: rendicion_id, proyecto: { empresa_id: scope.isMaster ? undefined : scope.empresaId } },
    include: { items: true, proyecto: true },
  });
  if (!r) return httpError(reply, 404, "Rendición no encontrada");

  const linea = r.items.length + 1;
  const created = await prisma.$transaction(async (tx) => {
    const it = await tx.rendicionItem.create({
      data: {
        rendicion_id,
        linea,
        fecha: body.fecha ? new Date(body.fecha) : new Date(),
        descripcion: body.descripcion ?? "",
        monto: toNum(body.monto, 0),
        categoria: body.categoria ?? null,
        comprobante_url: body.comprobante_url ?? null,
      },
    });
    const total = r.items.reduce((acc, i) => acc + toNum(i.monto, 0), 0) + toNum(body.monto, 0);
    await tx.rendicion.update({ where: { id: rendicion_id }, data: { monto_total: total } });
    return it;
  });

  return reply.code(201).send(created);
}

export async function updateRendicionItem(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params; // id del item
  const body = request.body || {};

  const it = await prisma.rendicionItem.findUnique({
    where: { id },
    include: { rendicion: { include: { items: true, proyecto: true } } },
  });
  if (!it || !it.rendicion) return httpError(reply, 404, "Item no encontrado");
  if (!scope.isMaster && it.rendicion.proyecto.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Fuera de tu empresa");

  const updated = await prisma.$transaction(async (tx) => {
    const upd = await tx.rendicionItem.update({
      where: { id },
      data: {
        fecha: body.fecha ? new Date(body.fecha) : it.fecha,
        descripcion: body.descripcion ?? it.descripcion,
        monto: body.monto != null ? toNum(body.monto, 0) : it.monto,
        categoria: body.categoria ?? it.categoria,
        comprobante_url: body.comprobante_url ?? it.comprobante_url,
      },
    });

    const parent = await tx.rendicion.findUnique({
      where: { id: it.rendicion_id },
      include: { items: true },
    });
    const total = parent.items.reduce((acc, i) => acc + toNum(i.monto, 0), 0);
    await tx.rendicion.update({ where: { id: it.rendicion_id }, data: { monto_total: total } });

    return upd;
  });

  return reply.send(updated);
}

export async function deleteRendicionItem(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params; // id del item

  const it = await prisma.rendicionItem.findUnique({
    where: { id },
    include: { rendicion: { include: { items: true, proyecto: true } } },
  });
  if (!it || !it.rendicion) return httpError(reply, 404, "Item no encontrado");
  if (!scope.isMaster && it.rendicion.proyecto.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Fuera de tu empresa");

  await prisma.$transaction(async (tx) => {
    await tx.rendicionItem.delete({ where: { id } });

    const parent = await tx.rendicion.findUnique({
      where: { id: it.rendicion_id },
      include: { items: true },
    });
    const total = parent.items.reduce((acc, i) => acc + toNum(i.monto, 0), 0);
    await tx.rendicion.update({ where: { id: it.rendicion_id }, data: { monto_total: total } });
  });

  return reply.send({ success: true });
}
