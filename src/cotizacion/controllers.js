// src/modules/cotizaciones/controllers.js
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

/* =========================
   Helpers (scope JWT)
========================= */
function getScope(request) {
  const empresaId =
    request?.scope?.empresaId ??
    request?.headers?.["x-empresa-id"] ??
    null;

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

  // Solo obliga empresa para no-MASTER (igual que tu authz.js)
  const rolCodigo = request?.scope?.rolCodigo ?? request?.user?.rol?.codigo ?? null;
  if (!empresaId && rolCodigo !== "MASTER") {
    const err = new Error("Falta empresa en el contexto");
    err.statusCode = 401;
    throw err;
  }

  return { empresaId: empresaId ? String(empresaId) : null, userId: String(userId), rolCodigo };
}

const round0 = (n) => Math.round(Number(n || 0));

function calcTotalVenta(v) {
  return (v?.detalles || []).reduce(
    (s, d) => s + (Number(d.total ?? d.ventaTotal) || 0),
    0
  );
}

function calcFromSubtotal(subtotalNeto, ivaRate = 0.19) {
  const subtotal = round0(subtotalNeto);
  const rate = Number(ivaRate);
  const r = Number.isFinite(rate) ? rate : 0.19;
  const iva = round0(subtotal * r);
  const total = round0(subtotal + iva);
  return { subtotal, iva, total, ivaRate: r };
}

function sumGlosas(glosas) {
  return (glosas || []).reduce((acc, g) => acc + round0(g?.monto || 0), 0);
}


function normalizeVigenciaDias(v) {
  if (v === undefined || v === null || v === "") return 15; // default “lógico”
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("vigencia_dias inválido");
  const i = Math.trunc(n);
  if (i < 1 || i > 365) throw new Error("vigencia_dias debe estar entre 1 y 365");
  return i;
}


/**
 * Normaliza glosas:
 * - descripcion obligatoria
 * - monto entero >= 0
 * - manual boolean
 * - orden (default index)
 * NO distribuye aquí (tu UI ya distribuye). Solo validamos y ordenamos.
 */
function normalizeGlosas(inputGlosas) {
  const glosas = Array.isArray(inputGlosas) ? inputGlosas : [];
  if (glosas.length === 0) return [];

  return glosas.map((g, i) => {
    const desc = String(g?.descripcion || "").trim();
    if (!desc) throw new Error(`Glosa #${i + 1}: Falta descripción.`);

    const montoRaw = Number(g?.monto ?? 0);
    if (!Number.isFinite(montoRaw) || montoRaw < 0) {
      throw new Error(`Glosa #${i + 1}: monto inválido.`);
    }

    return {
      descripcion: desc,
      monto: round0(montoRaw),
      manual: !!g?.manual,
      orden: Number.isFinite(Number(g?.orden)) ? Number(g.orden) : i,
    };
  });
}

/* =========================
   GET /cotizaciones
========================= */
export const listCotizaciones = async (request, reply) => {
  try {
    const { empresaId } = getScope(request);
    const { estado } = request.query || {};

    const where = {
      ...(empresaId ? { empresa_id: empresaId } : {}),
      eliminado: false,
      ...(estado ? { estado } : {}),
    };

    const cotizaciones = await prisma.cotizacion.findMany({
      where,
      orderBy: { creada_en: "desc" },
      include: {
        cliente: { select: { id: true, nombre: true, rut: true } },
        proyecto: true,
        vendedor: { select: { id: true, nombre: true, correo: true } },
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

export const getCotizacion = async (request, reply) => {
  try {
    const { empresaId } = getScope(request);
    const { id } = request.params;

    const cot = await prisma.cotizacion.findFirst({
      where: {
        id,
        ...(empresaId ? { empresa_id: empresaId } : {}),
        eliminado: false,
      },
      include: {
        proyecto: true,
        cliente: { select: { id: true, nombre: true, rut: true, direccion: true } },
        vendedor: { select: { id: true, nombre: true, correo: true } },
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
   POST /cotizaciones/add
   ✅ Crea cotización DESDE ventas seleccionadas (costeo):
   - cliente obligatorio
   - proyecto NO obligatorio (null al crear)
   - vendedor_id desde JWT/session
   - ventaIds obligatorio
   - subtotal neto = suma de ventas (detalles.total / ventaTotal)
   - iva/total calculados
   - glosas deben sumar SUBTOTAL neto
========================= */
export const createCotizacion = async (request, reply) => {
  try {
    const { empresaId, userId } = getScope(request);

    const {
      cliente_id,
      asunto,
      terminos_condiciones,
      acuerdo_pago,
      ivaRate = 0.19,
      vigencia_dias,

      // ✅ requerido
      ventaIds = [],

      // ✅ glosas (suman subtotal neto)
      glosas = [],
    } = request.body || {};

    if (!cliente_id) return reply.code(400).send({ error: "cliente_id es obligatorio" });

    if (!Array.isArray(ventaIds) || ventaIds.length === 0) {
      return reply.code(400).send({ error: "Debes enviar ventaIds (al menos 1 venta)" });
    }

    const ivaRateNum = Number(ivaRate);
    if (!Number.isFinite(ivaRateNum) || ivaRateNum < 0 || ivaRateNum > 1) {
      return reply.code(400).send({ error: "ivaRate inválido (ej: 0.19)" });
    }

    const vigenciaDias = normalizeVigenciaDias(vigencia_dias);


    const created = await prisma.$transaction(async (tx) => {
      // validar cliente scope empresa
      const cliente = await tx.cliente.findFirst({
        where: { id: cliente_id, empresa_id: empresaId, eliminado: false },
        select: { id: true },
      });
      if (!cliente) throw new Error("Cliente inválido");

      // cargar ventas con detalles
      const ventas = await tx.venta.findMany({
        where: { id: { in: ventaIds } },
        include: { detalles: true },
      });

      if (ventas.length !== ventaIds.length) {
        throw new Error("Una o más ventas no existen");
      }

      // calcular subtotal neto desde ventas
      const subtotalBase = ventas.reduce((acc, v) => acc + calcTotalVenta(v), 0);
      if (!subtotalBase || subtotalBase <= 0) {
        throw new Error("El subtotal neto calculado desde ventas es 0");
      }

      const { subtotal, iva, total } = calcFromSubtotal(subtotalBase, ivaRateNum);

      // normalizar glosas
      let glosasFinal = normalizeGlosas(glosas).sort((a, b) => a.orden - b.orden);

      // si no vienen glosas, crear 1 automática con el subtotal neto
      if (glosasFinal.length === 0) {
        glosasFinal = [
          {
            descripcion: (String(asunto || "").trim() || "Servicios").slice(0, 250),
            monto: subtotal,
            manual: true,
            orden: 0,
          },
        ];
      }

      // validar que glosas sumen SUBTOTAL neto
      const suma = sumGlosas(glosasFinal);
      if (suma !== subtotal) {
        throw new Error(
          `Las glosas deben sumar el subtotal neto. Suma glosas=${suma} vs subtotal=${subtotal}`
        );
      }

      // crear cotización
      const cot = await tx.cotizacion.create({
        data: {
          empresa_id: empresaId,
          proyecto_id: null,
          cliente_id,
          vendedor_id: userId, // ✅ vendedor desde token
          asunto: asunto || null,
          terminos_condiciones: terminos_condiciones || null,
          acuerdo_pago: acuerdo_pago || null,

          vigencia_dias: vigenciaDias,

          subtotal,
          iva,
          total,

          estado: "COTIZACION",

          glosas: {
            create: glosasFinal.map((g, idx) => ({
              descripcion: g.descripcion,
              monto: g.monto,
              manual: !!g.manual,
              orden: Number.isFinite(Number(g.orden)) ? Number(g.orden) : idx,
            })),
          },

          // ✅ relacionar ventas a esta cotización (si tu modelo usa ordenVentaId)
          // OJO: tu modelo actual usa ventas: Venta[] (relación). Si en tu schema
          // la relación se hace por ordenVentaId en Venta, esto lo deja vinculado:
          ventas: {
            connect: ventaIds.map((id) => ({ id })),
          },
        },
        include: {
          cliente: true,
          proyecto: true,
          vendedor: { select: { id: true, nombre: true, correo: true } },
          glosas: { orderBy: { orden: "asc" } },
          ventas: { include: { detalles: true } },
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
   (se mantiene, pero ahora:
   - NO recalcula por total manual (eso ya no se usa en este flujo)
   - Permite editar: asunto, términos, acuerdo, cliente, proyecto
   - Permite reemplazar glosas (deben sumar subtotal actual)
========================= */
export const updateCotizacion = async (request, reply) => {
  try {
    const { empresaId } = getScope(request);
    const { id } = request.params;

    const {
      cliente_id,
      asunto,
      terminos_condiciones,
      acuerdo_pago,
      vigencia_dias,
      glosas, // opcional: si lo mandas, reemplaza glosas completas
      proyecto_id, // opcional
    } = request.body || {};

    const existing = await prisma.cotizacion.findFirst({
      where: { id, empresa_id: empresaId, eliminado: false },
      include: { glosas: { orderBy: { orden: "asc" } } },
    });

    if (!existing) return reply.code(404).send({ error: "Cotización no encontrada" });

    const updated = await prisma.$transaction(async (tx) => {
      // validar cliente si cambia
      if (cliente_id) {
        const c = await tx.cliente.findFirst({
          where: { id: cliente_id, empresa_id: empresaId, eliminado: false },
          select: { id: true },
        });
        if (!c) throw new Error("Cliente inválido");
      }

      // validar proyecto si viene
      if (proyecto_id) {
        const p = await tx.proyecto.findFirst({
          where: { id: proyecto_id, empresa_id: empresaId, eliminado: false },
          select: { id: true },
        });
        if (!p) throw new Error("Proyecto inválido");
      }

      // si vienen glosas, las reemplazamos (deben sumar subtotal neto actual)
      if (Array.isArray(glosas)) {
        const distrib = normalizeGlosas(glosas).sort((a, b) => a.orden - b.orden);

        const suma = sumGlosas(distrib);
        if (suma !== round0(existing.subtotal)) {
          throw new Error(
            `Las glosas deben sumar el subtotal neto (${round0(existing.subtotal)}). Suma glosas=${suma}.`
          );
        }

        await tx.cotizacionGlosa.deleteMany({ where: { cotizacion_id: id } });

        await tx.cotizacionGlosa.createMany({
          data: distrib.map((g, idx) => ({
            cotizacion_id: id,
            descripcion: g.descripcion,
            monto: g.monto,
            manual: !!g.manual,
            orden: Number.isFinite(Number(g.orden)) ? Number(g.orden) : idx,
          })),
        });
      }

      return tx.cotizacion.update({
        where: { id },
        data: {
          ...(cliente_id ? { cliente_id } : {}),
          ...(proyecto_id !== undefined ? { proyecto_id: proyecto_id || null } : {}),
          ...(vigencia_dias !== undefined ? { vigencia_dias: normalizeVigenciaDias(vigencia_dias) } : {}),
          asunto: asunto !== undefined ? (asunto || null) : undefined,
          terminos_condiciones:
            terminos_condiciones !== undefined ? (terminos_condiciones || null) : undefined,
          acuerdo_pago: acuerdo_pago !== undefined ? (acuerdo_pago || null) : undefined,
        },
        include: {
          cliente: true,
          proyecto: true,
          vendedor: { select: { id: true, nombre: true, correo: true } },
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
    const { empresaId } = getScope(request);
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
        vendedor: { select: { id: true, nombre: true, correo: true } },
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
