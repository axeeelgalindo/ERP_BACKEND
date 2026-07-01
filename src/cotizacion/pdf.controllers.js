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

function sumGlosas(glosas) {
  return (glosas || []).reduce((acc, g) => acc + round0(g?.monto || 0), 0);
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
    let s = String(x || "").trim();
    const dots = (s.match(/\./g) || []).length;
    const commas = (s.match(/,/g) || []).length;

    if (dots > 0 && commas > 0) {
      const lastDot = s.lastIndexOf(".");
      const lastComma = s.lastIndexOf(",");
      if (lastComma > lastDot) {
        s = s.replace(/\./g, "").replace(",", ".");
      } else {
        s = s.replace(/,/g, "");
      }
    } else if (commas > 0 && dots === 0) {
      const parts = s.split(",");
      if (parts[parts.length - 1].length === 3 && commas === 1) {
        s = s.replace(/,/g, "");
      } else {
        s = s.replace(/\./g, "").replace(/,/g, ".");
      }
    } else if (dots > 1 && commas === 0) {
      s = s.replace(/\./g, "");
    } else if (dots === 1 && commas === 0) {
      const parts = s.split(".");
      if (parts[1].length === 3) {
        s = s.replace(/\./g, "");
      }
    }

    const v = s.replace(/[^\d\.\-]/g, "");
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const total = toNumber(totalStr);
  const subtotal = toNumber(subtotalStr);

  const linesAll = t.split("\n").map(x => x.trim()).filter(Boolean);

  let vendedorNombre = "";

  let terminos_condiciones = "";
  const idxTotal = linesAll.findIndex(l => /^Total\s*\$?\s*[\d\.\,]+/i.test(l.trim()));
  const idxTerminos = linesAll.findIndex(l => /^(?:condiciones comerciales|t[eé]rminos y condiciones|notas?:?|condiciones de pago|observaciones)/i.test(l));
  const startIdx = idxTotal >= 0 ? idxTotal : idxTerminos;

  if (startIdx >= 0) {
    const terminosLines = [];
    for (let i = startIdx + 1; i < linesAll.length; i++) {
      if (/^(?:subtotal|iva|total)/i.test(linesAll[i])) continue;
      if (/^(?:Tecnolog[íi]a que impulsa|Punta Arenas|Puerto Montt|RUT\s*781159|RUT\s*\d|administracion@blueinge|P[áa]gina)/i.test(linesAll[i])) break;
      terminosLines.push(linesAll[i]);
    }
    terminos_condiciones = terminosLines.join("\n").trim().slice(0, 1000);
  }

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

  const items = [];
  for (const ln of linesAll) {
    const m = ln.match(/^(\d+)\s*x\s*(.+?)\s+\$?\s*([\d\.\,]+)$/i);
    const m2 = ln.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:unidades?|unidad|ud|uds?|kg|l|m|cm|h|hr|horas?)\b\s*([\d\.\,]+)\s*(?:.+?)\s*\$\s*([\d\.\,]+)$/i);
    
    if (m) {
      items.push({
        cantidad: toNumber(m[1]),
        descripcion: m[2].trim(),
        total: toNumber(m[3]),
      });
    } else if (m2) {
      const q = toNumber(m2[2]);
      const p = toNumber(m2[3]);
      const t = toNumber(m2[4]);
      items.push({ cantidad: q, descripcion: m2[1].trim(), precioUnitario: p, total: t });
    }
  }

  return {
    asunto,
    subtotal: subtotalFinal || 0,
    iva: ivaFinal || 0,
    total: totalFinal || 0,
    items,
    vendedorNombre,
    terminos_condiciones,
    rawText: t,
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



/**
 * POST /cotizaciones/import/pdf
  1 PDF 
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

    const modo = String(fields?.modo || "preview")
      .trim()
      .toLowerCase();

    // ✅ NUEVO: fecha manual desde UI (YYYY-MM-DD)
    const fecha_documento_manual = String(
      fields?.fecha_documento_manual || "",
    ).trim();

    // ✅ Fallback manual (si el PDF no logra detectar cliente)
    const cliente_id_fallback = String(fields?.cliente_id || "").trim();

    if (!fileBuffer?.length) {
      return reply
        .code(400)
        .send({ error: "Debes enviar un archivo PDF (file)" });
    }

    /* ============================================================
       ✅ PDF PARSE (compat: pdf-parse v1 y v2)
    ============================================================ */
    let parsed = null;

    if (typeof pdfParse === "function") {
      parsed = await pdfParse(fileBuffer);
    } else if (pdfParse?.PDFParse) {
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
       ✅ Helpers cliente desde PDF
    ============================================================ */
    const normalizeRut = (rutRaw) => {
      const s = String(rutRaw || "")
        .trim()
        .toUpperCase();
      const cleaned = s.replace(/[^0-9K\-]/g, "");
      if (!cleaned.includes("-") && cleaned.length >= 2) {
        return cleaned.slice(0, -1) + "-" + cleaned.slice(-1);
      }
      return cleaned;
    };

    const parseClienteFromText = (fullText) => {
      const lines = fullText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      const rutMatch =
        fullText.match(/\bRUT\s*[:\-]?\s*([0-9\.\-]{7,12}[0-9Kk])\b/) ||
        fullText.match(/\bR\.?U\.?T\.?\s*[:\-]?\s*([0-9\.\-]{7,12}[0-9Kk])\b/);

      const rut = rutMatch ? normalizeRut(rutMatch[1]) : "";

      const idxNumero = lines.findIndex((l) =>
        /n[uú]mero de cotizaci[oó]n/i.test(l),
      );
      const searchLimitFrom = idxNumero > 0 ? Math.max(0, idxNumero - 25) : 0;
      const searchLimitTo =
        idxNumero > 0 ? idxNumero : Math.min(lines.length, 60);

      const isBad = (l) =>
        /^blue\b/i.test(l) ||
        /ingenier/i.test(l) ||
        /tecnolog/i.test(l) ||
        /capit[aá]n juan/i.test(l) ||
        /av\.\s*san agust[íi]n/i.test(l) ||
        /^rut\b/i.test(l) ||
        /^cotizaci[oó]n\b/i.test(l) ||
        /^n[uú]mero\b/i.test(l);

      let nombre = "";

      // 1) First try explicit labels to avoid mistakenly picking the executor
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(?:señor(?:es)?|cliente|empresa|atenci[oó]n a|raz[oó]n social)\s*[:\-]?\s*(.+)/i);
        if (match && match[1].trim().length > 3) {
          const potName = match[1].trim();
          if (!isBad(potName) && !/^atenci[oó]n$/i.test(potName)) {
            nombre = potName;
            break;
          }
        }
      }

      if (rut && !nombre) {
        const idxRutLine = lines.findIndex(
          (l) => /\brut\b/i.test(l) && l.includes(rut.replace(/\./g, "")),
        );
        if (idxRutLine > 0) {
          for (let j = idxRutLine - 1; j >= Math.max(0, idxRutLine - 4); j--) {
            const cand = lines[j];
            if (!cand) continue;
            if (isBad(cand)) continue;
            if (cand.length < 3) continue;
            if (/[a-záéíóúñ]/i.test(cand)) {
              nombre = cand.trim();
              break;
            }
          }
        }
      }

      if (!nombre) {
        // Fallback: pick the first word-like line that is not our company
        for (let i = searchLimitFrom; i < lines.length && i < 20; i++) {
          const cand = lines[i];
          if (!cand) continue;
          if (isBad(cand)) continue;
          if (cand.length < 3) continue;
          if (/\bS\d{3,}\b/.test(cand)) continue; // quote code
          // ignore blueinge headers
          if (/Tecnolog[íi]a que impulsa/i.test(cand)) continue;
          if (/Juan Guillermo/i.test(cand)) continue;
          if (/Punta Arenas|Puerto Montt/i.test(cand) && cand.length < 15) continue;
          if (/Av\. San Agustín/i.test(cand)) continue;
          if (/RUT\s*781159/i.test(cand)) continue;
          if (/blueinge\.com/i.test(cand)) continue;
          if (/Fecha/i.test(cand)) continue;
          if (/vencimiento/i.test(cand)) continue;
          if (/Vendedor/i.test(cand)) continue;
          if (/P[áa]gina/i.test(cand)) continue;
          
          if (/[a-záéíóúñ]/i.test(cand)) {
            nombre = cand.trim();
            break;
          }
        }
      }

      return { nombre: nombre || "", rut: rut || "" };
    };

    const upsertClienteFromPdf = async (tx, empresaId, clientePdf) => {
      const nombre = String(clientePdf?.nombre || "").trim();
      const rut = normalizeRut(clientePdf?.rut || "");

      if (!nombre && !rut) return { cliente: null, created: false };

      if (rut) {
        const foundByRut = await tx.cliente.findFirst({
          where: { empresa_id: empresaId, rut, eliminado: false },
          select: { id: true, nombre: true, rut: true },
        });

        if (foundByRut) return { cliente: foundByRut, created: false };

        const created = await tx.cliente.create({
          data: { empresa_id: empresaId, nombre: nombre || rut, rut },
          select: { id: true, nombre: true, rut: true },
        });

        return { cliente: created, created: true };
      }

      if (nombre) {
        const foundByName = await tx.cliente.findFirst({
          where: {
            empresa_id: empresaId,
            eliminado: false,
            nombre: { equals: nombre, mode: "insensitive" },
          },
          select: { id: true, nombre: true, rut: true },
        });

        if (foundByName) return { cliente: foundByName, created: false };

        const created = await tx.cliente.create({
          data: { empresa_id: empresaId, nombre, rut: null },
          select: { id: true, nombre: true, rut: true },
        });

        return { cliente: created, created: true };
      }

      return { cliente: null, created: false };
    };

    /* ============================================================
       ✅ EXTRACCIÓN (asunto + fechas + montos)
    ============================================================ */
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const matchFirst = (re) => text.match(re)?.[1]?.trim() || "";

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
      // ✅ mediodía UTC evita que al convertir a -03 se vaya al día anterior
      return new Date(
        Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0),
      );
    };

    const parseDateISODateOnly = (s) => {
      const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const yyyy = m[1],
        mm = m[2],
        dd = m[3];
      // ✅ mediodía UTC
      return new Date(
        Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0),
      );
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

    let vigencia_dias = 15;
    const vcalc = diffDays(fechaCotizacionDate, vencimientoDate);
    if (vcalc && vcalc > 0 && vcalc <= 365) vigencia_dias = vcalc;

    /* ============================================================
       ✅✅ FIX REAL: ASUNTO/DESCRIPCIÓN (NO S00xxx)
       - Encuentra "Descripción" aunque venga con más columnas en la misma línea
       - Toma "Arriendo terreno" + línea detalle si existe
    ============================================================ */
    const idxDesc = lines.findIndex((l) =>
      /^descripci[oó]n\b/i.test(String(l || "").trim()),
    );

    const hasLetters = (s) =>
      /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(String(s || "").trim());
    const isProbablyCode = (s) => /^S\d{3,}$/i.test(String(s || "").trim()); // S00195 / S00259
    const isHeaderLike = (s) =>
      /^(descripci[oó]n|cantidad|precio|precio unitario|impuestos|importe|subtotal|iva|total)\b/i.test(
        String(s || "").trim(),
      );
    const looksLikeUnits = (s) =>
      /\b(unidades?|unidad)\b/i.test(String(s || "").trim());
    const looksLikeTax = (s) =>
      /\biva\b/i.test(String(s || "").trim()) ||
      /\b\d+\s*%\b/.test(String(s || "").trim());
    const isMoneyLike = (s) =>
      /[$]?\s*[\d\.\,]+\s*$/.test(String(s || "").trim());
    const isStop = (s) => {
      const t = String(s || "").trim();
      return /^subtotal\b/i.test(t) || /^iva\b/i.test(t) || /^total\b/i.test(t);
    };

    // si viene una línea estilo "Arriendo terreno 1,00 Unidades", extrae lo de la izquierda
    const extractDescFromQtyLine = (line) => {
      const t = String(line || "").trim();
      const m = t.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(unidades?|unidad)\b/i);
      if (!m) return "";
      const left = String(m[1] || "").trim();
      if (!left) return "";
      if (!hasLetters(left)) return "";
      if (isProbablyCode(left)) return "";
      if (numeroPdf && left === numeroPdf) return "";
      if (isHeaderLike(left)) return "";
      return left;
    };

    let descripcionTabla = "";
    let descripcionDetalle = "";

    if (idxDesc >= 0) {
      // bloque de tabla: desde "Descripción..." hacia abajo, hasta Subtotal/IVA/Total
      const block = [];
      for (
        let i = idxDesc + 1;
        i < Math.min(idxDesc + 120, lines.length);
        i++
      ) {
        const l = String(lines[i] || "").trim();
        if (!l) continue;
        if (isStop(l)) break;
        if (isHeaderLike(l)) continue;
        block.push({ l, i });
      }

      // 1) Caso: "DESC 1,00 Unidades" en misma línea
      for (const row of block) {
        const d = extractDescFromQtyLine(row.l);
        if (d) {
          descripcionTabla = d;
          const next = String(lines[row.i + 1] || "").trim();
          if (
            next &&
            hasLetters(next) &&
            !isHeaderLike(next) &&
            !isProbablyCode(next) &&
            !(numeroPdf && next === numeroPdf) &&
            !looksLikeUnits(next) &&
            !looksLikeTax(next) &&
            !(isMoneyLike(next) && next.replace(/[^\d]/g, "").length >= 6)
          ) {
            descripcionDetalle = next;
          }
          break;
        }
      }

      // 2) Fallback: primera línea "real" con letras (saltando S00195, IVA, Unidades, montos)
      if (!descripcionTabla) {
        for (const row of block) {
          const t = row.l;
          if (!hasLetters(t)) continue;
          if (isProbablyCode(t)) continue;
          if (numeroPdf && t === numeroPdf) continue;
          if (isHeaderLike(t)) continue;
          if (looksLikeUnits(t)) continue;
          if (looksLikeTax(t)) continue;
          if (isMoneyLike(t) && t.replace(/[^\d]/g, "").length >= 6) continue;

          descripcionTabla = t;

          const next = String(lines[row.i + 1] || "").trim();
          if (
            next &&
            hasLetters(next) &&
            !isHeaderLike(next) &&
            !isProbablyCode(next) &&
            !(numeroPdf && next === numeroPdf) &&
            !looksLikeUnits(next) &&
            !looksLikeTax(next) &&
            !(isMoneyLike(next) && next.replace(/[^\d]/g, "").length >= 6)
          ) {
            descripcionDetalle = next;
          }
          break;
        }
      }
    }

    if (descripcionTabla && descripcionDetalle) {
      descripcionTabla = `${descripcionTabla} — ${descripcionDetalle}`;
    }

    const extractedBase = parseCotizacionText(text);

    // fecha sugerida desde PDF
    const fecha_documento_sugerida = fechaCotizacionDate || null;

    // fecha final (create): manual > sugerida
    const fecha_documento_manual_date = parseDateISODateOnly(
      fecha_documento_manual,
    );
    const fecha_documento_final = fecha_documento_manual_date
      ? fecha_documento_manual_date
      : fecha_documento_sugerida;

    // ✅ cliente desde PDF
    const clientePdf = parseClienteFromText(text);

    // Construcción extracted
    const extracted = {
      ...extractedBase,
      // ✅ asunto: SI encontramos "Arriendo terreno", NO permitimos que caiga al S00xxx
      asunto: descripcionTabla || extractedBase.asunto,
      numeroPdf: numeroPdf || null,

      cliente_pdf: clientePdf.nombre || clientePdf.rut ? clientePdf : { nombre: "Cliente a Importar", rut: "" },

      fecha_documento_sugerida,
      fecha_documento: fecha_documento_final,
      vencimiento_documento: vencimientoDate || null,

      vigencia_dias,
    };

    if (!Array.isArray(extracted.items) || extracted.items.length === 0) {
      extracted.items = [
        {
          cantidad: 1,
          descripcion: extracted.asunto,
          total: round0(extracted.subtotal || 0),
        },
      ];
    }

    // ✅ PREVIEW: NO exige cliente_id
    if (modo === "preview") {
      const toYMD = (d) => (!d ? "" : d.toISOString().slice(0, 10));

      const resolved = await prisma.$transaction(async (tx) => {
        const { cliente, created } = await upsertClienteFromPdf(
          tx,
          empresaId,
          extracted.cliente_pdf,
        );
        return { cliente, created };
      });

      return reply.send({
        mode: "preview",
        extracted: {
          cliente: resolved.cliente
            ? { ...resolved.cliente, created: resolved.created }
            : null,

          asunto: extracted.asunto,
          subtotal: extracted.subtotal,
          iva: extracted.iva,
          total: extracted.total,
          items: extracted.items,

          fecha_documento_sugerida: toYMD(extracted.fecha_documento_sugerida),
          vencimiento_documento_sugerido: toYMD(
            extracted.vencimiento_documento,
          ),

          vigencia_dias: extracted.vigencia_dias,
          numero_pdf: extracted.numeroPdf,
        },
        debug: {
          filename: fileName,
          pages: parsed.numpages,
          textSample: extracted.rawText?.slice(0, 1200) || "",
        },
      });
    }

    // ✅ CREATE
    const created = await prisma.$transaction(async (tx) => {
      const { cliente: clienteResolved } = await upsertClienteFromPdf(
        tx,
        empresaId,
        extracted.cliente_pdf,
      );

      let cliente_id_final = clienteResolved?.id || "";

      if (!cliente_id_final && cliente_id_fallback) {
        const cli = await tx.cliente.findFirst({
          where: {
            id: cliente_id_fallback,
            empresa_id: empresaId,
            eliminado: false,
          },
          select: { id: true },
        });
        if (!cli) throw new Error("Cliente inválido (fallback)");
        cliente_id_final = cli.id;
      }

      if (!cliente_id_final) {
        throw new Error(
          "No se pudo resolver cliente desde el PDF (y no se envió cliente_id).",
        );
      }

      let vendedorIdFinal = userId;
      
      const usuarios = await tx.usuario.findMany({
        where: { empresa_id: empresaId, eliminado: false },
        select: { id: true, nombre: true }
      });
      
      const normalizeStr = (s) => (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const fullTextNorm = normalizeStr(text); // Scan the entire PDF text seamlessly
      
      let bestMatch = null;
      let bestScore = 0;

      for (const u of usuarios) {
         const uName = normalizeStr(u.nombre);
         const parts = uName.split(",").map(p => p.trim());
         let score = 0;
         
         if (parts[0] && fullTextNorm.includes(parts[0])) score += 2;
         if (parts[1] && fullTextNorm.includes(parts[1])) score += 2;
         
         if (score === 0) {
            const words = uName.split(" ").filter(w => w.length > 3);
            for (const w of words) {
               if (fullTextNorm.includes(w)) score += 1;
            }
         }
         
         if (score > bestScore && score >= 2) {
            bestScore = score;
            bestMatch = u;
         }
      }
      
      if (bestMatch) vendedorIdFinal = bestMatch.id;

      const subtotal = Math.round(Number(extracted.subtotal || 0));
      const iva = Math.round(Number(extracted.iva || 0));
      const total = Math.round(Number(extracted.total || 0));

      if (!subtotal || subtotal <= 0)
        throw new Error("No se pudo calcular subtotal desde el PDF");

      // Obtener el número correlativo para la empresa
      const maxCotizacion = await tx.cotizacion.findFirst({
        where: { empresa_id: empresaId, es_suscripcion: false },
        orderBy: { numero: "desc" },
        select: { numero: true },
      });
      const nextNumero = maxCotizacion ? maxCotizacion.numero + 1 : 1;

      return tx.cotizacion.create({
        data: {
          numero: nextNumero,
          empresa_id: empresaId,
          proyecto_id: null,
          cliente_id: cliente_id_final,
          vendedor_id: vendedorIdFinal,

          asunto: extracted.asunto?.slice(0, 250) || "Cotización importada",
          vigencia_dias: normalizeVigenciaDias(extracted.vigencia_dias ?? 15),

          subtotal,
          iva,
          total,
          estado: "COTIZACION",

          terminos_condiciones: extracted.terminos_condiciones || null,

          fecha_documento: extracted.fecha_documento || null,
          vencimiento_documento: extracted.vencimiento_documento || null,

          glosas: {
            create: extracted.items.map((it, idx) => ({
              descripcion: it.descripcion.slice(0, 250),
              monto: it.total,
              cantidad: it.cantidad || 1,
              precio_unitario: it.precioUnitario || it.total,
              manual: true,
              orden: idx,
            })),
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

// + 1 PDF
export const importCotizacionesFromPdfBatch = async (request, reply) => {
  try {
    const { empresaId, userId } = getScope(request);

    const fields = {};
    const files = []; // [{ filename, buffer }]

    const MAX_FILES = 50; // ajusta a gusto
    const MAX_MB_EACH = 10; // por seguridad

    for await (const part of request.parts()) {
      if (part.type === "file") {
        const filename = part.filename || "archivo.pdf";
        const chunks = [];
        let total = 0;

        for await (const chunk of part.file) {
          total += chunk.length;
          if (total > MAX_MB_EACH * 1024 * 1024) {
            const err = new Error(
              `Archivo ${filename} excede ${MAX_MB_EACH}MB (muy grande)`,
            );
            err.statusCode = 413;
            throw err;
          }
          chunks.push(chunk);
        }

        files.push({ filename, buffer: Buffer.concat(chunks) });

        if (files.length > MAX_FILES) {
          const err = new Error(`Máximo ${MAX_FILES} PDFs por carga`);
          err.statusCode = 413;
          throw err;
        }
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    if (!files.length) {
      return reply.code(400).send({ error: "Debes enviar al menos 1 PDF" });
    }

    const modo = String(fields?.modo || "preview")
      .trim()
      .toLowerCase();
    const fecha_documento_manual = String(
      fields?.fecha_documento_manual || "",
    ).trim();
    const cliente_id_fallback = String(fields?.cliente_id || "").trim();

    // worker interno: procesa 1 PDF usando tu misma lógica
    const processOne = async ({ filename, buffer }) => {
      // ====== acá reutilizamos lo que ya tienes ======
      // 1) parse pdf
      let parsed = null;
      if (typeof pdfParse === "function") {
        parsed = await pdfParse(buffer);
      } else if (pdfParse?.PDFParse) {
        const Parser = pdfParse.PDFParse;
        const parser = new Parser({ data: buffer });
        const result = await parser.getText();
        await parser.destroy();
        parsed = {
          text: result?.text || "",
          numpages: result?.total || (result?.pages?.length ?? null),
        };
      } else {
        const err = new Error("pdf-parse no está disponible correctamente");
        err.statusCode = 500;
        throw err;
      }

      const text = normalizeText(parsed?.text || "");
      if (!text) {
        const err = new Error(
          "No se pudo extraer texto del PDF (posible escaneado, requiere OCR)",
        );
        err.statusCode = 422;
        throw err;
      }

      // 2) tu extracción (usa tus funciones ya definidas arriba)
      //    IMPORTANTE: estas funciones deben estar en el mismo scope del archivo:
      //    parseCotizacionText, normalizeVigenciaDias, round0, etc.
      //    Y también las internas: parseClienteFromText, upsertClienteFromPdf, parseDateISODateOnly, parseDateCL...
      //    (si actualmente están dentro de importCotizacionFromPdf, hay que subirlas a helpers globales)

      // Para no duplicar 200 líneas aquí: lo mínimo es llamar a tu función actual
      // pero tu función actual lee multipart, así que no sirve directo.
      // Entonces: mueve estos helpers (parseClienteFromText/upsertClienteFromPdf/parseDateCL/parseDateISODateOnly)
      // fuera del endpoint original para poder reutilizarlos acá.

      // ==== EJEMPLO usando las mismas helpers que ya tienes (asumiendo que están arriba como helpers globales) ====
      const extractedBase = parseCotizacionText(text);

      // fechas (igual que tu lógica)
      const matchFirst = (re) => text.match(re)?.[1]?.trim() || "";
      const fechaCotizacionStr =
        matchFirst(/Fecha de cotizaci[oó]n\s*:?[\s]*([0-9\/\-]{10})/i) ||
        matchFirst(/\bFecha\s*:?[\s]*([0-9\/\-]{10})/i);

      const vencimientoStr =
        matchFirst(/\bVencimiento\s*:?[\s]*([0-9\/\-]{10})/i) || "";

      const fechaCotizacionDate = parseDateCL(fechaCotizacionStr);
      const vencimientoDate = parseDateCL(vencimientoStr);

      const fecha_documento_manual_date = parseDateISODateOnly(
        fecha_documento_manual,
      );
      const fecha_documento_final =
        fecha_documento_manual_date || fechaCotizacionDate || null;

      const clientePdf = parseClienteFromText(text);

      // fallback simple de vigencia
      let vigencia_dias = 15;
      if (fechaCotizacionDate && vencimientoDate) {
        const ms = vencimientoDate.getTime() - fechaCotizacionDate.getTime();
        const d = Math.round(ms / (1000 * 60 * 60 * 24));
        if (d > 0 && d <= 365) vigencia_dias = d;
      }

      const extracted = {
        ...extractedBase,
        cliente_pdf: clientePdf,
        fecha_documento: fecha_documento_final,
        vencimiento_documento: vencimientoDate || null,
        vigencia_dias,
      };

      if (!Array.isArray(extracted.items) || extracted.items.length === 0) {
        extracted.items = [
          {
            cantidad: 1,
            descripcion: extracted.asunto,
            total: round0(extracted.subtotal || 0),
          },
        ];
      }

      // 3) preview vs create
      if (modo === "preview") {
        const resolved = await prisma.$transaction(async (tx) => {
          const r = await upsertClienteFromPdf(
            tx,
            empresaId,
            extracted.cliente_pdf,
          );
          return r;
        });

        const toYMD = (d) => (!d ? "" : d.toISOString().slice(0, 10));

        return {
          ok: true,
          filename,
          mode: "preview",
          extracted: {
            cliente: resolved?.cliente
              ? { ...resolved.cliente, created: resolved.created }
              : null,
            asunto: extracted.asunto,
            subtotal: extracted.subtotal,
            iva: extracted.iva,
            total: extracted.total,
            items: extracted.items,
            fecha_documento: toYMD(extracted.fecha_documento),
            vencimiento_documento: toYMD(extracted.vencimiento_documento),
            vigencia_dias: extracted.vigencia_dias,
          },
        };
      }

      // CREATE
      const created = await prisma.$transaction(async (tx) => {
        const { cliente: clienteResolved } = await upsertClienteFromPdf(
          tx,
          empresaId,
          extracted.cliente_pdf,
        );

        let cliente_id_final = clienteResolved?.id || "";

        if (!cliente_id_final && cliente_id_fallback) {
          const cli = await tx.cliente.findFirst({
            where: {
              id: cliente_id_fallback,
              empresa_id: empresaId,
              eliminado: false,
            },
            select: { id: true },
          });
          if (!cli) throw new Error("Cliente inválido (fallback)");
          cliente_id_final = cli.id;
        }

        if (!cliente_id_final) {
          throw new Error(
            "No se pudo resolver cliente desde el PDF (y no se envió cliente_id).",
          );
        }

        const subtotal = Math.round(Number(extracted.subtotal || 0));
        const iva = Math.round(Number(extracted.iva || 0));
        const total = Math.round(Number(extracted.total || 0));
        if (!subtotal || subtotal <= 0)
          throw new Error("No se pudo calcular subtotal desde el PDF");

        // Obtener el número correlativo para la empresa
        const maxCotizacion = await tx.cotizacion.findFirst({
          where: { empresa_id: empresaId, es_suscripcion: false },
          orderBy: { numero: "desc" },
          select: { numero: true },
        });
        const nextNumero = maxCotizacion ? maxCotizacion.numero + 1 : 1;

        return tx.cotizacion.create({
          data: {
            numero: nextNumero,
            empresa_id: empresaId,
            proyecto_id: null,
            cliente_id: cliente_id_final,
            vendedor_id: userId,
            asunto: extracted.asunto?.slice(0, 250) || "Cotización importada",
            vigencia_dias: normalizeVigenciaDias(extracted.vigencia_dias ?? 15),
            subtotal,
            iva,
            total,
            estado: "COTIZACION",
            fecha_documento: extracted.fecha_documento || null,
            vencimiento_documento: extracted.vencimiento_documento || null,
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

      return { ok: true, filename, mode: "create", cotizacion: created };
    };

    // Procesar todos (secuencial y seguro)
    const results = [];
    for (const f of files) {
      try {
        results.push(await processOne(f));
      } catch (e) {
        results.push({
          ok: false,
          filename: f.filename,
          error: "IMPORT_FAIL",
          detalle: e.message,
          statusCode: e.statusCode || 400,
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;

    return reply.send({
      mode: modo,
      total: results.length,
      ok: okCount,
      fail: failCount,
      results,
    });
  } catch (e) {
    return reply.code(e.statusCode || 400).send({
      error: "Error al importar PDFs (batch)",
      detalle: e.message,
    });
  }
};