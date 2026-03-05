// backend/src/rendiciones/controllers.js
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";

const prisma = new PrismaClient();

const PAGE = 1;
const SIZE = 20;

/* =========================
   Helpers internos (sin lib/rendiciones.js)
========================= */
function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampPage(n) {
  const x = Number(n || 1);
  if (!Number.isFinite(x) || x < 1) return 1;
  return Math.floor(x);
}

function clampSize(n) {
  const x = Number(n || 20);
  if (!Number.isFinite(x) || x < 1) return 20;
  return Math.min(100, Math.floor(x));
}

function normalizeItems(items = []) {
  const arr = Array.isArray(items) ? items : [];
  const out = [];

  for (let i = 0; i < arr.length; i++) {
    const it = arr[i] || {};
    const linea = Number.isFinite(Number(it.linea)) ? Number(it.linea) : i + 1;

    // fecha: permitir string o Date. Si no viene, usamos hoy.
    let fecha = it.fecha ? new Date(it.fecha) : new Date();
    if (Number.isNaN(fecha.getTime())) fecha = new Date();

    out.push({
      linea,
      fecha,
      descripcion: String(it.descripcion ?? "").trim(),
      monto: toNum(it.monto, 0),
      categoria: it.categoria != null ? String(it.categoria) : null,
      comprobante_url:
        it.comprobante_url != null ? String(it.comprobante_url) : null,
    });
  }

  // ordenar por linea, y si hay lineas repetidas, las normalizamos
  out.sort((a, b) => a.linea - b.linea);

  const used = new Set();
  for (let i = 0; i < out.length; i++) {
    while (used.has(out[i].linea)) out[i].linea++;
    used.add(out[i].linea);
  }

  return out;
}

function totalFromItems(items = []) {
  return items.reduce((acc, it) => acc + toNum(it?.monto, 0), 0);
}

/* =========================
   Validaciones "assert" internas (sin lib/asserts.js)
========================= */
async function assertProyectoEmpresa(tx, proyecto_id, empresa_id) {
  if (!proyecto_id) throw new Error("Falta proyecto_id");
  const p = await tx.proyecto.findFirst({
    where: {
      id: String(proyecto_id),
      empresa_id: String(empresa_id),
      eliminado: false,
    },
    select: { id: true },
  });
  if (!p) throw new Error("Proyecto no existe o no pertenece a la empresa");
  return p;
}

async function assertEmpleadoEmpresa(tx, empleado_id, empresa_id) {
  if (!empleado_id) throw new Error("Falta empleado_id");

  // En tu schema Empleado no tiene empresa_id directo.
  // Validamos existencia y (si tiene usuario) validamos empresa del usuario.
  const e = await tx.empleado.findFirst({
    where: { id: String(empleado_id), eliminado: false },
    select: {
      id: true,
      usuario: { select: { empresa_id: true, eliminado: true } },
    },
  });

  if (!e) throw new Error("Empleado no existe");

  // Si hay usuario asociado, validamos empresa
  if (e.usuario) {
    if (e.usuario.eliminado) throw new Error("Empleado con usuario eliminado");
    if (String(e.usuario.empresa_id) !== String(empresa_id)) {
      throw new Error("Empleado no pertenece a la empresa");
    }
  }

  return e;
}

function normDestino(v) {
  const x = String(v || "PROYECTO").toUpperCase();
  if (!["PROYECTO", "ADMINISTRACION", "TALLER"].includes(x)) return null;
  return x;
}

function normCentro(v) {
  if (v == null || v === "") return null;
  const x = String(v).toUpperCase().trim();
  if (!["PMC", "PUQ"].includes(x)) return null;
  return x;
}
/* ========== CREATE (con items) ========== */
export async function createRendicion(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};
  const { empleado_id, proyecto_id } = body;

  const destino = normDestino(body.destino) || "PROYECTO";
  const centro_costo = normCentro(body.centro_costo);

  // ✅ Validaciones destino/centro
  if (destino === "PROYECTO") {
    if (!proyecto_id)
      return reply
        .code(400)
        .send({ error: "proyecto_id requerido cuando destino = PROYECTO" });
    if (centro_costo)
      return reply.code(400).send({
        error: "centro_costo debe ser null cuando destino = PROYECTO",
      });
  } else {
    if (!centro_costo)
      return reply.code(400).send({
        error: "centro_costo requerido (PMC|PUQ) para ADMINISTRACION/TALLER",
      });
    // ✅ YA NO exigimos proyecto_id en ADMIN/TALLER
  }

  const items = normalizeItems(body.items || []);
  if (!items.length)
    return reply.code(400).send({ error: "Debe venir al menos 1 item" });

  const monto_total = totalFromItems(items);

  const row = await prisma.$transaction(async (tx) => {
    await assertEmpleadoEmpresa(tx, empleado_id, scope.empresaId);

    // ✅ Solo validamos proyecto si viene (o si destino=PROYECTO)
    if (destino === "PROYECTO") {
      await assertProyectoEmpresa(tx, proyecto_id, scope.empresaId);
    } else if (proyecto_id) {
      await assertProyectoEmpresa(tx, proyecto_id, scope.empresaId);
    }

    const r = await tx.rendicion.create({
      data: {
        empresa_id: scope.empresaId, // ✅ FIX
        empleado_id,
        proyecto_id: destino === "PROYECTO" ? proyecto_id : proyecto_id || null,

        destino,
        centro_costo: destino === "PROYECTO" ? null : centro_costo,

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
      include: {
        proyecto: { select: { id: true, nombre: true } },
        empleado: { select: { id: true, rut: true, cargo: true } },
        revisada_por: { select: { id: true, nombre: true, correo: true } },
        items: true,
        compras: { select: { id: true, numero: true, total: true } },
      },
    });
  });

  return reply.code(201).send(row);
}

/* ========== LIST ========== */
export async function listRendiciones(request, reply) {
  const scope = resolveScope(request);

  const q = String(request.query?.q || "").trim();
  const estado = String(request.query?.estado || "").trim();
  const proyecto_id =
    request.query?.proyecto_id || request.query?.proyectoId || null;

  const destino = request.query?.destino
    ? normDestino(request.query.destino)
    : null;
  const centro_costo = request.query?.centro_costo
    ? normCentro(request.query.centro_costo)
    : null;

  const page = clampPage(request.query?.page ?? PAGE);
  const pageSize = clampSize(request.query?.pageSize ?? SIZE);

  const where = {
    eliminado: false,
    empleado: {
      usuario: {
        empresa_id: scope.empresaId,
        eliminado: false,
      },
    },
    ...(estado ? { estado } : {}),
    ...(proyecto_id ? { proyecto_id } : {}),
    ...(destino ? { destino } : {}),
    ...(centro_costo ? { centro_costo } : {}),
    ...(q
      ? {
          OR: [
            { descripcion: { contains: q, mode: "insensitive" } },
            { empleado: { rut: { contains: q, mode: "insensitive" } } },
            { proyecto: { nombre: { contains: q, mode: "insensitive" } } }, // OK aunque proyecto sea null
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.rendicion.count({ where }),
    prisma.rendicion.findMany({
      where,
      orderBy: [{ creado_en: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        proyecto: { select: { id: true, nombre: true } },
        empleado: { select: { id: true, rut: true, cargo: true } },
        revisada_por: { select: { id: true, nombre: true, correo: true } },
        items: true,
        compras: { select: { id: true, numero: true, total: true } }, // ✅ emparentado con compras
      },
    }),
  ]);

  return reply.send({ data: rows, total, page, pageSize });
}

/* ========== GET BY ID ========== */
export async function getRendicionById(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params || {};

  const row = await prisma.rendicion.findFirst({
    where: {
      id,
      eliminado: false,
      empleado: {
        usuario: {
          empresa_id: scope.empresaId,
          eliminado: false,
        },
      },
    },
    include: {
      proyecto: { select: { id: true, nombre: true } },
      empleado: { select: { id: true, rut: true, cargo: true } },
      revisada_por: { select: { id: true, nombre: true, correo: true } },
      items: true,
      compras: {
        select: {
          id: true,
          numero: true,
          total: true,
          destino: true,
          centro_costo: true,
        },
      },
    },
  });

  if (!row) throw httpError(404, "Rendición no encontrada");
  return reply.send(row);
}

/* ========== UPDATE ========== */
export async function updateRendicion(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params || {};
  const body = request.body || {};

  const destino = body.destino != null ? normDestino(body.destino) : null;
  const centro_costo =
    body.centro_costo != null ? normCentro(body.centro_costo) : undefined;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // ✅ OJO: ya no podemos filtrar por proyecto.empresa_id porque proyecto puede ser null
      // Filtramos por empresa usando empleado -> usuario -> empresa_id
      const current = await tx.rendicion.findFirst({
        where: {
          id,
          eliminado: false,
          empleado: {
            usuario: {
              empresa_id: scope.empresaId,
              eliminado: false,
            },
          },
        },
        select: {
          id: true,
          empleado_id: true,
          proyecto_id: true,
          destino: true,
          centro_costo: true,
        },
      });

      if (!current) return httpError(reply, 404, "Rendición no encontrada");

      const nextEmpleadoId = body.empleado_id ?? current.empleado_id;
      const nextProyectoId = body.proyecto_id ?? current.proyecto_id; // puede ser null
      const nextDestino = destino ?? current.destino;
      const nextCentro =
        centro_costo === undefined ? current.centro_costo : centro_costo;

      // ✅ Validaciones destino/centro (proyecto opcional en ADMIN/TALLER)
      if (nextDestino === "PROYECTO") {
        if (!nextProyectoId)
          return httpError(
            reply,
            400,
            "proyecto_id requerido cuando destino = PROYECTO",
          );
        if (nextCentro)
          return httpError(
            reply,
            400,
            "centro_costo debe ser null cuando destino = PROYECTO",
          );
      } else {
        if (!nextCentro)
          return httpError(
            reply,
            400,
            "centro_costo requerido (PMC|PUQ) para ADMINISTRACION/TALLER",
          );
        // ✅ proyecto_id opcional aquí
      }

      // ✅ Valida empleado pertenece a la empresa
      await assertEmpleadoEmpresa(tx, nextEmpleadoId, scope.empresaId);

      // ✅ Solo validamos proyecto si corresponde o si viene
      if (nextDestino === "PROYECTO" || nextProyectoId) {
        await assertProyectoEmpresa(tx, nextProyectoId, scope.empresaId);
      }

      const data = {
        empleado_id: nextEmpleadoId,

        // ✅ Si destino=PROYECTO, proyecto debe existir. Si no, puede ser null.
        proyecto_id:
          nextDestino === "PROYECTO" ? nextProyectoId : nextProyectoId || null,

        // ✅ Normalizamos destino/centro
        destino: nextDestino,
        centro_costo: nextDestino === "PROYECTO" ? null : (nextCentro ?? null),

        // Campos opcionales
        descripcion: body.descripcion ?? undefined,
        estado: body.estado ?? undefined,

        revisada_por_id: body.revisada_por_id ?? undefined,
        fecha_revision: body.fecha_revision
          ? new Date(body.fecha_revision)
          : undefined,
        comentario_revision: body.comentario_revision ?? undefined,
      };

      // Si mandan items => reemplazo completo (deleteMany + create)
      if (body.items) {
        const items = normalizeItems(body.items || []);
        if (!items.length)
          return httpError(reply, 400, "Debe venir al menos 1 item");

        const monto_total = totalFromItems(items);

        const r = await tx.rendicion.update({
          where: { id },
          data: {
            ...data,
            monto_total,
            items: {
              deleteMany: {},
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
          include: {
            items: true,
            proyecto: { select: { id: true, nombre: true } },
            empleado: { select: { id: true, rut: true, cargo: true } },
            revisada_por: { select: { id: true, nombre: true, correo: true } },
            compras: {
              select: {
                id: true,
                numero: true,
                total: true,
                destino: true,
                centro_costo: true,
              },
            },
          },
        });

        return r;
      }

      // Si no mandan items, update simple
      const r = await tx.rendicion.update({
        where: { id },
        data,
        include: {
          items: true,
          proyecto: { select: { id: true, nombre: true } },
          empleado: { select: { id: true, rut: true, cargo: true } },
          revisada_por: { select: { id: true, nombre: true, correo: true } },
          compras: {
            select: {
              id: true,
              numero: true,
              total: true,
              destino: true,
              centro_costo: true,
            },
          },
        },
      });

      return r;
    });

    // Si httpError ya respondió (return httpError(...)) entonces updated podría ser undefined.
    if (!updated) return;

    return reply.send({ ok: true, row: updated });
  } catch (err) {
    // Si tus assert lanzan Error normal
    const msg = err?.message || "Error actualizando rendición";
    return httpError(reply, 400, msg);
  }
}

/* ========== DELETE (soft) ========== */
export async function deleteRendicion(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params || {};

  const row = await prisma.rendicion.findFirst({
    where: {
      id,
      eliminado: false,
      proyecto: {
        empresa_id: scope.empresaId,
        eliminado: false,
        empresa: { eliminado: false },
      },
    },
    select: { id: true },
  });
  if (!row) throw httpError(404, "Rendición no encontrada");

  const updated = await prisma.rendicion.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });

  return reply.send({ ok: true, row: updated });
}

/* =========================
   Helpers archivos
========================= */
function safeFileName(name) {
  const base = String(name || "archivo")
    .replace(/[^\w.\-() ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
  return base || "archivo";
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

// uploads/rendiciones/<slug_rendicion>/<filename>
function rendicionesDir(rendicionSlug) {
  return path.join(
    process.cwd(),
    "uploads",
    "rendiciones",
    String(rendicionSlug),
  );
}

function rendicionesPublicPrefix(rendicionSlug) {
  // asumiendo que sirves /uploads como estático (sin /api)
  // ejemplo: fastify.register(static, { root: path.join(process.cwd(), "uploads"), prefix: "/uploads/" })
  return `/uploads/rendiciones/${String(rendicionSlug)}`;
}

function makeRendicionSlug(r) {
  // "caracteristico" sin empresa_id: usa id + fecha (corto)
  const id6 = String(r?.id || "").slice(-6);
  const ymd = new Date(r?.creado_en || Date.now()).toISOString().slice(0, 10); // YYYY-MM-DD
  return `rend_${ymd}_${id6}`;
}

/* =========================
   ✅ POST /rendiciones/:id/items/:itemId/comprobante
   multipart: file=<image|pdf>
========================= */
export async function uploadComprobanteItem(request, reply) {
  const scope = resolveScope(request);
  const { id, itemId } = request.params || {};

  // 1) validar rendición + empresa por scope
  const rend = await prisma.rendicion.findFirst({
    where: {
      id: String(id),
      eliminado: false,
      // OJO: proyecto es opcional, así que NO podemos filtrar por proyecto.empresa_id
      // usamos empresa_id directo (en tu schema Rendicion.empresa_id existe)
      empresa_id: scope.empresaId,
    },
    select: { id: true, empresa_id: true, creado_en: true },
  });
  if (!rend) return httpError(reply, 404, "Rendición no encontrada");

  // 2) validar que el item pertenece a la rendición
  const item = await prisma.rendicionItem.findFirst({
    where: {
      id: String(itemId),
      rendicion_id: String(id),
    },
    select: { id: true, rendicion_id: true },
  });
  if (!item) return httpError(reply, 404, "Ítem de rendición no encontrado");

  // 3) leer file multipart
  const file = await request.file();
  if (!file) return httpError(reply, 400, "Debes enviar file en form-data");

  const mimetype = String(file.mimetype || "").toLowerCase();

  const isImg =
    mimetype.startsWith("image/") &&
    ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(mimetype);

  const isPdf = mimetype === "application/pdf";

  if (!isImg && !isPdf) {
    return httpError(
      reply,
      400,
      "Archivo inválido. Solo imágenes (jpg/png/webp) o PDF.",
    );
  }

  const ext = isPdf
    ? "pdf"
    : mimetype === "image/png"
      ? "png"
      : mimetype === "image/webp"
        ? "webp"
        : "jpg";

  // 4) carpeta característica por rendición
  const slug = makeRendicionSlug(rend);
  const dir = rendicionesDir(slug);
  await ensureDir(dir);

  const original = safeFileName(file.filename || `comprobante.${ext}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rnd = crypto.randomBytes(6).toString("hex");

  const filename = `item_${itemId}_${stamp}_${rnd}_${original}`;
  const fullpath = path.join(dir, filename);

  const buf = await file.toBuffer();
  const MAX = 10 * 1024 * 1024; // 10MB
  if (buf.length > MAX) return httpError(reply, 400, "Archivo supera 10MB");

  await fsp.writeFile(fullpath, buf);

  const comprobante_url = `${rendicionesPublicPrefix(slug)}/${filename}`;

  // 5) guardar url en DB
  const updated = await prisma.rendicionItem.update({
    where: { id: String(itemId) },
    data: { comprobante_url },
    select: { id: true, comprobante_url: true, rendicion_id: true },
  });

  return reply.send({ ok: true, ...updated });
}
