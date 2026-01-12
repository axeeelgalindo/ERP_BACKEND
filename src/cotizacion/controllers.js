// src/modules/cotizaciones/controllers.js
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

/* =========================
   Helpers
========================= */
function getEmpresaId(request) {
  const empresaId = request.headers["x-empresa-id"];
  if (!empresaId) {
    const err = new Error("Falta empresa en el contexto");
    err.statusCode = 401;
    throw err;
  }
  return String(empresaId);
}

const round0 = (n) => Math.round(Number(n || 0));

function calcFromTotal(total, ivaRate = 0.19) {
  const t = round0(total);
  const rate = Number(ivaRate);
  const divisor = 1 + (Number.isFinite(rate) ? rate : 0.19);
  const subtotal = round0(t / divisor);
  const iva = t - subtotal;
  return { subtotal, iva, total: t };
}

/**
 * Distribuye montos de glosas:
 * - manual=true: respeta monto
 * - manual=false o monto vacío: se reparte el remanente
 * Regla simple:
 *   - si hay >=1 auto: reparte igual entre autos (y el último se queda con el ajuste por redondeo)
 *   - si no hay autos: valida que suma manual == total (si no, error)
 */
function normalizeAndDistributeGlosas(inputGlosas, total) {
  const glosas = Array.isArray(inputGlosas) ? inputGlosas : [];

  if (glosas.length === 0) {
    throw new Error("Debes enviar al menos 1 glosa.");
  }

  // Normaliza orden + flags
  const norm = glosas.map((g, i) => {
    const desc = String(g?.descripcion || "").trim();
    if (!desc) throw new Error(`Glosa #${i + 1}: Falta descripción.`);
    const manual = !!g?.manual;
    const montoRaw =
      g?.monto == null || String(g.monto).trim() === "" ? null : Number(g.monto);

    const monto =
      montoRaw == null
        ? null
        : Number.isFinite(montoRaw)
        ? Math.max(0, round0(montoRaw))
        : NaN;

    if (monto === NaN) throw new Error(`Glosa #${i + 1}: monto inválido.`);

    return {
      descripcion: desc,
      manual,
      monto, // puede ser null si es auto
      orden: Number.isFinite(Number(g?.orden)) ? Number(g.orden) : i,
    };
  });

  const manualSum = norm.reduce((acc, g) => acc + (g.manual ? (g.monto ?? 0) : 0), 0);
  if (manualSum > total) {
    throw new Error(
      `La suma de montos manuales (${manualSum}) no puede superar el total (${total}).`
    );
  }

  const autos = norm.filter((g) => !g.manual);
  const remanente = total - manualSum;

  if (autos.length === 0) {
    // todo manual => debe calzar exacto con el total
    if (manualSum !== total) {
      throw new Error(
        `Las glosas manuales suman ${manualSum}, pero el total es ${total}. Ajusta los montos.`
      );
    }
    return norm.map((g) => ({ ...g, monto: round0(g.monto || 0) }));
  }

  // repartir remanente entre autos
  const base = autos.length > 0 ? Math.floor(remanente / autos.length) : 0;
  let restante = remanente;

  const out = norm.map((g) => {
    if (g.manual) return { ...g, monto: round0(g.monto || 0) };
    // asignación base (el último auto corrige)
    return { ...g, monto: base };
  });

  // corregir el último auto con el ajuste por redondeo
  // (remanente - base*autos.length)
  const ajuste = remanente - base * autos.length;
  if (ajuste !== 0) {
    // encuentra el último auto en el array original
    for (let i = out.length - 1; i >= 0; i--) {
      if (!out[i].manual) {
        out[i].monto = round0(out[i].monto + ajuste);
        break;
      }
    }
  }

  // sanity
  const sum = out.reduce((acc, g) => acc + (Number(g.monto) || 0), 0);
  if (sum !== total) {
    // por seguridad
    throw new Error(`Error de distribución: suma glosas ${sum} != total ${total}.`);
  }

  return out;
}

/* =========================
   GET /cotizaciones
========================= */
export const listCotizaciones = async (request, reply) => {
  try {
    const empresaId = getEmpresaId(request);
    const { estado } = request.query || {};

    const where = {
      empresa_id: empresaId,
      eliminado: false,
      ...(estado ? { estado } : {}),
    };

    const cotizaciones = await prisma.cotizacion.findMany({
      where,
      orderBy: { creada_en: "desc" },
      include: {
        cliente: true,
        proyecto: true,
        glosas: { orderBy: { orden: "asc" } },
      },
    });

    return reply.send(cotizaciones);
  } catch (e) {
    return reply.code(e.statusCode || 500).send({
      error: "Error al listar cotizaciones",
      detalle: e.message,
    });
  }
};

/* =========================
   GET /cotizaciones/:id
========================= */
export const getCotizacion = async (request, reply) => {
  try {
    const empresaId = getEmpresaId(request);
    const { id } = request.params;

    const cot = await prisma.cotizacion.findFirst({
      where: { id, empresa_id: empresaId, eliminado: false },
      include: {
        proyecto: true,
        cliente: true,
        glosas: { orderBy: { orden: "asc" } },
      },
    });

    if (!cot) return reply.code(404).send({ error: "Cotización no encontrada" });

    return reply.send(cot);
  } catch (e) {
    return reply.code(e.statusCode || 500).send({
      error: "Error al obtener cotización",
      detalle: e.message,
    });
  }
};

/* =========================
   POST /cotizaciones
   Crea cotización con glosas
   - cliente obligatorio
   - proyecto NO obligatorio
   - total obligatorio
   - glosas: [{descripcion, monto?, manual?}]
========================= */
export const createCotizacion = async (request, reply) => {
  try {
    const empresaId = getEmpresaId(request);

    const {
      cliente_id,
      asunto,
      terminos_condiciones,
      acuerdo_pago,
      ivaRate = 0.19,

      // total principal
      total,

      // glosas
      glosas = [],
    } = request.body || {};

    if (!cliente_id) return reply.code(400).send({ error: "cliente_id es obligatorio" });

    const totalNum = Number(total);
    if (!Number.isFinite(totalNum) || totalNum <= 0) {
      return reply.code(400).send({ error: "total inválido (entero > 0)" });
    }

    const { subtotal, iva, total: totalInt } = calcFromTotal(totalNum, ivaRate);

    const created = await prisma.$transaction(async (tx) => {
      // validar cliente scope empresa
      const cliente = await tx.cliente.findFirst({
        where: { id: cliente_id, empresa_id: empresaId, eliminado: false },
        select: { id: true },
      });
      if (!cliente) throw new Error("Cliente inválido");

      // distribuir glosas
      const glosasDistribuidas = normalizeAndDistributeGlosas(glosas, totalInt);

      // crear cot
      const cot = await tx.cotizacion.create({
        data: {
          empresa_id: empresaId,
          // proyecto_id: null al crear (por tu requerimiento)
          proyecto_id: null,
          cliente_id,
          asunto: asunto || null,
          terminos_condiciones: terminos_condiciones || null,
          acuerdo_pago: acuerdo_pago || null,
          subtotal,
          iva,
          total: totalInt,
          estado: "COTIZACION",
          glosas: {
            create: glosasDistribuidas.map((g, idx) => ({
              descripcion: g.descripcion,
              monto: g.monto,
              manual: !!g.manual,
              orden: Number.isFinite(Number(g.orden)) ? Number(g.orden) : idx,
            })),
          },
        },
        include: {
          cliente: true,
          proyecto: true,
          glosas: { orderBy: { orden: "asc" } },
        },
      });

      return cot;
    });

    return reply.code(201).send(created);
  } catch (e) {
    return reply.code(e.statusCode || 400).send({
      error: "Error al crear cotización",
      detalle: e.message,
    });
  }
};

/* =========================
   PUT /cotizaciones/:id
   Actualiza cabecera: asunto, términos, acuerdo, cliente, total (recalcula glosas autos)
========================= */
export const updateCotizacion = async (request, reply) => {
  try {
    const empresaId = getEmpresaId(request);
    const { id } = request.params;

    const {
      cliente_id,
      asunto,
      terminos_condiciones,
      acuerdo_pago,
      ivaRate = 0.19,
      total,
      glosas, // opcional: si lo mandas, reemplaza glosas completas
      proyecto_id, // opcional: para asignar después
    } = request.body || {};

    const existing = await prisma.cotizacion.findFirst({
      where: { id, empresa_id: empresaId, eliminado: false },
      include: { glosas: { orderBy: { orden: "asc" } } },
    });
    if (!existing) return reply.code(404).send({ error: "Cotización no encontrada" });

    const nextTotal =
      total == null || String(total).trim() === ""
        ? Number(existing.total || 0)
        : Number(total);

    if (!Number.isFinite(nextTotal) || nextTotal <= 0) {
      return reply.code(400).send({ error: "total inválido (entero > 0)" });
    }

    const { subtotal, iva, total: totalInt } = calcFromTotal(nextTotal, ivaRate);

    const updated = await prisma.$transaction(async (tx) => {
      // validar cliente si cambia
      if (cliente_id) {
        const c = await tx.cliente.findFirst({
          where: { id: cliente_id, empresa_id: empresaId, eliminado: false },
          select: { id: true },
        });
        if (!c) throw new Error("Cliente inválido");
      }

      // validar proyecto si viene (asignación posterior)
      if (proyecto_id) {
        const p = await tx.proyecto.findFirst({
          where: { id: proyecto_id, empresa_id: empresaId, eliminado: false },
          select: { id: true },
        });
        if (!p) throw new Error("Proyecto inválido");
      }

      // si vienen glosas, las reemplazamos
      if (Array.isArray(glosas)) {
        const distrib = normalizeAndDistributeGlosas(glosas, totalInt);

        // borrar glosas antiguas
        await tx.cotizacionGlosa.deleteMany({ where: { cotizacion_id: id } });

        // crear nuevas
        await tx.cotizacionGlosa.createMany({
          data: distrib.map((g, idx) => ({
            cotizacion_id: id,
            descripcion: g.descripcion,
            monto: g.monto,
            manual: !!g.manual,
            orden: Number.isFinite(Number(g.orden)) ? Number(g.orden) : idx,
          })),
        });
      } else {
        // no vinieron glosas: si el total cambió, recalcular SOLO autos en base a manuales existentes
        const current = existing.glosas || [];
        if (Number(existing.total || 0) !== totalInt && current.length) {
          const payload = current.map((g, i) => ({
            descripcion: g.descripcion,
            monto: g.monto,
            manual: g.manual,
            orden: g.orden ?? i,
          }));
          const distrib = normalizeAndDistributeGlosas(payload, totalInt);

          // update cada glosa
          for (let i = 0; i < current.length; i++) {
            await tx.cotizacionGlosa.update({
              where: { id: current[i].id },
              data: { monto: distrib[i].monto, manual: distrib[i].manual, orden: distrib[i].orden },
            });
          }
        }
      }

      return tx.cotizacion.update({
        where: { id },
        data: {
          ...(cliente_id ? { cliente_id } : {}),
          ...(proyecto_id !== undefined ? { proyecto_id: proyecto_id || null } : {}),
          asunto: asunto !== undefined ? (asunto || null) : undefined,
          terminos_condiciones:
            terminos_condiciones !== undefined ? (terminos_condiciones || null) : undefined,
          acuerdo_pago: acuerdo_pago !== undefined ? (acuerdo_pago || null) : undefined,
          subtotal,
          iva,
          total: totalInt,
        },
        include: {
          cliente: true,
          proyecto: true,
          glosas: { orderBy: { orden: "asc" } },
        },
      });
    });

    return reply.send(updated);
  } catch (e) {
    return reply.code(e.statusCode || 400).send({
      error: "Error al actualizar cotización",
      detalle: e.message,
    });
  }
};

/* =========================
   POST /cotizaciones/:id/estado
========================= */
export const updateCotizacionEstado = async (request, reply) => {
  try {
    const empresaId = getEmpresaId(request);
    const { id } = request.params;
    const { estado } = request.body || {};

    const valid = ["COTIZACION", "ORDEN_VENTA", "FACTURADA", "PAGADA"];
    if (!valid.includes(estado)) {
      return reply.code(400).send({ error: "Estado inválido" });
    }

    const allowed = {
      COTIZACION: ["ORDEN_VENTA"],
      ORDEN_VENTA: ["FACTURADA"],
      FACTURADA: ["PAGADA"],
      PAGADA: [],
    };

    const actual = await prisma.cotizacion.findFirst({
      where: { id, empresa_id: empresaId, eliminado: false },
      select: { estado: true },
    });

    if (!actual) return reply.code(404).send({ error: "Cotización no encontrada" });

    if (!allowed[actual.estado].includes(estado)) {
      return reply.code(400).send({
        error: `Transición no permitida: ${actual.estado} → ${estado}`,
      });
    }

    const updated = await prisma.cotizacion.update({
      where: { id },
      data: { estado },
      include: {
        proyecto: true,
        cliente: true,
        glosas: { orderBy: { orden: "asc" } },
      },
    });

    return reply.send(updated);
  } catch (e) {
    return reply.code(e.statusCode || 500).send({
      error: "Error al actualizar estado",
      detalle: e.message,
    });
  }
};
