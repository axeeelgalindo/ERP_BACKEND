//src/admin/controllers.js
import { PrismaClient } from "@prisma/client";
import { requireSuperAdmin } from "./guards.js";

const prisma = new PrismaClient();

//helper
function getScope(request) {
  const empresaId =
    request?.scope?.empresaId ?? request?.headers?.["x-empresa-id"] ?? null;

  const userId =
    request?.scope?.userId ??
    request?.user?.userId ??
    request?.user?.sub ??
    null;

  if (!userId) {
    const err = new Error("Falta usuario en el contexto (token)");
    err.statusCode = 401;
    throw err;
  }

  // Solo obliga empresa para no-SUPERADMIN (igual que tu authz.js)
  const rolCodigo =
    request?.scope?.rolCodigo ?? request?.user?.rol?.codigo ?? null;
  if (!empresaId && rolCodigo !== "SUPERADMIN") {
    const err = new Error("Falta empresa en el contexto");
    err.statusCode = 401;
    throw err;
  }

  return {
    empresaId: empresaId ? String(empresaId) : null,
    userId: String(userId),
    rolCodigo,
  };
}


async function syncCotizacionNumeroSeq() {
  await prisma.$executeRawUnsafe(`
    SELECT setval(
      pg_get_serial_sequence('"Cotizacion"', 'numero'),
      (SELECT COALESCE(MAX("numero"), 0) FROM "Cotizacion"),
      true
    );
  `);
}

export async function adminBuscarCotizaciones(request, reply) {
  if (!requireSuperAdmin(request, reply)) return;

  const { empresaId } = getScope(request);
  const { q, numero, id, cliente_id } = request.query || {};

  // Búsqueda flexible:
  // - numero exacto
  // - id exacto
  // - cliente_id exacto
  // - q: busca por cliente.nombre o asunto (simple)
  const where = {
    empresa_id: empresaId,
    eliminado: false,
    ...(numero ? { numero: Number(numero) } : {}),
    ...(id ? { id: String(id) } : {}),
    ...(cliente_id ? { cliente_id: String(cliente_id) } : {}),
    ...(q
      ? {
          OR: [
            { asunto: { contains: String(q), mode: "insensitive" } },
            { cliente: { nombre: { contains: String(q), mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const rows = await prisma.cotizacion.findMany({
    where,
    take: 50,
    orderBy: [{ numero: "desc" }],
    select: {
      id: true,
      numero: true,
      creada_en: true,
      estado: true,
      total: true,
      cliente: { select: { id: true, nombre: true } },
    },
  });

  return reply.send({ ok: true, rows });
}

export async function adminSyncCotizacionesNumeroSeq(request, reply) {
  if (!requireSuperAdmin(request, reply)) return;

  await syncCotizacionNumeroSeq();

  const agg = await prisma.cotizacion.aggregate({ _max: { numero: true } });
  const maxNumero = agg._max.numero ?? 0;

  return reply.send({
    ok: true,
    message: "Secuencia sincronizada",
    maxNumero,
    nextNumero: maxNumero + 1,
  });
}

export async function adminCambiarNumeroCotizacion(request, reply) {
  if (!requireSuperAdmin(request, reply)) return;

  const { empresaId, userId } = getScope(request);
  const { id } = request.params || {};
  const { nuevoNumero, motivo } = request.body || {};

  const n = Number(nuevoNumero);
  if (!Number.isInteger(n) || n <= 0) {
    return reply.code(400).send({ error: "nuevoNumero debe ser entero positivo" });
  }

  const cot = await prisma.cotizacion.findFirst({
    where: { id: String(id), empresa_id: empresaId, eliminado: false },
    select: { id: true, numero: true },
  });
  if (!cot) return reply.code(404).send({ error: "Cotización no encontrada" });

  // Validar unique (evitar choque antes del update)
  const existe = await prisma.cotizacion.findFirst({
    where: { empresa_id: empresaId, eliminado: false, numero: n },
    select: { id: true },
  });
  if (existe && existe.id !== cot.id) {
    return reply.code(409).send({ error: `Ya existe una cotización con numero=${n}` });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.cotizacion.update({
      where: { id: cot.id },
      data: { numero: n },
      select: {
        id: true,
        numero: true,
        creada_en: true,
        estado: true,
        total: true,
        cliente: { select: { id: true, nombre: true } },
      },
    });

    // auditoría
    await tx.auditLog.create({
      data: {
        empresa_id: empresaId,
        usuario_id: userId ?? null,
        entidad: "Cotizacion",
        registro_id: cot.id,
        accion: "CAMBIAR_NUMERO",
        detalles: {
          antes: { numero: cot.numero },
          despues: { numero: n },
          motivo: motivo ? String(motivo).slice(0, 500) : null,
        },
        ip: request.ip,
        user_agent: request.headers["user-agent"] || null,
      },
    });

    // ✅ importante: sincronizar secuencia después del cambio
    await tx.$executeRawUnsafe(`
      SELECT setval(
        pg_get_serial_sequence('"Cotizacion"', 'numero'),
        (SELECT COALESCE(MAX("numero"), 0) FROM "Cotizacion"),
        true
      );
    `);

    return u;
  });

  return reply.send({ ok: true, row: updated });
}