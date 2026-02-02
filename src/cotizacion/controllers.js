// src/modules/cotizaciones/controllers.js
import { PrismaClient } from "@prisma/client";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse"); // ✅ (ojo: v2 NO es function; lo manejamos dentro de import)

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

const round0 = (n) => Math.round(Number(n || 0));

function calcTotalVenta(v) {
  return (v?.detalles || []).reduce(
    (s, d) => s + (Number(d.total ?? d.ventaTotal) || 0),
    0,
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
  if (i < 1 || i > 365)
    throw new Error("vigencia_dias debe estar entre 1 y 365");
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

function normalizeText(s) {
  return String(s || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * EJEMPLO de parseo “genérico”
 * Esto lo tendrás que ajustar según tu PDF real.
 * Lo ideal: tener "parsers" por proveedor/plantilla.
 */
function parseCotizacionText(text) {
  const t = normalizeText(text);

  // ejemplos de extracción
  const asunto =
    (t.match(/Asunto\s*:\s*(.+)/i)?.[1] || "").trim() ||
    (t.match(/Cotizaci[oó]n\s*(.+)/i)?.[1] || "").trim() ||
    "Cotización importada";

  const totalStr = (t.match(/Total\s*\$?\s*([\d\.\,]+)/i)?.[1] || "").trim();
  const subtotalStr = (
    t.match(/Sub\s*Total\s*\$?\s*([\d\.\,]+)/i)?.[1] || ""
  ).trim();

  const toNumber = (x) => {
    // soporta "1.234.567" o "1,234,567" o "1234567"
    const v = String(x || "").replace(/[^\d]/g, "");
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const total = toNumber(totalStr);
  const subtotal = toNumber(subtotalStr);

  // si viene solo total, aproximamos subtotal con iva 19% (esto es “fallback”)
  let subtotalFinal = subtotal;
  let ivaFinal = 0;
  let totalFinal = total;

  if (!subtotalFinal && totalFinal) {
    subtotalFinal = Math.round(totalFinal / 1.19);
    ivaFinal = totalFinal - subtotalFinal;
  } else if (subtotalFinal) {
    ivaFinal = Math.round(subtotalFinal * 0.19);
    totalFinal = subtotalFinal + ivaFinal;
  }

  // Ejemplo de items (si en tu pdf hay líneas tipo: "2 x Servicio ... $ 120000")
  // Esto es MUY dependiente del formato.
  const items = [];
  const lines = t
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  for (const ln of lines) {
    const m = ln.match(/^(\d+)\s*x\s*(.+?)\s+\$?\s*([\d\.\,]+)$/i);
    if (m) {
      items.push({
        cantidad: Number(m[1]),
        descripcion: m[2].trim(),
        total: toNumber(m[3]),
      });
    }
  }

  return {
    asunto,
    subtotal: subtotalFinal || 0,
    iva: ivaFinal || 0,
    total: totalFinal || 0,
    items,
    rawText: t,
  };
}

/**
 * POST /cotizaciones/import/pdf
 * Form-data:
 * - file: PDF
 * - cliente_id: string (obligatorio, por ahora)
 * - modo: "preview" | "create" (default preview)
 */
export const importCotizacionFromPdf = async (request, reply) => {
  try {
    const { empresaId, userId } = getScope(request);

    // ✅ leer multipart completo (campos + archivo) de forma robusta
    const fields = {};
    let fileBuffer = null;
    let fileName = null;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        fileName = part.filename;
        const chunks = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    request.log.info(
      {
        empresaId,
        userId,
        fields,
        fileName,
        fileSize: fileBuffer?.length || 0,
        contentType: request.headers["content-type"],
        hasAuth: !!request.headers.authorization,
        xEmpresa: request.headers["x-empresa-id"],
      },
      "IMPORT_PDF_DEBUG",
    );

    const cliente_id = String(fields?.cliente_id || "").trim();
    const modo = String(fields?.modo || "preview")
      .trim()
      .toLowerCase();

    if (!fileBuffer?.length) {
      return reply
        .code(400)
        .send({ error: "Debes enviar un archivo PDF (file)" });
    }

    if (!cliente_id) {
      return reply
        .code(400)
        .send({ error: "cliente_id es obligatorio para importar" });
    }

    // validar cliente en empresa
    const cliente = await prisma.cliente.findFirst({
      where: { id: cliente_id, empresa_id: empresaId, eliminado: false },
      select: { id: true },
    });

    request.log.info(
      { cliente_id, empresaId, found: !!cliente },
      "IMPORT_PDF_CLIENTE_LOOKUP",
    );

    if (!cliente)
      return reply
        .code(400)
        .send({ error: "Cliente inválido", debug: { cliente_id, empresaId } });

    /* ============================================================
       ✅ PDF PARSE (compat: pdf-parse v1 y v2)
    ============================================================ */
    let parsed = null;

    // v1: pdfParse(buffer) => { text, numpages, ... }
    if (typeof pdfParse === "function") {
      parsed = await pdfParse(fileBuffer);
    }
    // v2: require("pdf-parse") => { PDFParse }
    else if (pdfParse?.PDFParse) {
      const Parser = pdfParse.PDFParse;
      const parser = new Parser({ data: fileBuffer });
      const result = await parser.getText();
      await parser.destroy();

      parsed = {
        text: result?.text || "",
        numpages: result?.total || (result?.pages?.length ?? null),
      };
    } else {
      return reply.code(500).send({
        error: "Error al importar PDF",
        detalle:
          "pdf-parse no está disponible correctamente (export inesperado).",
      });
    }

    const text = normalizeText(parsed?.text || "");
    if (!text) {
      return reply.code(422).send({
        error: "No se pudo extraer texto del PDF",
        detalle: "Parece escaneado. Necesitas OCR para este tipo de PDF.",
      });
    }

    /* ============================================================
       ✅ EXTRACCIÓN MEJORADA (Descripción real + fechas)
       - Evita que el asunto quede como S00xxx
       - Saca fecha de cotización / vencimiento
    ============================================================ */
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const matchFirst = (re) => text.match(re)?.[1]?.trim() || "";

    // Número de cotización del PDF (ej: S00195)
    const numeroPdf =
      matchFirst(/N[uú]mero de cotizaci[oó]n\s*(S\d+)/i) ||
      matchFirst(/Cotizaci[oó]n\s*(S\d+)/i) ||
      "";

    // Fechas (dd/mm/yyyy o dd-mm-yyyy)
    const parseDateCL = (s) => {
      const m = String(s || "").match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
      if (!m) return null;
      const dd = m[1],
        mm = m[2],
        yyyy = m[3];
      // Date en UTC 00:00 para no correrse por zona
      return new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
    };

    const fechaCotizacionStr =
      matchFirst(/Fecha de cotizaci[oó]n\s*:?[\s]*([0-9\/\-]{10})/i) ||
      matchFirst(/\bFecha\s*:?[\s]*([0-9\/\-]{10})/i);

    const vencimientoStr =
      matchFirst(/\bVencimiento\s*:?[\s]*([0-9\/\-]{10})/i) || "";

    const fechaCotizacionDate = parseDateCL(fechaCotizacionStr);
    const vencimientoDate = parseDateCL(vencimientoStr);

    const diffDays = (a, b) => {
      if (!a || !b) return null;
      const ms = b.getTime() - a.getTime();
      const d = Math.round(ms / (1000 * 60 * 60 * 24));
      return Number.isFinite(d) ? d : null;
    };

    // Vigencia: si hay fechas, se calcula; si no, 15
    let vigencia_dias = 15;
    const vcalc = diffDays(fechaCotizacionDate, vencimientoDate);
    if (vcalc && vcalc > 0 && vcalc <= 365) vigencia_dias = vcalc;

    // ✅ Descripción real desde la tabla:
    // buscamos el primer texto “bueno” después de "Descripción"
    const idxDesc = lines.findIndex((l) => /^descripci[oó]n$/i.test(l));
    const isProbablyCode = (s) => /^S\d+$/i.test(s); // S00195
    const isMoneyLike = (s) => /[\$]?\s*[\d\.\,]+\s*$/.test(s);
    const isHeaderLike = (s) =>
      /^(cantidad|precio|precio unitario|impuestos|importe|subtotal|iva|total)$/i.test(
        s,
      );

    let descripcionTabla = "";
    if (idxDesc >= 0) {
      for (let i = idxDesc + 1; i < Math.min(idxDesc + 30, lines.length); i++) {
        const l = lines[i];
        if (!l) continue;
        if (isHeaderLike(l)) continue;
        if (/^subtotal$/i.test(l)) break;
        if (/^iva\b/i.test(l)) break;
        if (/^total$/i.test(l)) break;
        if (isProbablyCode(l)) continue; // evita S00xxx
        if (isMoneyLike(l) && l.replace(/[^\d]/g, "").length >= 6) continue; // evita montos sueltos
        // primera frase “real”
        descripcionTabla = l.trim();
        break;
      }
    }

    // fallback por si el PDF no trae la palabra "Descripción" tal cual:
    if (!descripcionTabla) {
      // toma la primera línea “buena” antes de Subtotal
      const stop = lines.findIndex((l) => /^subtotal$/i.test(l));
      const limit = stop > 0 ? stop : Math.min(120, lines.length);
      for (let i = 0; i < limit; i++) {
        const l = lines[i];
        if (!l) continue;
        if (isHeaderLike(l)) continue;
        if (isProbablyCode(l)) continue;
        if (numeroPdf && l === numeroPdf) continue;
        // evita cliente/rut/direcciones muy obvias (heurística)
        if (/^rut\b/i.test(l)) continue;
        if (/^av\./i.test(l)) continue;
        if (/^chile$/i.test(l)) continue;
        if (/^puerto/i.test(l)) continue;

        // una descripción suele tener letras y espacios
        if (/[a-záéíóúñ]/i.test(l) && l.length >= 4) {
          descripcionTabla = l.trim();
          break;
        }
      }
    }

    // Usa tu parse base para montos, pero reemplaza asunto si logramos una descripción real
    const extractedBase = parseCotizacionText(text);

    const extracted = {
      ...extractedBase,
      // ✅ asunto final = descripción real si existe, si no, lo que salga del parser base
      asunto: descripcionTabla || extractedBase.asunto,
      // ✅ dejamos el número del PDF por debug o por si lo quieres guardar después
      numeroPdf: numeroPdf || null,
      fechaCotizacion: fechaCotizacionDate || null,
      vencimiento: vencimientoDate || null,
      vigencia_dias,
    };

    // Si no detectó items, crea 1 item con la descripción real (como tus PDFs de ejemplo)
    if (!Array.isArray(extracted.items) || extracted.items.length === 0) {
      extracted.items = [
        {
          cantidad: 1,
          descripcion: extracted.asunto,
          total: round0(extracted.subtotal || 0),
        },
      ];
    }

    if (modo === "preview") {
      return reply.send({
        mode: "preview",
        extracted: {
          asunto: extracted.asunto,
          subtotal: extracted.subtotal,
          iva: extracted.iva,
          total: extracted.total,
          items: extracted.items,
          fecha_cotizacion: extracted.fechaCotizacion
            ? extracted.fechaCotizacion.toISOString()
            : null,
          vencimiento: extracted.vencimiento
            ? extracted.vencimiento.toISOString()
            : null,
          vigencia_dias: extracted.vigencia_dias,
          numero_pdf: extracted.numeroPdf,
        },
        debug: {
          filename: fileName,
          pages: parsed.numpages,
          textSample: extracted.rawText.slice(0, 1200),
        },
      });
    }

    // create
    const created = await prisma.$transaction(async (tx) => {
      const subtotal = Math.round(Number(extracted.subtotal || 0));
      const iva = Math.round(Number(extracted.iva || 0));
      const total = Math.round(Number(extracted.total || 0));

      if (!subtotal || subtotal <= 0) {
        throw new Error("No se pudo calcular subtotal desde el PDF");
      }

      return tx.cotizacion.create({
        data: {
          empresa_id: empresaId,
          proyecto_id: null,
          cliente_id,
          vendedor_id: userId,

          // ✅ asunto = descripción real
          asunto: extracted.asunto?.slice(0, 250) || "Cotización importada",

          // ✅ vigencia desde PDF si se pudo
          vigencia_dias: normalizeVigenciaDias(extracted.vigencia_dias ?? 15),

          subtotal,
          iva,
          total,
          estado: "COTIZACION",

          // ✅ FECHA: usa la fecha del PDF para que tu cotización muestre la misma
          ...(extracted.fechaCotizacion
            ? { creada_en: extracted.fechaCotizacion }
            : {}),

          glosas: {
            create: [
              {
                descripcion: (extracted.asunto || "Servicios").slice(0, 250),
                monto: subtotal,
                manual: true,
                orden: 0,
              },
            ],
          },
        },
        include: {
          cliente: true,
          vendedor: { select: { id: true, nombre: true, correo: true } },
          glosas: { orderBy: { orden: "asc" } },
        },
      });
    });

    return reply.code(201).send({ mode: "create", cotizacion: created });
  } catch (e) {
    return reply.code(e.statusCode || 400).send({
      error: "Error al importar PDF",
      detalle: e.message,
    });
  }
};

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
        cliente: {
          select: { id: true, nombre: true, rut: true, direccion: true },
        },
        vendedor: { select: { id: true, nombre: true, correo: true } },
        glosas: { orderBy: { orden: "asc" } },
      },
    });

    if (!cot)
      return reply.code(404).send({ error: "Cotización no encontrada" });

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

    if (!cliente_id)
      return reply.code(400).send({ error: "cliente_id es obligatorio" });

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
      const subtotalBase = ventas.reduce(
        (acc, v) => acc + calcTotalVenta(v),
        0,
      );
      if (!subtotalBase || subtotalBase <= 0) {
        throw new Error("El subtotal neto calculado desde ventas es 0");
      }

      const { subtotal, iva, total } = calcFromSubtotal(
        subtotalBase,
        ivaRateNum,
      );

      // normalizar glosas
      let glosasFinal = normalizeGlosas(glosas).sort(
        (a, b) => a.orden - b.orden,
      );

      // si no vienen glosas, crear 1 automática con el subtotal neto
      if (glosasFinal.length === 0) {
        glosasFinal = [
          {
            descripcion: (String(asunto || "").trim() || "Servicios").slice(
              0,
              250,
            ),
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
          `Las glosas deben sumar el subtotal neto. Suma glosas=${suma} vs subtotal=${subtotal}`,
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
      glosas,
      proyecto_id,
    } = request.body || {};

    const existing = await prisma.cotizacion.findFirst({
      where: { id, empresa_id: empresaId, eliminado: false },
      include: { glosas: { orderBy: { orden: "asc" } } },
    });

    if (!existing)
      return reply.code(404).send({ error: "Cotización no encontrada" });

    const updated = await prisma.$transaction(async (tx) => {
      if (cliente_id) {
        const c = await tx.cliente.findFirst({
          where: { id: cliente_id, empresa_id: empresaId, eliminado: false },
          select: { id: true },
        });
        if (!c) throw new Error("Cliente inválido");
      }

      if (proyecto_id) {
        const p = await tx.proyecto.findFirst({
          where: { id: proyecto_id, empresa_id: empresaId, eliminado: false },
          select: { id: true },
        });
        if (!p) throw new Error("Proyecto inválido");
      }

      if (Array.isArray(glosas)) {
        const distrib = normalizeGlosas(glosas).sort(
          (a, b) => a.orden - b.orden,
        );

        const suma = sumGlosas(distrib);
        if (suma !== round0(existing.subtotal)) {
          throw new Error(
            `Las glosas deben sumar el subtotal neto (${round0(existing.subtotal)}). Suma glosas=${suma}.`,
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
          ...(proyecto_id !== undefined
            ? { proyecto_id: proyecto_id || null }
            : {}),
          ...(vigencia_dias !== undefined
            ? { vigencia_dias: normalizeVigenciaDias(vigencia_dias) }
            : {}),
          asunto: asunto !== undefined ? asunto || null : undefined,
          terminos_condiciones:
            terminos_condiciones !== undefined
              ? terminos_condiciones || null
              : undefined,
          acuerdo_pago:
            acuerdo_pago !== undefined ? acuerdo_pago || null : undefined,
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
          cliente_id: true,
          vendedor_id: true,
        },
      });

      if (!cot) {
        const err = new Error("Cotización no encontrada");
        err.statusCode = 404;
        throw err;
      }

      if (!allowed[cot.estado].includes(estado)) {
        const err = new Error(
          `Transición no permitida: ${cot.estado} → ${estado}`,
        );
        err.statusCode = 400;
        throw err;
      }

      let proyectoIdFinal = cot.proyecto_id;

      const isCotToOV = cot.estado === "COTIZACION" && estado === "ORDEN_VENTA";
      if (isCotToOV && !proyectoIdFinal) {
        const asunto = String(cot.asunto || "Sin asunto").trim();
        const nombreProyecto = `${cot.numero} - ${asunto}`.slice(0, 255);

        const proyecto = await tx.proyecto.create({
          data: {
            empresa_id: cot.empresa_id,
            nombre: nombreProyecto,
          },
          select: { id: true },
        });

        proyectoIdFinal = proyecto.id;
      }

      const updated = await tx.cotizacion.update({
        where: { id: cot.id },
        data: {
          estado,
          proyecto_id: proyectoIdFinal ?? null,
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
