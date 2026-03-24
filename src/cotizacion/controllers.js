// src/modules/cotizaciones/controllers.js
import { PrismaClient } from "@prisma/client";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const prisma = new PrismaClient();

/* =========================
   Helpers (scope JWT)
========================= */
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

  // Solo obliga empresa para no-MASTER (igual que tu authz.js)
  const rolCodigo =
    request?.scope?.rolCodigo ?? request?.user?.rol?.codigo ?? null;
  if (!empresaId && rolCodigo !== "MASTER") {
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



//////////////////////////////////
const round0 = (n) => Math.round(Number(n || 0));

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(99.99, n));
}

function calcTotalVenta(v) {
  // usa total o ventaTotal (según tu modelo)
  return (v?.detalles || []).reduce(
    (s, d) => s + (Number(d.total ?? d.ventaTotal) || 0),
    0
  );
}

function normalizeVigenciaDias(v) {
  if (v === undefined || v === null || v === "") return 15;
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  return Math.trunc(n);
}

function normalizeGlosas(glosas) {
  const list = Array.isArray(glosas) ? glosas : [];
  return list
    .map((g, idx) => ({
      descripcion: String(g?.descripcion || "").trim().slice(0, 250),
      monto: round0(g?.monto || 0), // BRUTO
      cantidad: Number(g?.cantidad || 1),
      precio_unitario: Number(g?.precio_unitario || g?.monto || 0),
      manual: !!g?.manual,
      orden: Number.isFinite(Number(g?.orden)) ? Number(g.orden) : idx,
      descuento_pct: clampPct(g?.descuento_pct ?? 0),
    }))
    .filter((g) => g.descripcion);
}

function sumBrutoGlosas(glosas) {
  return round0(glosas.reduce((acc, g) => acc + round0(g.monto || 0), 0));
}

function calcDescuentoGlosasMonto(glosas) {
  // suma de (bruto * %)
  return round0(
    glosas.reduce((acc, g) => {
      const bruto = round0(g.monto || 0);
      const pct = clampPct(g.descuento_pct || 0);
      const desc = bruto * (pct / 100);
      return acc + desc;
    }, 0)
  );
}

function calcFromSubtotal(subtotalNeto, ivaRate) {
  const sub = round0(subtotalNeto);
  const iva = round0(sub * Number(ivaRate || 0));
  const total = round0(sub + iva);
  return { subtotal: sub, iva, total };
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

// =========================
// GET
// =========================
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
        cliente: true,
        cliente_responsable: true,
        vendedor: { select: { id: true, nombre: true, correo: true } },
        glosas: { orderBy: { orden: "asc" } },
      },
    });

    if (!cot) {
      return reply.code(404).send({ error: "Cotización no encontrada" });
    }

    // Ventas relacionadas (según tu lógica)
    const ventas = await prisma.venta.findMany({
      where: {
        ordenVentaId: id,
        eliminado: false,
      },
      select: {
        id: true,
        numero: true,
        descripcion: true,
        fecha: true,
        detalles: { select: { total: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // ✅ recalcular (por si el PDF/UI lo necesita “siempre”)
    const glosas = Array.isArray(cot.glosas) ? cot.glosas : [];
    const subtotalBruto = round0(glosas.reduce((a, g) => a + round0(g.monto || 0), 0));
    const descGlosasMonto = round0(
      glosas.reduce((a, g) => {
        const bruto = round0(g.monto || 0);
        const pct = clampPct(g.descuento_pct || 0);
        return a + bruto * (pct / 100);
      }, 0)
    );
    const subtotalTrasGlosas = round0(subtotalBruto - descGlosasMonto);
    const descGeneralPct = clampPct(cot.descuento_pct || 0);
    const descGeneralMonto = round0(subtotalTrasGlosas * (descGeneralPct / 100));
    const subtotalNeto = round0(subtotalTrasGlosas - descGeneralMonto);

    return reply.send({
      ...cot,
      ventas,
      subtotal_bruto: subtotalBruto,
      descuento_glosas_monto: descGlosasMonto,
      descuento_general_monto: descGeneralMonto,
      subtotal_neto_calc: subtotalNeto,
    });
  } catch (e) {
    request.log?.error?.(e);
    return reply.code(e.statusCode || 500).send({
      error: "Error al obtener cotización",
      detalle: e.message,
    });
  }
};

// =========================
// CREATE
// =========================
export const createCotizacion = async (request, reply) => {
  try {
    const { empresaId, userId } = getScope(request);

    const {
      cliente_id,
      cliente_responsable_id,

      asunto,
      terminos_condiciones,
      acuerdo_pago,

      ivaRate = 0.19,
      vigencia_dias,

      // ✅ descuento general (backend espera ESTE nombre)
      descuento_pct = 0,

      ventaIds = [],
      glosas = [],
    } = request.body || {};

    if (!cliente_id) {
      return reply.code(400).send({ error: "cliente_id es obligatorio" });
    }

    if (!Array.isArray(ventaIds) || ventaIds.length === 0) {
      return reply
        .code(400)
        .send({ error: "Debes enviar ventaIds (al menos 1 venta)" });
    }

    const ivaRateNum = Number(ivaRate);
    if (!Number.isFinite(ivaRateNum) || ivaRateNum < 0 || ivaRateNum > 1) {
      return reply.code(400).send({ error: "ivaRate inválido (ej: 0.19)" });
    }

    const vigenciaDias = normalizeVigenciaDias(vigencia_dias);
    if (!Number.isFinite(vigenciaDias) || vigenciaDias < 1 || vigenciaDias > 365) {
      return reply.code(400).send({ error: "vigencia_dias inválido (1..365)" });
    }

    const descGeneralPct = clampPct(descuento_pct);

    const created = await prisma.$transaction(async (tx) => {
      // Validar cliente dentro de la empresa
      const cliente = await tx.cliente.findFirst({
        where: { id: cliente_id, empresa_id: empresaId, eliminado: false },
        select: { id: true },
      });
      if (!cliente) throw new Error("Cliente inválido");

      // Validar responsable (si viene)
      let responsable = null;
      if (cliente_responsable_id) {
        responsable = await tx.clienteResponsable.findFirst({
          where: {
            id: cliente_responsable_id,
            cliente_id: cliente_id,
            eliminado: false,
          },
          select: { id: true },
        });
        if (!responsable) {
          throw new Error("cliente_responsable_id inválido para este cliente");
        }
      }

      // Cargar ventas + detalles
      const ventas = await tx.venta.findMany({
        where: { id: { in: ventaIds } },
        include: { detalles: true },
      });

      if (ventas.length !== ventaIds.length) {
        throw new Error("Una o más ventas no existen");
      }

      // Subtotal base desde ventas (BRUTO)
      const subtotalBase = round0(
        ventas.reduce((acc, v) => acc + calcTotalVenta(v), 0),
      );
      if (!subtotalBase || subtotalBase <= 0) {
        throw new Error("El subtotal calculado desde ventas es 0");
      }

      // Normalizar glosas (BRUTO)
      let glosasFinal = normalizeGlosas(glosas).sort((a, b) => a.orden - b.orden);

      if (glosasFinal.length === 0) {
        glosasFinal = [
          {
            descripcion: (String(asunto || "").trim() || "Servicios").slice(0, 250),
            monto: subtotalBase,
            manual: true,
            orden: 0,
            descuento_pct: 0,
          },
        ];
      }

      // ✅ VALIDACIÓN: glosas deben sumar subtotalBase (BRUTO)
      const sumaBruto = sumBrutoGlosas(glosasFinal);
      if (sumaBruto !== subtotalBase) {
        throw new Error(
          `Las glosas deben sumar el subtotal BRUTO. Suma glosas=${sumaBruto} vs ventas=${subtotalBase}`,
        );
      }

      // =====================================================
      // ✅ EXCLUSIVIDAD: NO permitir ambos tipos de descuento
      // =====================================================
      const hayDescGlosa = glosasFinal.some(
        (g) => clampPct(g.descuento_pct || 0) > 0,
      );

      if (descGeneralPct > 0 && hayDescGlosa) {
        throw new Error(
          "No puedes usar descuento general y descuento por glosas al mismo tiempo. Deja uno en 0.",
        );
      }

      // ✅ Cálculo descuentos
      const descGlosasMonto = hayDescGlosa ? calcDescuentoGlosasMonto(glosasFinal) : 0;
      const subtotalTrasGlosas = round0(subtotalBase - descGlosasMonto);

      const descGeneralMonto =
        descGeneralPct > 0
          ? round0(subtotalTrasGlosas * (descGeneralPct / 100))
          : 0;

      const subtotalNeto = round0(subtotalTrasGlosas - descGeneralMonto);

      if (subtotalNeto < 0) {
        throw new Error("El subtotal neto quedó negativo (revisa descuentos).");
      }

      const { subtotal, iva, total } = calcFromSubtotal(subtotalNeto, ivaRateNum);

      // Fechas
      const fechaDocumento = new Date();
      const vencimientoDocumento = new Date(fechaDocumento);
      vencimientoDocumento.setDate(vencimientoDocumento.getDate() + vigenciaDias);

      // Crear cotización
      const cot = await tx.cotizacion.create({
        data: {
          empresa_id: empresaId,
          proyecto_id: null,
          cliente_id,
          cliente_responsable_id: responsable?.id ?? null,

          vendedor_id: userId,
          asunto: asunto || null,
          terminos_condiciones: terminos_condiciones || null,
          acuerdo_pago: acuerdo_pago || null,

          vigencia_dias: vigenciaDias,
          fecha_documento: fechaDocumento,
          vencimiento_documento: vencimientoDocumento,

          // ✅ totales netos (después de descuentos)
          subtotal,
          iva,
          total,

          // ✅ descuento general guardado
          descuento_pct: descGeneralPct,
          descuento_monto: descGeneralMonto,

          estado: "COTIZACION",

          glosas: {
            create: glosasFinal.map((g, idx) => ({
              descripcion: g.descripcion,
              monto: round0(g.monto || 0), // BRUTO
              manual: !!g.manual,
              orden: Number.isFinite(Number(g.orden)) ? Number(g.orden) : idx,
              // si hay general, esto igual debería venir 0, pero lo guardamos tal cual:
              descuento_pct: clampPct(g.descuento_pct || 0),
            })),
          },

          ventas: {
            connect: ventaIds.map((id) => ({ id })),
          },
        },
        include: {
          cliente: true,
          cliente_responsable: true,
          proyecto: true,
          vendedor: { select: { id: true, nombre: true, correo: true } },
          glosas: { orderBy: { orden: "asc" } },
          ventas: { include: { detalles: true } },
        },
      });

      // ✅ adjuntamos campos calculados útiles
      return {
        ...cot,
        subtotal_bruto: subtotalBase,
        descuento_glosas_monto: descGlosasMonto,
        descuento_general_monto: descGeneralMonto,
        subtotal_neto: subtotal,
      };
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
========================= */

/* =========================
   PUT /cotizaciones/:id
========================= */
export const updateCotizacion = async (request, reply) => {
  try {
    const { empresaId, userId } = getScope(request);
    const { id } = request.params;

    const {
      cliente_id,
      cliente_responsable_id,

      asunto,
      terminos_condiciones,
      acuerdo_pago,

      ivaRate = 0.19,
      vigencia_dias,

      // ✅ mismo nombre que create
      descuento_pct,
      
      fecha_documento,
      vencimiento_documento,
      vendedor_id,

      ventaIds, // puede ser [] o undefined
      glosas, // puede venir [] o undefined

      proyecto_id,
    } = request.body || {};

    // =========================
    // Obtener cotización actual
    // =========================
    const existing = await prisma.cotizacion.findFirst({
      where: { id, empresa_id: empresaId, eliminado: false },
      include: {
        glosas: { orderBy: { orden: "asc" } },
        ventas: { include: { detalles: true } },
      },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Cotización no encontrada" });
    }

    // =========================
    // Determinar valores finales (fallback a existing)
    // =========================
    const finalClienteId = cliente_id ?? existing.cliente_id;

    const ivaRateNum = Number(ivaRate ?? 0.19);
    if (!Number.isFinite(ivaRateNum) || ivaRateNum < 0 || ivaRateNum > 1) {
      return reply.code(400).send({ error: "ivaRate inválido (ej: 0.19)" });
    }

    const finalVigenciaDias =
      vigencia_dias !== undefined
        ? normalizeVigenciaDias(vigencia_dias)
        : normalizeVigenciaDias(existing.vigencia_dias);

    if (
      !Number.isFinite(finalVigenciaDias) ||
      finalVigenciaDias < 1 ||
      finalVigenciaDias > 365
    ) {
      return reply.code(400).send({ error: "vigencia_dias inválido (1..365)" });
    }

    // ✅ descuento general final (si no viene, mantener el existente)
    const descGeneralPct =
      descuento_pct !== undefined
        ? clampPct(descuento_pct)
        : clampPct(existing.descuento_pct || 0);

    // ventas:
    // - si viene ventaIds (aunque sea []) => se respeta exactamente
    // - si NO viene ventaIds => mantenemos las actuales
    const ventaIdsWasProvided = Array.isArray(ventaIds);
    const finalVentaIds = ventaIdsWasProvided
      ? ventaIds
      : (existing.ventas || []).map((v) => v.id);

    const conVentas = Array.isArray(finalVentaIds) && finalVentaIds.length > 0;

    const updated = await prisma.$transaction(async (tx) => {
      // =========================
      // Validar cliente dentro de empresa
      // =========================
      const cliente = await tx.cliente.findFirst({
        where: { id: finalClienteId, empresa_id: empresaId, eliminado: false },
        select: { id: true },
      });
      if (!cliente) throw new Error("Cliente inválido");

      // =========================
      // Validar proyecto (si viene)
      // =========================
      if (proyecto_id) {
        const p = await tx.proyecto.findFirst({
          where: { id: proyecto_id, empresa_id: empresaId, eliminado: false },
          select: { id: true },
        });
        if (!p) throw new Error("Proyecto inválido");
      }

      // =========================
      // Validar responsable (si viene)
      // Debe pertenecer al cliente final
      // =========================
      let responsable = null;

      if (cliente_responsable_id) {
        responsable = await tx.clienteResponsable.findFirst({
          where: {
            id: cliente_responsable_id,
            cliente_id: finalClienteId,
            eliminado: false,
          },
          select: { id: true },
        });

        if (!responsable) {
          throw new Error("cliente_responsable_id inválido para este cliente");
        }
      }

      // =========================
      // Normalizar glosas (BRUTO, igual create)
      // - si el request NO manda glosas => usamos las existentes
      // - si manda [] => queda auto (1 glosa)
      // =========================
      const glosasWasProvided = Array.isArray(glosas);

      let glosasFinal = glosasWasProvided
        ? normalizeGlosas(glosas).sort((a, b) => a.orden - b.orden)
        : normalizeGlosas(existing.glosas || []).sort((a, b) => a.orden - b.orden);

      // Si no vienen glosas (o vienen vacías/filtradas) => 1 automática
      if (glosasFinal.length === 0) {
        glosasFinal = [
          {
            descripcion: (
              String(asunto ?? existing.asunto ?? "").trim() || "Servicios"
            ).slice(0, 250),
            monto: 0, // se define más abajo
            manual: true,
            orden: 0,
            descuento_pct: 0,
          },
        ];
      }

      // =====================================================
      // ✅ EXCLUSIVIDAD: NO permitir ambos tipos de descuento
      // =====================================================
      const hayDescGlosa = glosasFinal.some(
        (g) => clampPct(g.descuento_pct || 0) > 0
      );

      if (descGeneralPct > 0 && hayDescGlosa) {
        throw new Error(
          "No puedes usar descuento general y descuento por glosas al mismo tiempo. Deja uno en 0."
        );
      }

      // =========================
      // Calcular subtotal base (BRUTO) según modo
      // =========================
      let subtotalBaseBruto = 0;

      if (conVentas) {
        // Cargar ventas + detalles (validar que existan)
        const ventas = await tx.venta.findMany({
          where: {
            id: { in: finalVentaIds },
            empresa_id: empresaId,
            eliminado: false,
          },
          include: { detalles: true },
        });

        if (ventas.length !== finalVentaIds.length) {
          throw new Error("Una o más ventas no existen");
        }

        // ✅ BRUTO desde ventas
        subtotalBaseBruto = round0(ventas.reduce((acc, v) => acc + calcTotalVenta(v), 0));

        if (!subtotalBaseBruto || subtotalBaseBruto <= 0) {
          throw new Error("El subtotal calculado desde ventas es 0");
        }

        // ✅ VALIDACIÓN: glosas BRUTAS deben sumar subtotalBaseBruto
        const sumaBruto = sumBrutoGlosas(glosasFinal);
        if (sumaBruto !== subtotalBaseBruto) {
          throw new Error(
            `Las glosas deben sumar el subtotal BRUTO. Suma glosas=${sumaBruto} vs ventas=${subtotalBaseBruto}`
          );
        }
      } else {
        // SIN ventas: el BRUTO lo definen glosas (BRUTO)
        subtotalBaseBruto = round0(sumBrutoGlosas(glosasFinal));

        if (!subtotalBaseBruto || subtotalBaseBruto <= 0) {
          throw new Error(
            "En cotizaciones sin ventas, las glosas deben sumar un monto mayor a 0"
          );
        }
      }

      // =========================
      // ✅ Cálculo descuentos (igual create)
      // =========================
      const descGlosasMonto = hayDescGlosa ? calcDescuentoGlosasMonto(glosasFinal) : 0;
      const subtotalTrasGlosas = round0(subtotalBaseBruto - descGlosasMonto);

      const descGeneralMonto =
        descGeneralPct > 0 ? round0(subtotalTrasGlosas * (descGeneralPct / 100)) : 0;

      const subtotalNetoBase = round0(subtotalTrasGlosas - descGeneralMonto);

      if (subtotalNetoBase < 0) {
        throw new Error("El subtotal neto quedó negativo (revisa descuentos).");
      }

      // ✅ totales netos
      const { subtotal, iva, total } = calcFromSubtotal(subtotalNetoBase, ivaRateNum);

      // Si glosa auto venía con monto 0, la ajustamos al BRUTO base (solo si quedó 1 glosa)
      // (esto es útil cuando no mandan glosas y quieres que se rellene)
      if (
        glosasFinal.length === 1 &&
        (!glosasFinal[0].monto || Number(glosasFinal[0].monto) === 0)
      ) {
        glosasFinal[0].monto = subtotalBaseBruto; // BRUTO
      }

      // Revalidación BRUTO por seguridad
      const sumaBrutoFinal = sumBrutoGlosas(glosasFinal);
      if (sumaBrutoFinal !== subtotalBaseBruto) {
        throw new Error(
          `Las glosas deben sumar el subtotal BRUTO. Suma glosas=${sumaBrutoFinal} vs base=${subtotalBaseBruto}`
        );
      }

      // =========================
      // Fechas (igual create)
      // =========================
      const fechaDocumento = fecha_documento && String(fecha_documento).length >= 10
        ? new Date(fecha_documento)
        : (existing.fecha_documento ? new Date(existing.fecha_documento) : new Date());

      const vencimientoDocumento = vencimiento_documento && String(vencimiento_documento).length >= 10
        ? new Date(vencimiento_documento)
        : new Date(fechaDocumento);

      if (!vencimiento_documento || String(vencimiento_documento).length < 10) {
        vencimientoDocumento.setDate(vencimientoDocumento.getDate() + finalVigenciaDias);
      }

      // =========================
      // Reemplazar glosas (delete + createMany)
      // guardando descuento_pct por glosa
      // =========================
      await tx.cotizacionGlosa.deleteMany({ where: { cotizacion_id: id } });

      await tx.cotizacionGlosa.createMany({
        data: glosasFinal.map((g, idx) => ({
          cotizacion_id: id,
          descripcion: g.descripcion,
          monto: round0(g.monto || 0), // ✅ BRUTO
          cantidad: Number(g.cantidad || 1),
          precio_unitario: Number(g.precio_unitario || g.monto || 0),
          manual: !!g.manual,
          orden: Number.isFinite(Number(g.orden)) ? Number(g.orden) : idx,
          descuento_pct: clampPct(g.descuento_pct || 0),
        })),
      });

      // =========================
      // Actualizar cotización (guardando descuentos)
      // =========================
      await tx.cotizacion.update({
        where: { id },
        data: {
          cliente_id: finalClienteId,
          cliente_responsable_id: responsable?.id ?? null,

          ...(proyecto_id !== undefined ? { proyecto_id: proyecto_id || null } : {}),

          vendedor_id: vendedor_id || existing.vendedor_id || userId,

          asunto: asunto !== undefined ? asunto || null : undefined,
          terminos_condiciones:
            terminos_condiciones !== undefined
              ? terminos_condiciones || null
              : undefined,
          acuerdo_pago: acuerdo_pago !== undefined ? acuerdo_pago || null : undefined,

          vigencia_dias: finalVigenciaDias,
          fecha_documento: fechaDocumento,
          vencimiento_documento: vencimientoDocumento,

          // ✅ totales netos (después de descuentos)
          subtotal,
          iva,
          total,

          // ✅ descuento general guardado
          descuento_pct: descGeneralPct,
          descuento_monto: descGeneralMonto,
        },
      });

      // =========================
      // Relación ventas
      // - si el request trajo ventaIds (aunque sea []) => hacemos set exacto
      // - si no trajo => NO tocamos relación
      // =========================
      if (ventaIdsWasProvided) {
        await tx.cotizacion.update({
          where: { id },
          data: {
            ventas: {
              set: finalVentaIds.map((x) => ({ id: x })), // si [] => queda sin ventas ✅
            },
          },
        });
      }

      // =========================
      // Respuesta final + campos calculados (igual create)
      // =========================
      const out = await tx.cotizacion.findFirst({
        where: { id, empresa_id: empresaId },
        include: {
          cliente: true,
          cliente_responsable: true,
          proyecto: true,
          vendedor: { select: { id: true, nombre: true, correo: true } },
          glosas: { orderBy: { orden: "asc" } },
          ventas: { include: { detalles: true } },
        },
      });

      return {
        ...out,
        subtotal_bruto: subtotalBaseBruto,
        descuento_glosas_monto: descGlosasMonto,
        descuento_general_monto: descGeneralMonto,
        subtotal_neto: subtotal, // neto sin IVA (ya después de descuentos)
      };
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

    const { estado, fecha_inicio_plan, fecha_fin_plan, motivo_rechazo } =
      request.body || {};

    const valid = [
      "COTIZACION",
      "ACEPTADA",
      "RECHAZADA",
      "ORDEN_VENTA",
      "FACTURADA",
      "PAGADA",
    ];
    if (!valid.includes(estado)) {
      return reply.code(400).send({ error: "Estado inválido" });
    }

    const allowed = {
      COTIZACION: ["ACEPTADA", "RECHAZADA"],
      ACEPTADA: ["ORDEN_VENTA"],
      ORDEN_VENTA: ["FACTURADA"],
      FACTURADA: ["PAGADA"],
      PAGADA: [],
      RECHAZADA: [],
    };

    const parseDate = (v) => (v ? new Date(v) : null);
    const toAceptada = estado === "ACEPTADA";
    const toRechazada = estado === "RECHAZADA";

    const inicioPlan = parseDate(fecha_inicio_plan);
    const finPlan = parseDate(fecha_fin_plan);

    if (toAceptada) {
      if (
        !inicioPlan ||
        !finPlan ||
        Number.isNaN(+inicioPlan) ||
        Number.isNaN(+finPlan)
      ) {
        return reply.code(400).send({
          error: "Faltan fechas planificadas",
          detalle:
            "Envía fecha_inicio_plan y fecha_fin_plan (YYYY-MM-DD o ISO).",
        });
      }
      if (finPlan < inicioPlan) {
        return reply.code(400).send({
          error: "Rango inválido",
          detalle:
            "La fecha fin planificada no puede ser menor que la fecha inicio planificada.",
        });
      }
    }

    if (toRechazada) {
      // motivo opcional pero si viene, lo limpiamos
      if (motivo_rechazo && String(motivo_rechazo).length > 500) {
        return reply.code(400).send({
          error: "Motivo muy largo",
          detalle: "Máximo 500 caracteres.",
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const cot = await tx.cotizacion.findFirst({
        where: { id, empresa_id: empresaId, eliminado: false },
        select: {
          id: true,
          numero: true,
          asunto: true,
          estado: true,
          proyecto_id: true,
          empresa_id: true,
        },
      });

      if (!cot) {
        const err = new Error("Cotización no encontrada");
        err.statusCode = 404;
        throw err;
      }

      if (!allowed[cot.estado]?.includes(estado)) {
        const err = new Error(
          `Transición no permitida: ${cot.estado} → ${estado}`,
        );
        err.statusCode = 400;
        throw err;
      }

      let proyectoIdFinal = cot.proyecto_id;

      // ✅ crear proyecto al ACEPTAR
      const isCotToAceptada =
        cot.estado === "COTIZACION" && estado === "ACEPTADA";
      if (isCotToAceptada && !proyectoIdFinal) {
        const asunto = String(cot.asunto || "Sin asunto").trim();
        const nombreProyecto = `${cot.numero} - ${asunto}`.slice(0, 255);

        const proyecto = await tx.proyecto.create({
          data: {
            empresa_id: cot.empresa_id,
            nombre: nombreProyecto,
            fecha_inicio_plan: inicioPlan,
            fecha_fin_plan: finPlan,
          },
          select: { id: true },
        });

        proyectoIdFinal = proyecto.id;
      }

      // ✅ si ya existía proyecto y se vuelve a setear plan (por si acaso)
      if (toAceptada && proyectoIdFinal) {
        // Calcular presupuesto (suma de costoTotal de las ventas vinculadas)
        const ventasParaPresupuesto = await tx.venta.findMany({
          where: { ordenVentaId: id, eliminado: false },
          include: { detalles: true },
        });

        const presupuestoTotal = ventasParaPresupuesto.reduce((accV, v) => {
          return accV + (v.detalles || []).reduce((accD, d) => accD + (Number(d.costoTotal) || 0), 0);
        }, 0);

        await tx.proyecto.update({
          where: { id: proyectoIdFinal },
          data: {
            fecha_inicio_plan: inicioPlan,
            fecha_fin_plan: finPlan,
            presupuesto: presupuestoTotal > 0 ? presupuestoTotal : undefined,
          },
        });
      }

      const updated = await tx.cotizacion.update({
        where: { id: cot.id },
        data: {
          estado,
          proyecto_id: proyectoIdFinal ?? null,
          motivo_rechazo: toRechazada
            ? motivo_rechazo
              ? String(motivo_rechazo).trim()
              : null
            : null,
        },
        include: {
          proyecto: true,
          cliente: true,
          vendedor: { select: { id: true, nombre: true, correo: true } },
          glosas: { orderBy: { orden: "asc" } },
        },
      });

      return updated;
    });

    return reply.send(result);
  } catch (e) {
    return reply.code(e.statusCode || 500).send({
      error: "Error al actualizar estado",
      detalle: e.message,
    });
  }
};
