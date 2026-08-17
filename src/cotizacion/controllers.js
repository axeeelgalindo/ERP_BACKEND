// src/modules/cotizaciones/controllers.js
import { PrismaClient } from "@prisma/client";
import { createRequire } from "node:module";
import fs from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";

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
const roundMoney = (n, moneda = "CLP") => {
  const val = Number(n || 0);
  if (moneda === "CLP") return Math.round(val);
  if (moneda === "UF") return Number(val.toFixed(4));
  if (moneda === "USD") return Number(val.toFixed(2));
  return Math.round(val);
};

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(99.99, n));
}

function calcTotalVenta(v) {
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

function normalizeGlosas(glosas, moneda = "CLP") {
  const list = Array.isArray(glosas) ? glosas : [];
  return list
    .map((g, idx) => {
      const precio_unitario = roundMoney(Number(g?.precio_unitario || g?.monto || 0), moneda);
      const monto = roundMoney(g?.monto !== undefined && g?.monto !== null ? Number(g.monto) : (precio_unitario * Number(g?.cantidad || 1)), moneda);
      const monto_uf = moneda === "UF" ? (g?.monto_uf !== undefined ? Number(g?.monto_uf || 0) : precio_unitario) : null;
      return {
        descripcion: String(g?.descripcion || "").trim().slice(0, 250),
        monto,
        cantidad: Number(g?.cantidad || 1),
        precio_unitario,
        monto_uf,
        manual: !!g?.manual,
        orden: Number.isFinite(Number(g?.orden)) ? Number(g.orden) : idx,
        descuento_pct: clampPct(g?.descuento_pct ?? 0),
        comentario: g?.comentario ? String(g.comentario).trim() : null,
      };
    })
    .filter((g) => g.descripcion);
}

function sumBrutoGlosas(glosas, moneda = "CLP") {
  return roundMoney(glosas.reduce((acc, g) => acc + roundMoney(g.monto || 0, moneda), 0), moneda);
}

function calcDescuentoGlosasMonto(glosas, moneda = "CLP") {
  return roundMoney(
    glosas.reduce((acc, g) => {
      const bruto = roundMoney(g.monto || 0, moneda);
      const pct = clampPct(g.descuento_pct || 0);
      const desc = bruto * (pct / 100);
      return acc + desc;
    }, 0),
    moneda
  );
}

function calcFromSubtotal(subtotalNeto, ivaRate, sinIva = false, moneda = "CLP") {
  const sub = roundMoney(subtotalNeto, moneda);
  const iva = sinIva ? 0 : roundMoney(sub * Number(ivaRate || 0), moneda);
  const total = roundMoney(sub + iva, moneda);
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
        pagos: { where: { eliminado: false }, orderBy: { fecha: "desc" } },
        ventas: {
          where: { eliminado: false },
          include: { detalles: true },
        },
        compras: {
          where: { eliminado: false },
          select: {
            id: true,
            numero: true,
            total: true,
            estado: true,
            folio: true,
            fecha_docto: true,
            creada_en: true,
            factura_url: true,
            proveedor: { select: { id: true, nombre: true, rut: true } },
          },
          orderBy: { creada_en: "desc" },
        },
        adjuntos: { orderBy: { creado_en: "asc" } }
      },
    });

    // ✅ calcular avance de pago pct y costos de compras
    const result = cotizaciones.map((c) => {
      const totalVentas = (c.ventas || []).reduce(
        (acc, v) => acc + calcTotalVenta(v),
        0
      );
      const totalPagado = (c.pagos || []).reduce(
        (acc, p) => acc + Number(p.monto || 0),
        0
      );
      const totalCompras = (c.compras || []).reduce(
        (acc, comp) => acc + Number(comp.total || 0),
        0
      );
      const pct = c.total > 0 ? (totalPagado / c.total) * 100 : 0;
      return {
        ...c,
        total_ventas: totalVentas,
        total_pagado: totalPagado,
        total_compras: totalCompras,
        avance_pago_pct: Math.min(100, pct),
      };
    });

    return reply.send(result);
  } catch (e) {
    console.error("ERROR EN listCotizaciones:", e);
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
        empresa: true,
        proyecto: true,
        cliente: true,
        cliente_responsable: true,
        vendedor: { select: { id: true, nombre: true, correo: true } },
        glosas: { orderBy: { orden: "asc" } },
        pagos: { where: { eliminado: false }, orderBy: { fecha: "desc" } },
        compras: {
          where: { eliminado: false },
          select: {
            id: true,
            numero: true,
            total: true,
            estado: true,
            folio: true,
            fecha_docto: true,
            creada_en: true,
            factura_url: true,
            factura_numero: true,
            proveedor: { select: { id: true, nombre: true, rut: true } },
            items: { select: { id: true, item: true, cantidad: true, precio_unit: true, total: true } },
          },
          orderBy: { creada_en: "desc" },
        },
        adjuntos: { orderBy: { creado_en: "asc" } }
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
    const moneda = cot.moneda ?? "CLP";
    const subtotalBruto = sumBrutoGlosas(glosas, moneda);
    const descGlosasMonto = calcDescuentoGlosasMonto(glosas, moneda);
    const subtotalTrasGlosas = roundMoney(subtotalBruto - descGlosasMonto, moneda);
    const descGeneralPct = clampPct(cot.descuento_pct || 0);
    const descGeneralMonto = roundMoney(subtotalTrasGlosas * (descGeneralPct / 100), moneda);
    const subtotalNeto = roundMoney(subtotalTrasGlosas - descGeneralMonto, moneda);

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
async function obtenerValorUFDia() {
  // Plan A: Banco Central de Chile (SieteRestWS)
  try {
    const today = new Date();
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(today.getDate() - 5);

    const fmt = (d) => d.toISOString().split("T")[0];
    const user = "soporte@blueinge.com";
    const pass = "Blue2026!";
    const timeseries = "F073.UFF.PRE.Z.D";
    const func = "GetSeries";
    const url = `https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx?user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}&function=${func}&timeseries=${timeseries}&firstdate=${fmt(fiveDaysAgo)}&lastdate=${fmt(today)}`;

    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data?.Codigo === 0 || data?.Codigo === "0") {
        const obsList = data?.Series?.Obs;
        if (Array.isArray(obsList) && obsList.length > 0) {
          for (let i = obsList.length - 1; i >= 0; i--) {
            const val = Number(obsList[i]?.value);
            if (!isNaN(val) && val > 0) {
              console.log("[UF API] [PLAN A] Valor UF obtenido del Banco Central:", val);
              return val;
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("[UF API] Error obteniendo valor UF del Banco Central:", error);
  }

  // Plan B: mindicador.cl
  try {
    const res = await fetch("https://mindicador.cl/api/uf");
    if (res.ok) {
      const data = await res.json();
      const valor = data?.serie?.[0]?.valor;
      if (valor) {
        console.log("[UF API] [PLAN B] Valor UF obtenido de mindicador.cl:", valor);
        return Number(valor);
      }
    }
  } catch (error) {
    console.error("[UF API] Error obteniendo valor UF de mindicador.cl:", error);
  }

  // Plan C: Último valor UF registrado en la base de datos
  try {
    const lastCot = await prisma.cotizacion.findFirst({
      where: {
        valor_uf_documento: {
          gt: 0,
        },
      },
      orderBy: {
        creada_en: "desc",
      },
      select: {
        valor_uf_documento: true,
      },
    });

    if (lastCot?.valor_uf_documento) {
      const dbVal = Number(lastCot.valor_uf_documento);
      console.log("[UF API] [PLAN C] Usando última UF registrada en base de datos:", dbVal);
      return dbVal;
    }
  } catch (dbError) {
    console.error("[UF API] Error consultando última UF en base de datos:", dbError);
  }

  // Plan D: Fallback estático extremo (sin internet y base de datos vacía)
  console.warn("[UF API] [PLAN D] Usando valor UF estático base (sin internet y sin historial):", 37700);
  return 37700;
}

export const getUFActual = async (request, reply) => {
  try {
    const valor = await obtenerValorUFDia();
    return reply.send({ valor });
  } catch (e) {
    request.log?.error?.(e);
    return reply.code(500).send({
      error: "Error al obtener UF actual",
      detalle: e.message,
    });
  }
};


export const createCotizacion = async (request, reply) => {
  try {
    const { empresaId, userId } = getScope(request);

    const {
      proyecto_id,
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

      // Nuevos campos para servicios/arriendos recurrentes
      es_suscripcion = false,
      moneda = "CLP",
      ciclos_mensuales = 12,
      valor_uf_manual,
      sin_iva = false,
      parent_id,
    } = request.body || {};

    if (!cliente_id) {
      return reply.code(400).send({ error: "cliente_id es obligatorio" });
    }

    const isSusc = !!es_suscripcion;
    const hasVentas = Array.isArray(ventaIds) && ventaIds.length > 0;

    if (!isSusc && !hasVentas && (!Array.isArray(glosas) || glosas.length === 0)) {
      return reply
        .code(400)
        .send({ error: "Debes enviar ventaIds o glosas para cotizaciones estándar" });
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

    let valorUF = null;
    if (moneda === "UF") {
      if (valor_uf_manual) {
        valorUF = Number(valor_uf_manual);
      } else {
        valorUF = await obtenerValorUFDia();
      }
    }

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

      let subtotalBase = 0;
      const useGlosasDirectly = isSusc || (!isSusc && !hasVentas);

      if (!isSusc && hasVentas) {
        // Cargar ventas + detalles
        const ventas = await tx.venta.findMany({
          where: { id: { in: ventaIds } },
          include: { detalles: true },
        });

        if (ventas.length !== ventaIds.length) {
          throw new Error("Una o más ventas no existen");
        }

        // Subtotal base desde ventas (BRUTO)
        subtotalBase = roundMoney(
          ventas.reduce((acc, v) => acc + calcTotalVenta(v), 0),
          moneda
        );
        if (!subtotalBase || subtotalBase <= 0) {
          throw new Error("El subtotal calculado desde ventas es 0");
        }
      }

      // Normalizar glosas (BRUTO)
      let glosasFinal = [];
      if (useGlosasDirectly) {
        const parsedGlosas = Array.isArray(glosas) ? glosas : [];
        glosasFinal = parsedGlosas.map((g, idx) => {
          const desc = String(g?.descripcion || "").trim().slice(0, 250);
          const cantidad = Number(g?.cantidad || 1);
          
          let monto_uf = null;
          let precio_unitario = 0;
          let monto = 0;

          if (moneda === "UF" && isSusc) {
            monto_uf = Number(g?.monto_uf || 0);
            precio_unitario = Math.round(monto_uf * (valorUF || 1));
            monto = Math.round(precio_unitario * cantidad);
          } else {
            precio_unitario = roundMoney(Number(g?.precio_unitario || g?.monto || 0), moneda);
            monto = roundMoney(precio_unitario * cantidad, moneda);
            if (moneda === "UF") {
              monto_uf = precio_unitario;
            }
          }

          return {
            descripcion: desc,
            monto, 
            cantidad,
            precio_unitario, 
            monto_uf,
            manual: !!g?.manual,
            orden: Number.isFinite(Number(g?.orden)) ? Number(g.orden) : idx,
            descuento_pct: clampPct(g?.descuento_pct ?? 0),
            comentario: g?.comentario ? String(g.comentario).trim() : null,
          };
        }).filter(g => g.descripcion);

        subtotalBase = sumBrutoGlosas(glosasFinal, moneda);
      } else {
        glosasFinal = normalizeGlosas(glosas, moneda).sort((a, b) => a.orden - b.orden);

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
        const sumaBruto = sumBrutoGlosas(glosasFinal, moneda);
        // Allow a small delta (10 for CLP, 0.01 for USD/UF)
        const diff = Math.abs(sumaBruto - subtotalBase);
        const maxDiff = moneda === "CLP" ? 10 : 0.01;
        if (diff > maxDiff) {
          throw new Error(
            `Las glosas deben sumar el subtotal BRUTO. Suma glosas=${sumaBruto} vs ventas=${subtotalBase}`,
          );
        }
      }

      if (glosasFinal.length === 0) {
        throw new Error("Debes enviar al menos una glosa válida");
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
      const descGlosasMonto = hayDescGlosa ? calcDescuentoGlosasMonto(glosasFinal, moneda) : 0;
      const subtotalTrasGlosas = roundMoney(subtotalBase - descGlosasMonto, moneda);

      const descGeneralMonto =
        descGeneralPct > 0
          ? roundMoney(subtotalTrasGlosas * (descGeneralPct / 100), moneda)
          : 0;

      const subtotalNeto = roundMoney(subtotalTrasGlosas - descGeneralMonto, moneda);

      if (subtotalNeto < 0) {
        throw new Error("El subtotal neto quedó negativo (revisa descuentos).");
      }

      const finalSinIva = !!sin_iva;
      const { subtotal, iva, total } = calcFromSubtotal(subtotalNeto, ivaRateNum, finalSinIva, moneda);

      // Fechas
      const fechaDocumento = new Date();
      const vencimientoDocumento = new Date(fechaDocumento);
      vencimientoDocumento.setDate(vencimientoDocumento.getDate() + vigenciaDias);

      // Obtener el número correlativo para la empresa (secuencias separadas para suscripciones)
      let nextNumero = 1;
      if (isSusc) {
        const maxCotizacion = await tx.cotizacion.findFirst({
          where: { empresa_id: empresaId, es_suscripcion: true },
          orderBy: { numero: "desc" },
          select: { numero: true },
        });
        nextNumero = maxCotizacion ? maxCotizacion.numero + 1 : 1000001;
      } else {
        const maxCotizacion = await tx.cotizacion.findFirst({
          where: { empresa_id: empresaId, es_suscripcion: false },
          orderBy: { numero: "desc" },
          select: { numero: true },
        });
        nextNumero = maxCotizacion ? maxCotizacion.numero + 1 : 1;
      }

      // Garantizar unicidad global del número para la empresa (por si hay solapamiento o concurrencia)
      let exists = true;
      while (exists) {
        const checkExisting = await tx.cotizacion.findFirst({
          where: { empresa_id: empresaId, numero: nextNumero },
          select: { id: true },
        });
        if (checkExisting) {
          nextNumero++;
        } else {
          exists = false;
        }
      }

      // Crear cotización
      const cot = await tx.cotizacion.create({
        data: {
          numero: nextNumero,
          empresa_id: empresaId,
          proyecto_id: proyecto_id || null,
          parent_id: parent_id || null,
          cliente_id,
          cliente_responsable_id: cliente_responsable_id || null,

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
          sin_iva: finalSinIva,

          // ✅ descuento general guardado
          descuento_pct: descGeneralPct,
          descuento_monto: descGeneralMonto,

          // ✅ Nuevos campos para servicios/arriendos recurrentes
          moneda,
          valor_uf_documento: valorUF,
          es_suscripcion: isSusc,
          ciclos_mensuales: Number(ciclos_mensuales || 12),

          estado: "COTIZACION",

          glosas: {
            create: glosasFinal.map((g, idx) => ({
              descripcion: g.descripcion,
              monto: g.monto,
              cantidad: g.cantidad,
              precio_unitario: g.precio_unitario,
              monto_uf: g.monto_uf,
              manual: g.manual,
              orden: g.orden,
              descuento_pct: g.descuento_pct,
              comentario: g.comentario || null,
            })),
          },

          ...(isSusc ? {} : {
            ventas: {
              connect: ventaIds.map((id) => ({ id })),
            },
          }),
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
      proyecto_id,
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

      // Nuevos campos para servicios/arriendos recurrentes
      es_suscripcion,
      moneda,
      ciclos_mensuales,
      valor_uf_manual,
      sin_iva,
      parent_id,
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

    if (existing.estado !== "COTIZACION") {
      return reply.code(400).send({
        error: "No se puede editar una cotización que no está en estado COTIZACION",
      });
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

    const isSusc = es_suscripcion !== undefined ? !!es_suscripcion : !!existing.es_suscripcion;
    const finalMoneda = moneda ?? existing.moneda;
    const finalCiclosMensuales = ciclos_mensuales !== undefined ? Number(ciclos_mensuales) : existing.ciclos_mensuales;

    let valorUF = existing.valor_uf_documento;
    if (finalMoneda === "UF") {
      if (valor_uf_manual !== undefined) {
        valorUF = valor_uf_manual ? Number(valor_uf_manual) : null;
      } else if (!valorUF) {
        valorUF = await obtenerValorUFDia();
      }
    } else {
      valorUF = null;
    }

    // ventas:
    // - si viene ventaIds (aunque sea []) => se respeta exactamente
    // - si NO viene ventaIds => mantenemos las actuales
    const ventaIdsWasProvided = Array.isArray(ventaIds);
    const finalVentaIds = ventaIdsWasProvided
      ? ventaIds
      : (existing.ventas || []).map((v) => v.id);

    const conVentas = !isSusc && Array.isArray(finalVentaIds) && finalVentaIds.length > 0;

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
      // Normalizar glosas
      // =========================
      const glosasWasProvided = Array.isArray(glosas);
      let glosasFinal = [];

      if (glosasWasProvided) {
        if (isSusc) {
          glosasFinal = glosas.map((g, idx) => {
            const desc = String(g?.descripcion || "").trim().slice(0, 250);
            const cantidad = Number(g?.cantidad || 1);
            
            let monto_uf = null;
            let precio_unitario = 0;
            let monto = 0;

            if (finalMoneda === "UF") {
              monto_uf = g?.monto_uf !== undefined ? Number(g?.monto_uf || 0) : (g?.monto_uf ?? null);
              precio_unitario = Math.round(Number(monto_uf || 0) * (valorUF || 1));
              monto = Math.round(precio_unitario * cantidad);
            } else {
              precio_unitario = Math.round(Number(g?.precio_unitario || g?.monto || 0));
              monto = Math.round(precio_unitario * cantidad);
            }

            return {
              descripcion: desc,
              monto,
              cantidad,
              precio_unitario,
              monto_uf,
              manual: !!g?.manual,
              orden: Number.isFinite(Number(g?.orden)) ? Number(g.orden) : idx,
              descuento_pct: clampPct(g?.descuento_pct ?? 0),
              comentario: g?.comentario ? String(g.comentario).trim() : null,
            };
          }).filter(g => g.descripcion);
        } else {
          glosasFinal = normalizeGlosas(glosas, finalMoneda).sort((a, b) => a.orden - b.orden);
        }
      } else {
        // no se enviaron glosas, usamos las existentes
        glosasFinal = existing.glosas.map((g, idx) => {
          let precio_unitario = g.precio_unitario;
          let monto = g.monto;
          let monto_uf = g.monto_uf;

          if (isSusc && finalMoneda === "UF") {
            monto_uf = g.monto_uf !== null ? Number(g.monto_uf) : null;
            if (monto_uf !== null) {
              precio_unitario = Math.round(monto_uf * (valorUF || 1));
              monto = Math.round(precio_unitario * g.cantidad);
            }
          }

          return {
            descripcion: g.descripcion,
            monto,
            cantidad: g.cantidad,
            precio_unitario: precio_unitario ?? g.monto,
            monto_uf,
            manual: g.manual,
            orden: g.orden !== null ? g.orden : idx,
            descuento_pct: clampPct(g.descuento_pct || 0),
            comentario: g.comentario,
          };
        });
      }

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
            eliminado: false,
          },
          include: { detalles: true },
        });

        if (ventas.length !== finalVentaIds.length) {
          throw new Error("Una o más ventas no existen");
        }

        // ✅ BRUTO desde ventas
        subtotalBaseBruto = roundMoney(ventas.reduce((acc, v) => acc + calcTotalVenta(v), 0), finalMoneda);

        if (!subtotalBaseBruto || subtotalBaseBruto <= 0) {
          throw new Error("El subtotal calculado desde ventas es 0");
        }

        // ✅ VALIDACIÓN: glosas BRUTAS deben sumar subtotalBaseBruto
        const sumaBruto = sumBrutoGlosas(glosasFinal, finalMoneda);
        const maxDiff = finalMoneda === "CLP" ? 10 : 0.01;
        if (Math.abs(sumaBruto - subtotalBaseBruto) > maxDiff) {
          throw new Error(
            `Las glosas deben sumar el subtotal BRUTO. Suma glosas=${sumaBruto} vs ventas=${subtotalBaseBruto}`
          );
        }
      } else {
        // SIN ventas: el BRUTO lo definen glosas (BRUTO)
        subtotalBaseBruto = roundMoney(sumBrutoGlosas(glosasFinal, finalMoneda), finalMoneda);

        if (!subtotalBaseBruto || subtotalBaseBruto <= 0) {
          throw new Error(
            "En cotizaciones sin ventas, las glosas deben sumar un monto mayor a 0"
          );
        }
      }

      // =========================
      // ✅ Cálculo descuentos (igual create)
      // =========================
      const descGlosasMonto = hayDescGlosa ? calcDescuentoGlosasMonto(glosasFinal, finalMoneda) : 0;
      const subtotalTrasGlosas = roundMoney(subtotalBaseBruto - descGlosasMonto, finalMoneda);

      const descGeneralMonto =
        descGeneralPct > 0 ? roundMoney(subtotalTrasGlosas * (descGeneralPct / 100), finalMoneda) : 0;

      const subtotalNetoBase = roundMoney(subtotalTrasGlosas - descGeneralMonto, finalMoneda);

      if (subtotalNetoBase < 0) {
        throw new Error("El subtotal neto quedó negativo (revisa descuentos).");
      }

      // ✅ totales netos
      const finalSinIva = sin_iva !== undefined ? !!sin_iva : !!existing.sin_iva;
      const { subtotal, iva, total } = calcFromSubtotal(subtotalNetoBase, ivaRateNum, finalSinIva, finalMoneda);

      // Si glosa auto venía con monto 0, la ajustamos al BRUTO base (solo si quedó 1 glosa)
      // (esto es útil cuando no mandan glosas y quieres que se rellene)
      if (
        glosasFinal.length === 1 &&
        (!glosasFinal[0].monto || Number(glosasFinal[0].monto) === 0)
      ) {
        glosasFinal[0].monto = subtotalBaseBruto; // BRUTO
      }

      // Revalidación BRUTO por seguridad
      const sumaBrutoFinal = sumBrutoGlosas(glosasFinal, finalMoneda);
      const maxDiffReval = finalMoneda === "CLP" ? 10 : 0.01;
      if (Math.abs(sumaBrutoFinal - subtotalBaseBruto) > maxDiffReval) {
        throw new Error(
          `Las glosas deben sumar el subtotal BRUTO. Suma glosas=${sumaBrutoFinal} vs base=${subtotalBaseBruto}`
        );
      }

      // =========================
      // Fechas (igual create)
      // =========================
      const fechaDocumento = fecha_documento && String(fecha_documento).length >= 10
        ? new Date(`${String(fecha_documento).slice(0, 10)}T12:00:00`)
        : (existing.fecha_documento ? new Date(existing.fecha_documento) : new Date());

      const vencimientoDocumento = vencimiento_documento && String(vencimiento_documento).length >= 10
        ? new Date(`${String(vencimiento_documento).slice(0, 10)}T12:00:00`)
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
          monto: roundMoney(g.monto || 0, finalMoneda), // ✅ BRUTO
          cantidad: Number(g.cantidad || 1),
          precio_unitario: roundMoney(Number(g.precio_unitario || g.monto || 0), finalMoneda),
          monto_uf: g.monto_uf,
          manual: !!g.manual,
          orden: Number.isFinite(Number(g.orden)) ? Number(g.orden) : idx,
          descuento_pct: clampPct(g.descuento_pct || 0),
          comentario: g.comentario || null,
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
          sin_iva: finalSinIva,

          // ✅ descuento general guardado
          descuento_pct: descGeneralPct,
          descuento_monto: descGeneralMonto,

          // Nuevos campos
          moneda: finalMoneda,
          valor_uf_documento: valorUF,
          es_suscripcion: isSusc,
          ciclos_mensuales: finalCiclosMensuales,

           fecha_inicio_plan: request.body.fecha_inicio_plan !== undefined ? (request.body.fecha_inicio_plan ? new Date(request.body.fecha_inicio_plan) : null) : undefined,
          fecha_fin_plan: request.body.fecha_fin_plan !== undefined ? (request.body.fecha_fin_plan ? new Date(request.body.fecha_fin_plan) : null) : undefined,
          ...(parent_id !== undefined ? { parent_id: parent_id || null } : {}),
        },
      });

      // =========================
      // Relación ventas
      // - si el request trajo ventaIds (aunque sea []) => hacemos set exacto
      // - si no trajo => NO tocamos relación
      // =========================
      if (ventaIdsWasProvided || isSusc) {
        await tx.cotizacion.update({
          where: { id },
          data: {
            ventas: {
              set: isSusc ? [] : finalVentaIds.map((x) => ({ id: x })), // si [] o suscripción => queda sin ventas ✅
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

    const { estado, fecha_inicio_plan, fecha_fin_plan, motivo_rechazo, crear_proyecto, epica_nombre, tarea_nombre } =
      request.body || {};

    const valid = [
      "COTIZACION",
      "ACEPTADA",
      "RECHAZADA",
      "ORDEN_VENTA",
      "ENTREGADO",
      "POR_FACTURAR",
      "FACTURADA",
      "PAGADA",
    ];
    if (!valid.includes(estado)) {
      return reply.code(400).send({ error: "Estado inválido" });
    }

    const allowed = {
      COTIZACION: ["ACEPTADA", "RECHAZADA"],
      ACEPTADA: ["ORDEN_VENTA", "RECHAZADA"],
      ORDEN_VENTA: ["POR_FACTURAR"],
      POR_FACTURAR: ["FACTURADA"],
      FACTURADA: ["PAGADA"],
      PAGADA: ["ENTREGADO"],
      ENTREGADO: [],
      RECHAZADA: [],
    };

    const parseDate = (v) => (v ? new Date(`${String(v).slice(0, 10)}T12:00:00`) : null);
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
          es_suscripcion: true,
          fecha_ov: true,
          fecha_facturada: true,
          fecha_aceptada: true,
          fecha_entregado: true,
          fecha_por_facturar: true,
          fecha_pagada: true,
          fecha_rechazada: true,
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

      if (!cot.es_suscripcion && crear_proyecto !== false) {
        // ✅ crear proyecto al ACEPTAR (solo para cotizaciones que NO sean suscripciones/servicios)
        const isCotToAceptada =
          cot.estado === "COTIZACION" && estado === "ACEPTADA";
        if (isCotToAceptada && !proyectoIdFinal) {
          if (!epica_nombre || !String(epica_nombre).trim()) {
            const err = new Error("El nombre de la épica es obligatorio al crear el proyecto.");
            err.statusCode = 400;
            throw err;
          }
          if (!tarea_nombre || !String(tarea_nombre).trim()) {
            const err = new Error("El nombre de la tarea inicial es obligatorio al crear el proyecto.");
            err.statusCode = 400;
            throw err;
          }

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

          // Calcular dias_plan para la épica y tarea
          let diasPlan = null;
          if (inicioPlan && finPlan) {
            const diffMs = finPlan.getTime() - inicioPlan.getTime();
            diasPlan = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
          }

          // Crear tarea épica inicial
          const epica = await tx.epica.create({
            data: {
              empresa_id: cot.empresa_id,
              proyecto_id: proyectoIdFinal,
              nombre: String(epica_nombre).trim(),
              descripcion: "Fase inicial de planificación y definición del proyecto.",
              estado: "pendiente",
              avance: 0,
              destino: "PROYECTO",
              source: "MANUAL",
              es_planificado: true,
              fecha_inicio_plan: inicioPlan,
              fecha_fin_plan: finPlan,
              dias_plan: diasPlan,
            },
            select: { id: true }
          });

          // Crear tarea inicial asociada a la épica creada
          await tx.tarea.create({
            data: {
              empresa_id: cot.empresa_id,
              proyecto_id: proyectoIdFinal,
              destino: "PROYECTO",
              epica_id: epica.id,
              nombre: String(tarea_nombre).trim(),
              descripcion: "Tarea inicial para arrancar el proyecto.",
              estado: "pendiente",
              avance: 0,
              fecha_inicio_plan: inicioPlan,
              fecha_fin_plan: finPlan,
              dias_plan: diasPlan,
              es_planificado: true,
              source: "MANUAL",
            }
          });
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
      }

      const updateData = {
        estado,
        proyecto_id: cot.es_suscripcion ? null : (proyectoIdFinal ?? null),
        motivo_rechazo: toRechazada
          ? motivo_rechazo
            ? String(motivo_rechazo).trim()
            : null
          : null,
      };

      if (cot.es_suscripcion && toAceptada) {
        updateData.fecha_inicio_plan = inicioPlan;
        updateData.fecha_fin_plan = finPlan;
      }

      const now = new Date();
      if (estado === "ACEPTADA") {
        updateData.fecha_aceptada = now;
      } else if (estado === "ORDEN_VENTA") {
        updateData.fecha_ov = now;
        if (!cot.fecha_aceptada) updateData.fecha_aceptada = now;
      } else if (estado === "POR_FACTURAR") {
        updateData.fecha_por_facturar = now;
        if (!cot.fecha_ov) updateData.fecha_ov = now;
        if (!cot.fecha_aceptada) updateData.fecha_aceptada = now;
      } else if (estado === "FACTURADA") {
        updateData.fecha_facturada = now;
        if (!cot.fecha_por_facturar) updateData.fecha_por_facturar = now;
        if (!cot.fecha_ov) updateData.fecha_ov = now;
        if (!cot.fecha_aceptada) updateData.fecha_aceptada = now;
      } else if (estado === "PAGADA") {
        updateData.fecha_pagada = now;
        if (!cot.fecha_facturada) updateData.fecha_facturada = now;
        if (!cot.fecha_por_facturar) updateData.fecha_por_facturar = now;
        if (!cot.fecha_ov) updateData.fecha_ov = now;
        if (!cot.fecha_aceptada) updateData.fecha_aceptada = now;
      } else if (estado === "ENTREGADO") {
        updateData.fecha_entregado = now;
        if (!cot.fecha_pagada) updateData.fecha_pagada = now;
        if (!cot.fecha_facturada) updateData.fecha_facturada = now;
        if (!cot.fecha_por_facturar) updateData.fecha_por_facturar = now;
        if (!cot.fecha_ov) updateData.fecha_ov = now;
        if (!cot.fecha_aceptada) updateData.fecha_aceptada = now;
      } else if (estado === "RECHAZADA") {
        updateData.fecha_rechazada = now;
      }

      const updated = await tx.cotizacion.update({
        where: { id: cot.id },
        data: updateData,
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
    console.error("ERROR EN updateCotizacionEstado:", e);
    return reply.code(e.statusCode || 500).send({
      error: "Error al actualizar estado",
      detalle: e.message,
    });
  }
};

// =========================
// DELETE (Soft Delete)
// =========================
export const deleteCotizacion = async (request, reply) => {
  try {
    const { empresaId } = getScope(request);
    const { id } = request.params;

    const existing = await prisma.cotizacion.findFirst({
      where: { id, empresa_id: empresaId, eliminado: false },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Cotización no encontrada" });
    }

    await prisma.$transaction(async (tx) => {
      // 1) Mark Cotizacion as deleted
      await tx.cotizacion.update({
        where: { id },
        data: {
          eliminado: true,
          eliminado_en: new Date(),
        },
      });

      // 2) Unlink associated Ventas (costeos) instead of deleting them
      await tx.venta.updateMany({
        where: { ordenVentaId: id, eliminado: false },
        data: {
          ordenVentaId: null,
        },
      });
    });

    return reply.send({ ok: true });
  } catch (e) {
    return reply.code(e.statusCode || 500).send({
      error: "Error al eliminar cotización",
      detalle: e.message,
    });
  }
};

/* =====================================================
   IMPORT RCV VENTAS (SII)
   ===================================================== */
export const importVentasCSV = async (request, reply) => {
  try {
    const { empresaId, userId } = getScope(request);
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No se recibió archivo" });

    const { parse } = await import("csv-parse/sync");
    const buffer = await data.toBuffer();
    const content = buffer.toString("utf-8");

    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      delimiter: [";", ","],
      trim: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_records_with_error: true, // para ignorar líneas corruptas si las hay
    });

    if (!records.length) {
      return reply.code(400).send({ error: "CSV vacío o formato inválido" });
    }

    let created = 0;
    let skipped = 0;
    let linked = 0;

    const normRut = (r) => String(r || "").replace(/[^0-9kK]/g, "").toUpperCase();
    const normStr = (s) => String(s || "").trim().slice(0, 255);
    const toInt = (v) => parseInt(v) || 0;
    const toFloat = (v) => parseFloat(String(v || "0").replace(/\./g, "").replace(",", ".")) || 0;

      // Helper para fechas DD-MM-YYYY
    const parseDate = (str) => {
      if (!str) return null;
      const parts = str.split(/[-\/]/);
      if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
      }
      return new Date(str);
    };

    for (const row of records) {
      try {
        const tipoDoc = toInt(row["Tipo Doc"] || row["Tipo docto"]);
        const rutReceptor = normRut(
          row["Rut cliente"] ||
          row["RUT Receptor"] ||
          row["Rut Receptor"] ||
          row["RUT cliente"]
        );
        const razon = normStr(row["Razon Social"]);
        const folio = normStr(row["Folio"]);
        const fechaDocto = parseDate(row["Fecha Docto"]);
        const montoTotal = toFloat(row["Monto total"] || row["Monto Total"]);

        console.log(`[RCV Import] Row: Folio=${folio}, RUT=${rutReceptor}, Total=${montoTotal}`);

        if (!rutReceptor || !folio || montoTotal <= 0) {
          console.log(`[RCV Import] Skipping row due to missing RUT/Folio or Total <= 0`);
          continue;
        }

        await prisma.$transaction(async (tx) => {
          // 1) Cliente por RUT
          let cliente = await tx.cliente.findFirst({
            where: { empresa_id: empresaId, rut: rutReceptor, eliminado: false },
          });

          if (!cliente) {
            console.log(`[RCV Import] Creating new client: ${rutReceptor}`);
            cliente = await tx.cliente.create({
              data: {
                empresa_id: empresaId,
                rut: rutReceptor,
                nombre: razon || rutReceptor,
              },
            });
          }

          // 2) Dedupe Venta: empresa + folio + tipoDoc + rut_cliente
          const exists = await tx.venta.findFirst({
            where: {
              Cliente: { empresa_id: empresaId },
              folio,
              tipo_doc: tipoDoc,
              rut_cliente: rutReceptor,
              eliminado: false,
              // Evitar saltar si la cotización vinculada está eliminada (huérfana)
              OR: [
                { ordenVentaId: null },
                { ordenVenta: { eliminado: false } }
              ]
            },
          });

          if (exists) {
            console.log(`[RCV Import] Folio ${folio} already exists. SKIPPING.`);
            skipped++;
            return;
          }

          // 3) Match Cotizacion (exact same total + client)
          // Buscamos cotizaciones NO terminadas o que coincidan en monto
          let cot = await tx.cotizacion.findFirst({
            where: {
              empresa_id: empresaId,
              cliente_id: cliente.id,
              total: { gte: montoTotal - 1, lte: montoTotal + 1 }, // tolerancia por redondeo
              eliminado: false,
              estado: { not: "RECHAZADA" }
            },
            orderBy: { creada_en: "desc" }
          });

          let isNewCot = false;
          if (!cot) {
            console.log(`[RCV Import] No matching Cotizacion, creating draft for Folio ${folio}`);
            // Crear Borrador si no hay match
            const neto = Math.round(montoTotal / 1.19);
            const iva = montoTotal - neto;

            // Obtener el número correlativo para la empresa
            const maxCotizacion = await tx.cotizacion.findFirst({
              where: { empresa_id: empresaId, es_suscripcion: false },
              orderBy: { numero: "desc" },
              select: { numero: true },
            });
            let nextNumero = maxCotizacion ? maxCotizacion.numero + 1 : 1;

            // Garantizar unicidad global del número para la empresa
            let exists = true;
            while (exists) {
              const checkExisting = await tx.cotizacion.findFirst({
                where: { empresa_id: empresaId, numero: nextNumero },
                select: { id: true },
              });
              if (checkExisting) {
                nextNumero++;
              } else {
                exists = false;
              }
            }

            cot = await tx.cotizacion.create({
              data: {
                numero: nextNumero,
                empresa_id: empresaId,
                cliente_id: cliente.id,
                vendedor_id: userId,
                asunto: `Import RCV Folio ${folio}`,
                total: montoTotal,
                subtotal: neto,
                iva: iva,
                estado: "COTIZACION",
                glosas: {
                  create: {
                    descripcion: `Venta RCV Folio ${folio}`,
                    monto: neto,
                    cantidad: 1,
                    orden: 0
                  }
                }
              }
            });
            isNewCot = true;
          }

          // Get next Venta numero
          const maxVenta = await tx.venta.findFirst({
            where: { empresa_id: empresaId },
            orderBy: { numero: "desc" },
            select: { numero: true },
          });
          const nextVentaNumero = maxVenta ? maxVenta.numero + 1 : 1;

          // 4) Crear Venta
          await tx.venta.create({
            data: {
              empresa_id: empresaId,
              numero: nextVentaNumero,
              ordenVentaId: cot.id,
              clienteId: cliente.id,
              fecha: fechaDocto || new Date(),
              folio,
              tipo_doc: tipoDoc,
              rut_cliente: rutReceptor,
              razon_social: razon,
              total: montoTotal,
              detalles: {
                create: {
                  descripcion: `Venta RCV Folio ${folio}`,
                  cantidad: 1,
                  total: montoTotal,
                  ventaTotal: montoTotal,
                  fecha: fechaDocto || new Date(),
                }
              }
            }
          });

          if (isNewCot) {
            console.log(`[RCV Import] Created new Cotización and Venta for Folio ${folio}`);
            created++;
          } else {
            console.log(`[RCV Import] Linked Venta to existing Cotización for Folio ${folio}`);
            linked++;
          }
        });
      } catch (err) {
        console.error(`[RCV Import] Error processing row Folio=${row["Folio"]}:`, err);
      }
    }

    return reply.send({ ok: true, created, skipped, linked });
  } catch (e) {
    console.error(e);
    return reply.code(500).send({ error: "Error fatal en importación", detalle: e.message });
  }
};

/* =====================================================
   UPLOAD DOCUMENTOS ADJUNTOS
   ===================================================== */
export const uploadCotizacionDoc = async (request, reply) => {
  try {
    const { empresaId } = getScope(request);
    const { id, docType } = request.params; // "oc", "hes", "fac", "comprobante", "gd"

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No se envió ningún archivo" });

    // Validar tipo
    const validDocs = ["oc", "hes", "fac", "comprobante", "gd", "ae"];
    if (!validDocs.includes(docType)) {
      return reply.code(400).send({ error: "Tipo de documento inválido" });
    }

    // Verificar que la cotización existe y pertenece a la empresa
    const cot = await prisma.cotizacion.findFirst({
      where: { id, empresa_id: empresaId, eliminado: false }
    });

    if (!cot) {
      return reply.code(404).send({ error: "Cotización no encontrada" });
    }

    const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads", "cotizaciones");
    const relFolder = path.join(String(empresaId), String(id));
    const folderPath = path.join(UPLOADS_ROOT, relFolder);

    await fs.mkdir(folderPath, { recursive: true });

    const ext = path.extname(data.filename) || ".pdf";
    const uniqueName = `${docType}_${Date.now()}${ext}`;
    const finalPath = path.join(folderPath, uniqueName);

    await pipeline(data.file, createWriteStream(finalPath));

    const fileUrl = `/uploads/cotizaciones/${empresaId}/${id}/${uniqueName}`;
    const fieldName = `doc_${docType}_url`;

    let nuevoEstado = cot.estado;
    const est = cot.estado;
    const dateUpdates = {};
    const now = new Date();

    if (docType === "oc" && (est === "COTIZACION" || est === "ACEPTADA")) {
      nuevoEstado = "ORDEN_VENTA";
      dateUpdates.fecha_ov = now;
      if (!cot.fecha_aceptada) dateUpdates.fecha_aceptada = now;
    } else if (docType === "hes" && est === "ORDEN_VENTA") {
      nuevoEstado = "POR_FACTURAR";
      dateUpdates.fecha_por_facturar = now;
      if (!cot.fecha_ov) dateUpdates.fecha_ov = now;
      if (!cot.fecha_aceptada) dateUpdates.fecha_aceptada = now;
    } else if (docType === "fac" && est === "POR_FACTURAR") {
      nuevoEstado = "FACTURADA";
      dateUpdates.fecha_facturada = now;
      if (!cot.fecha_por_facturar) dateUpdates.fecha_por_facturar = now;
      if (!cot.fecha_ov) dateUpdates.fecha_ov = now;
      if (!cot.fecha_aceptada) dateUpdates.fecha_aceptada = now;
    } else if (docType === "comprobante" && (est === "POR_FACTURAR" || est === "FACTURADA")) {
      nuevoEstado = "PAGADA";
      dateUpdates.fecha_pagada = now;
      if (!cot.fecha_facturada) dateUpdates.fecha_facturada = now;
      if (!cot.fecha_por_facturar) dateUpdates.fecha_por_facturar = now;
      if (!cot.fecha_ov) dateUpdates.fecha_ov = now;
      if (!cot.fecha_aceptada) dateUpdates.fecha_aceptada = now;
    } else if (docType === "gd" || docType === "ae") {
      nuevoEstado = "ENTREGADO";
      dateUpdates.fecha_entregado = now;
      if (!cot.fecha_pagada) dateUpdates.fecha_pagada = now;
      if (!cot.fecha_facturada) dateUpdates.fecha_facturada = now;
      if (!cot.fecha_por_facturar) dateUpdates.fecha_por_facturar = now;
      if (!cot.fecha_ov) dateUpdates.fecha_ov = now;
      if (!cot.fecha_aceptada) dateUpdates.fecha_aceptada = now;
    }

    if (docType === "oc") {
      // OC es único, seguimos usando el campo en Cotizacion
      const updated = await prisma.cotizacion.update({
        where: { id },
        data: { 
          [fieldName]: fileUrl,
          estado: nuevoEstado,
          ...dateUpdates
        },
        include: {
          cliente: true,
          cliente_responsable: true,
          proyecto: true,
          vendedor: { select: { id: true, nombre: true, correo: true } },
          glosas: { orderBy: { orden: "asc" } },
          ventas: { include: { detalles: true } },
          pagos: true,
          adjuntos: { orderBy: { creado_en: "asc" } }
        }
      });
      return reply.send(updated);
    } else {
      // Otros tipos son múltiples, usamos la tabla CotizacionAdjunto
      const porcentaje = Number(data.fields?.porcentaje?.value || 0);

      await prisma.$transaction(async (tx) => {
        await tx.cotizacionAdjunto.create({
          data: {
            cotizacion_id: id,
            tipo: docType,
            url: fileUrl,
            nombre: data.filename || "Documento",
            porcentaje: porcentaje
          }
        });

        // Actualizamos estado de la cotización si corresponde
        await tx.cotizacion.update({
          where: { id },
          data: {
            estado: nuevoEstado,
            ...dateUpdates
          }
        });
      });

      const updated = await prisma.cotizacion.findFirst({
        where: { id },
        include: {
          cliente: true,
          cliente_responsable: true,
          proyecto: true,
          vendedor: { select: { id: true, nombre: true, correo: true } },
          glosas: { orderBy: { orden: "asc" } },
          ventas: { include: { detalles: true } },
          pagos: true,
          adjuntos: { orderBy: { creado_en: "asc" } }
        }
      });
      return reply.send(updated);
    }
  } catch (e) {
    console.error("Error uploadCotizacionDoc:", e);
    return reply.code(500).send({ error: "Error al subir documento", detalle: e.message });
  }
};

/* =====================================================
   PAGOS DE COTIZACIONES
   ===================================================== */
export const addPago = async (request, reply) => {
  try {
    const { empresaId } = getScope(request);
    const { id } = request.params;
    const { 
      monto, 
      fecha, 
      is_factoring, 
      factoring_descuento_pct, 
      factoring_descuento_monto 
    } = request.body || {};

    if (!monto || Number(monto) <= 0) return reply.code(400).send({ error: "Falta monto del pago" });

    const cot = await prisma.cotizacion.findFirst({
      where: { id, empresa_id: empresaId, eliminado: false }
    });

    if (!cot) return reply.code(404).send({ error: "Cotización no encontrada" });

    const isFactoring = Boolean(is_factoring);
    const descMonto = isFactoring && factoring_descuento_monto !== undefined && factoring_descuento_monto !== null ? Number(factoring_descuento_monto) : null;
    const descPct = isFactoring && factoring_descuento_pct !== undefined && factoring_descuento_pct !== null ? Number(factoring_descuento_pct) : null;

    if (isFactoring && descMonto !== null && descMonto > Number(monto)) {
      return reply.code(400).send({ error: "El descuento de factoring no puede superar el monto del pago" });
    }

    const pago = await prisma.cotizacionPago.create({
      data: {
        cotizacion_id: id,
        monto: Number(monto),
        fecha: fecha ? new Date(`${fecha}T12:00:00`) : new Date(),
        is_factoring: isFactoring,
        factoring_descuento_pct: descPct,
        factoring_descuento_monto: descMonto,
      }
    });

    // ✅ Autotransición a PAGADA si llega a 100% y estaba en FACTURADA
    const pagosActivos = await prisma.cotizacionPago.findMany({
      where: { cotizacion_id: id, eliminado: false }
    });
    const totalPagado = pagosActivos.reduce((acc, p) => acc + Number(p.monto || 0), 0);

    if (cot.total > 0 && totalPagado >= Number(cot.total) * 0.999 && cot.estado === "FACTURADA") {
      await prisma.cotizacion.update({
        where: { id: cot.id },
        data: { estado: "PAGADA", fecha_pagada: new Date() }
      });
    }

    return reply.send(pago);
  } catch (e) {
    console.error("Error addPago:", e);
    return reply.code(500).send({ error: "Error al agregar pago", detalle: e.message });
  }
};

export const deletePago = async (request, reply) => {
  try {
    const { empresaId } = getScope(request);
    const { pagoId } = request.params;

    const pago = await prisma.cotizacionPago.findFirst({
      where: { id: pagoId, eliminado: false },
      include: { cotizacion: true }
    });

    if (!pago || pago.cotizacion.empresa_id !== empresaId) {
      return reply.code(404).send({ error: "Pago no encontrado" });
    }

    await prisma.cotizacionPago.update({
      where: { id: pagoId },
      data: { eliminado: true, eliminado_en: new Date() }
    });

    // ✅ Autoreversión de PAGADA a FACTURADA si el total de pagos cae de 100%
    const pagosActivos = await prisma.cotizacionPago.findMany({
      where: { cotizacion_id: pago.cotizacion_id, eliminado: false }
    });
    const totalPagado = pagosActivos.reduce((acc, p) => acc + Number(p.monto || 0), 0);

    const cot = pago.cotizacion;
    if (cot.estado === "PAGADA" && totalPagado < Number(cot.total) * 0.999) {
      await prisma.cotizacion.update({
        where: { id: cot.id },
        data: { estado: "FACTURADA", fecha_pagada: null }
      });
    }

    return reply.send({ ok: true });
  } catch (e) {
    console.error("Error deletePago:", e);
    return reply.code(500).send({ error: "Error al eliminar pago", detalle: e.message });
  }
};

export const uploadPagoDoc = async (request, reply) => {
  try {
    const { empresaId } = getScope(request);
    const { pagoId } = request.params;

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No se envió ningún archivo" });

    const pago = await prisma.cotizacionPago.findFirst({
      where: { id: pagoId, eliminado: false },
      include: { cotizacion: true }
    });

    if (!pago || pago.cotizacion.empresa_id !== empresaId) {
      return reply.code(404).send({ error: "Pago no encontrado" });
    }

    const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads", "cotizaciones_pagos");
    const relFolder = path.join(String(empresaId), String(pago.cotizacion_id));
    const folderPath = path.join(UPLOADS_ROOT, relFolder);

    await fs.mkdir(folderPath, { recursive: true });

    const ext = path.extname(data.filename) || ".pdf";
    const uniqueName = `pago_${pagoId}_${Date.now()}${ext}`;
    const finalPath = path.join(folderPath, uniqueName);

    await pipeline(data.file, createWriteStream(finalPath));

    const fileUrl = `/uploads/cotizaciones_pagos/${empresaId}/${pago.cotizacion_id}/${uniqueName}`;

    const updated = await prisma.cotizacionPago.update({
      where: { id: pagoId },
      data: { 
        comprobante_url: fileUrl,
        comprobante_nombre: data.filename
      }
    });

    return reply.send(updated);
  } catch (e) {
    console.error("Error uploadPagoDoc:", e);
    return reply.code(500).send({ error: "Error al subir comprobante", detalle: e.message });
  }
};

export const deleteCotizacionAdjunto = async (request, reply) => {
  try {
    const { empresaId } = getScope(request);
    const { adjuntoId } = request.params;

    const adjunto = await prisma.cotizacionAdjunto.findFirst({
      where: { id: adjuntoId },
      include: { cotizacion: true }
    });

    if (!adjunto || adjunto.cotizacion.empresa_id !== empresaId) {
      return reply.code(404).send({ error: "Adjunto no encontrado" });
    }

    await prisma.cotizacionAdjunto.delete({
      where: { id: adjuntoId }
    });

    // Opcionalmente eliminar el archivo físico si se desea
    // try {
    //   const fullPath = path.resolve(process.cwd(), adjunto.url.startsWith("/") ? adjunto.url.slice(1) : adjunto.url);
    //   await fs.unlink(fullPath);
    // } catch (err) { console.error("Error unlinking file:", err); }

    return reply.send({ ok: true });
  } catch (e) {
    console.error("Error deleteCotizacionAdjunto:", e);
    return reply.code(500).send({ error: "Error al eliminar adjunto", detalle: e.message });
  }
};
