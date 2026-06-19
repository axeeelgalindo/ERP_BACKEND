import dotenv from "dotenv";

dotenv.config();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

/**
 * Repara una cadena JSON truncada cerrando comillas y llaves abiertas.
 * @param {string} str Cadena JSON potencialmente truncada.
 * @returns {string} Cadena JSON reparada y válida.
 */
function repairTruncatedJson(str) {
  str = (str || "").trim();
  if (!str) return "{}";

  let inString = false;
  let escapeNext = false;
  let stack = [];

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        stack.push('}');
      } else if (char === '[') {
        stack.push(']');
      } else if (char === '}') {
        if (stack.length > 0 && stack[stack.length - 1] === '}') {
          stack.pop();
        }
      } else if (char === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === ']') {
          stack.pop();
        }
      }
    }
  }

  if (stack.length === 0 && !inString) {
    return str;
  }

  let repaired = str;
  if (inString) {
    repaired += '"';
  }

  while (repaired.length > 0) {
    const lastChar = repaired[repaired.length - 1];

    if (/\s/.test(lastChar)) {
      repaired = repaired.slice(0, -1);
      continue;
    }

    if (lastChar === ',' || lastChar === ':') {
      repaired = repaired.slice(0, -1);
      continue;
    }

    const match = repaired.match(/(\"[^\"\\,:\{\}\[\]]*|null|false|true|\d+(\.\d+)?)$/);
    if (match) {
      const matchStr = match[0];
      if (matchStr.startsWith('"') && !matchStr.endsWith('"')) {
        repaired = repaired.slice(0, -matchStr.length);
        continue;
      }
    }

    if (lastChar === '"') {
      const lastQuoteIndex = repaired.lastIndexOf('"', repaired.length - 2);
      if (lastQuoteIndex !== -1) {
        const beforeKey = repaired.slice(0, lastQuoteIndex).trim();
        const beforeLastChar = beforeKey[beforeKey.length - 1];
        if (beforeLastChar === ',' || beforeLastChar === '{' || beforeLastChar === '[') {
          repaired = repaired.slice(0, lastQuoteIndex);
          continue;
        }
      }
    }

    break;
  }

  inString = false;
  escapeNext = false;
  stack = [];
  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') {
        stack.push('}');
      } else if (char === '[') {
        stack.push(']');
      } else if (char === '}') {
        if (stack.length > 0 && stack[stack.length - 1] === '}') {
          stack.pop();
        }
      } else if (char === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === ']') {
          stack.pop();
        }
      }
    }
  }

  while (stack.length > 0) {
    repaired += stack.pop();
  }

  return repaired;
}

/**
 * Limpia y convierte un valor (string o numero) a un Number valido.
 * Soporta formatos locales chilenos/europeos (miles con punto, decimal con coma)
 * y formatos US (miles con coma, decimal con punto).
 * @param {any} val Valor a limpiar y convertir.
 * @returns {number|null} Numero limpio o null.
 */
function parseCleanNumber(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return isNaN(val) ? null : val;
  
  const str = String(val).trim();
  if (!str) return null;

  // Limpiar simbolos de moneda y espacios en blanco
  let cleanStr = str.replace(/[\$\s€]/g, "");

  // Si tiene puntos y comas (ej: "1.234.567,89" o "1,234,567.89")
  if (cleanStr.includes(".") && cleanStr.includes(",")) {
    // Caso: Punto como miles, coma como decimal (ej: "1.234,56")
    if (cleanStr.lastIndexOf(",") > cleanStr.lastIndexOf(".")) {
      cleanStr = cleanStr.replace(/\./g, "").replace(",", ".");
    } else {
      // Caso: Coma como miles, punto como decimal (ej: "1,234.56")
      cleanStr = cleanStr.replace(/,/g, "");
    }
  } else if (cleanStr.includes(".")) {
    // Si solo contiene puntos
    const parts = cleanStr.split(".");
    if (parts.length > 2) {
      // Mas de un punto (ej: "1.234.567") -> miles
      cleanStr = cleanStr.replace(/\./g, "");
    } else {
      // Un solo punto (ej: "123.45" o "1.234")
      // Heuristica: si la parte decimal tiene exactamente 3 digitos y la cadena es larga,
      // suele ser separador de miles en CLP (ej: "1.500" -> 1500).
      if (parts[1].length === 3 && cleanStr.length >= 5) {
        cleanStr = cleanStr.replace(/\./g, "");
      }
      // De lo contrario, se queda con el punto para decimales (ej: "123.45")
    }
  } else if (cleanStr.includes(",")) {
    // Si solo contiene comas
    const parts = cleanStr.split(",");
    if (parts.length > 2) {
      // Mas de una coma -> miles
      cleanStr = cleanStr.replace(/,/g, "");
    } else {
      // Una sola coma (ej: "123,45" o "1,234")
      if (parts[1].length === 3 && cleanStr.length >= 5) {
        cleanStr = cleanStr.replace(/,/g, "");
      } else {
        cleanStr = cleanStr.replace(",", ".");
      }
    }
  }

  const num = Number(cleanStr);
  return isNaN(num) ? null : num;
}

/**
 * Extrae ítems de cotización de forma programática usando expresiones regulares
 * para complementar la extracción de Ollama.
 * @param {string} text Texto de la cotización.
 * @returns {Array} Array de ítems detectados.
 */
function extractItemsFromText(text) {
  const lines = (text || "").split("\n");
  const items = [];
  // Expresión regular flexible para detectar el patrón de líneas de tabla en cotizaciones chilenas:
  // [INDICE] [CANTIDAD] [PRECIO UNITARIO] [TOTAL LINEA] [DESCUENTO]
  const lineRegex = /(?:^|[\s\t]+)(\d{1,3})\s+([\d,.]+)\s+(?:[a-zA-Z\.]+\s+)?\$?\s*([\d,.]+)\s+\$?\s*([\d,.]+)\s+([\d,.]+)(?:[\s\t]+|$)/;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(lineRegex);
    if (match) {
      const index = match[1];
      const quantityStr = match[2];
      const priceStr = match[3];
      const totalStr = match[4];
      const discountStr = match[5];
      
      const matchIndex = line.indexOf(match[0]);
      const beforeText = line.substring(0, matchIndex).trim();
      
      // Retroceder para buscar las líneas de descripción correspondientes
      const descLines = [];
      let j = i - 1;
      while (j >= 0) {
        const prevLine = lines[j].trim();
        // Detenerse si encontramos otro ítem, cabecera de tabla, o palabras clave
        if (!prevLine || prevLine.match(lineRegex) || prevLine.toLowerCase().includes("descripción") || prevLine.toLowerCase().includes("cotización") || prevLine.toLowerCase().includes("total") || prevLine.toLowerCase().includes("neto") || prevLine.toLowerCase().includes("iva")) {
          break;
        }
        descLines.unshift(prevLine);
        j--;
      }
      
      const fullDesc = descLines.join(" ");
      const combinedDesc = [fullDesc, beforeText].filter(Boolean).join(" ");
      const codeMatch = combinedDesc.match(/\b([A-Z0-9]{5,}-[A-Z0-9-]{4,})\b/);
      let codigo = codeMatch ? codeMatch[1] : null;
      let descripcion = combinedDesc;
      
      if (codigo) {
        descripcion = combinedDesc.replace(codigo, "").trim();
      } else {
        codigo = index;
      }
      
      items.push({
        codigo: codigo,
        descripcion: descripcion || `Ítem ${index}`,
        cantidad: parseCleanNumber(quantityStr),
        unidad: "unidad",
        precioUnitario: parseCleanNumber(priceStr),
        descuento: parseCleanNumber(discountStr),
        totalLinea: parseCleanNumber(totalStr),
        impuesto: 0
      });
    }
  }
  
  return items;
}

/**
 * Corrige números con puntos de miles que fueron interpretados erróneamente como decimales por el parser JSON en CLP.
 * @param {object} parsedResponse Respuesta estructurada de Ollama.
 */
function formatCLPAmounts(parsedResponse) {
  const isCLP = parsedResponse.documentoProveedor?.moneda === "CLP";
  if (!isCLP) return;

  const fixValue = (v) => {
    if (typeof v !== "number" || isNaN(v)) return v;
    // Si tiene parte decimal en CLP, usualmente es por truncamiento de miles (ej: 837.2 -> 837200)
    if (v % 1 !== 0) {
      return Math.round(v * 1000);
    }
    return v;
  };

  if (parsedResponse.montos) {
    parsedResponse.montos.subtotal = fixValue(parsedResponse.montos.subtotal);
    parsedResponse.montos.descuento = fixValue(parsedResponse.montos.descuento);
    parsedResponse.montos.impuestos = fixValue(parsedResponse.montos.impuestos);
    parsedResponse.montos.total = fixValue(parsedResponse.montos.total);
  }

  if (Array.isArray(parsedResponse.items)) {
    parsedResponse.items.forEach(item => {
      if (item) {
        item.precioUnitario = fixValue(item.precioUnitario);
        item.descuento = fixValue(item.descuento);
        item.impuesto = fixValue(item.impuesto);
        item.totalLinea = fixValue(item.totalLinea);
      }
    });
  }
}

/**
 * Recalcula y valida matemáticamente los montos y totales del documento.
 * @param {object} parsedResponse Respuesta estructurada de Ollama.
 */
function recalculateAndValidateTotals(parsedResponse) {
  if (!parsedResponse) return;
  
  if (!parsedResponse.montos) {
    parsedResponse.montos = { subtotal: 0, descuento: 0, impuestos: 0, total: 0 };
  }
  
  const items = parsedResponse.items || [];
  
  // 1. Calcular subtotal como la suma de los totales de cada línea
  let calculatedSubtotal = 0;
  items.forEach(item => {
    if (item) {
      const qty = Number(item.cantidad || 1);
      const price = Number(item.precioUnitario || 0);
      const desc = Number(item.descuento || 0);
      item.totalLinea = (qty * price) - desc;
      calculatedSubtotal += item.totalLinea;
    }
  });
  
  parsedResponse.montos.subtotal = calculatedSubtotal;
  
  // 2. Extraer o estimar impuestos (IVA 19% en Chile)
  let impuestos = Number(parsedResponse.montos.impuestos || 0);
  const isCLP = parsedResponse.documentoProveedor?.moneda === "CLP";
  
  if (isCLP) {
    const expectedIVA = Math.round(calculatedSubtotal * 0.19);
    // Si impuestos es 0, o es igual al subtotal/total debido a un error del LLM, usamos el IVA esperado
    if (impuestos === 0 || impuestos === calculatedSubtotal || impuestos > calculatedSubtotal) {
      impuestos = expectedIVA;
    } else {
      // Si difiere por más del 5% del IVA esperado, forzar el IVA esperado
      const diffPercent = Math.abs(impuestos - expectedIVA) / expectedIVA;
      if (diffPercent > 0.05) {
        impuestos = expectedIVA;
      }
    }
  }
  
  parsedResponse.montos.impuestos = impuestos;
  
  const descuento = Number(parsedResponse.montos.descuento || 0);
  parsedResponse.montos.descuento = descuento;
  
  // 3. El total general es subtotal + impuestos - descuento
  parsedResponse.montos.total = calculatedSubtotal + impuestos - descuento;
  
  // 4. Limpiar advertencias matemáticas si ya corregimos la consistencia
  if (parsedResponse.confianza && Array.isArray(parsedResponse.confianza.advertencias)) {
    parsedResponse.confianza.advertencias = parsedResponse.confianza.advertencias.filter(
      adv => !adv.includes("no coincide con el total extraido")
    );
  }
}

/**
 * Envia texto extraido de una cotizacion a Ollama para su analisis y estructuracion.
 * @param {string} rawText Texto plano extraido del documento.
 * @returns {Promise<object>} Objeto JSON estructurado.
 */
export async function analizarCotizacionConOllama(rawText) {
  // Truncar el texto a un máximo de 6000 caracteres (~1500 tokens) para reducir sustancialmente el tiempo de prompt evaluation en CPU
  const maxChars = 6000;
  const truncatedText = (rawText || "").length > maxChars 
    ? rawText.substring(0, maxChars) + "\n\n[...Texto truncado por longitud excesiva...]" 
    : rawText;

  console.log(`[Ollama Service] Iniciando análisis. Longitud texto original: ${rawText ? rawText.length : 0} caracteres. Texto procesado: ${truncatedText.length} caracteres.`);

  const prompt = `Analiza el siguiente texto extraído de una cotización de proveedor y extrae la información en un formato JSON estructurado.

REGLAS CRÍTICAS DE EXTRACCIÓN:
1. PROVEEDOR (quien vende): Identifica dinámicamente al emisor real de la cotización que figura en el documento (nombre, RUT, dirección, etc.). El cliente (quien compra) suele ser la empresa receptora (como BLUE INGENIERÍA SPA o la empresa del usuario).
2. MONEDA: Debe ser "CLP" si hay símbolos "$" o montos en pesos. NUNCA extraigas "USD" o "Dólar" a menos que diga explícitamente "USD" o "Dólar".
3. MONTOS DEL RESUMEN:
   En la sección final de totales del texto:
   - "Neto" (ej: Neto $ 837.200,00) es el "subtotal" del JSON (debe ser "837.200,00").
   - "IVA" (ej: $ 159.068,00) es el "impuestos" del JSON (debe ser "159.068,00").
   - "Total" (ej: $ 996.268,00) es el "total" del JSON (debe ser "996.268,00").
   - "descuento" es siempre "0" o null, a menos que se indique explícitamente "Descuento". NUNCA pongas el IVA en la sección de descuento.
4. Escribe todos los números (precios, subtotales, totales, cantidades) como strings (ejemplo: "837.200,00", "159.068,00", "996.268,00", "1,0", "284.050,00"). NUNCA envíes números puros sin comillas en el JSON.
5. ITEMS DE LA TABLA: Cada producto tiene una descripción y luego una línea de valores: "[INDICE] [CANTIDAD] [PRECIO UNITARIO] [TOTAL LINEA] [DESCUENTO]" (ej: "001 1,0 $ 284.050,00 $ 284.050,00 0,00"). Extrae cada item con su cantidad, precio unitario y totalLinea individuales. No dupliques el total general en los items.

ESTRUCTURA DEL JSON ESPERADO:
{
  "proveedor": {
    "nombre": null,
    "rut": null,
    "direccion": null,
    "telefono": null,
    "email": null,
    "sitioWeb": null
  },
  "documentoProveedor": {
    "numeroCotizacion": null,
    "referencia": null,
    "fechaCotizacion": null,
    "fechaEntregaEsperada": null,
    "moneda": null,
    "condicionPago": null,
    "condicionEntrega": null
  },
  "montos": {
    "subtotal": null,
    "descuento": null,
    "impuestos": null,
    "total": null
  },
  "items": [
    {
      "codigo": null,
      "descripcion": null,
      "cantidad": null,
      "unidad": null,
      "precioUnitario": null,
      "descuento": null,
      "impuesto": null,
      "totalLinea": null
    }
  ],
  "terminosCondiciones": [],
  "observaciones": null,
  "confianza": {
    "general": 0.0,
    "camposDetectados": [],
    "camposFaltantes": [],
    "advertencias": []
  }
}

TEXTO EXTRAÍDO DEL DOCUMENTO:
---
${truncatedText}
---
`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 180 segundos (3 minutos) de tiempo de espera máximo

  console.log(`[Ollama Service] Enviando solicitud a Ollama (${OLLAMA_MODEL}) en ${OLLAMA_URL}...`);
  const startTime = Date.now();

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        format: "json",
        stream: false,
        options: {
          temperature: 0.1, // temperatura baja para reducir alucinaciones
          num_predict: 2048, // limitar longitud de generación para evitar bucles infinitos
          num_ctx: 8192, // asegurar suficiente ventana de contexto
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Ollama Service] Respuesta recibida de Ollama en ${duration} segundos. Estatus HTTP: ${res.status}`);

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Ollama respondio con codigo ${res.status}: ${errorText}`);
    }

    const payload = await res.json();
    if (!payload || !payload.response) {
      throw new Error("Respuesta invalida desde la API de Ollama.");
    }

    let parsedResponse;
    const rawResponse = payload.response;
    try {
      parsedResponse = JSON.parse(rawResponse);
    } catch (e) {
      console.warn("[Ollama Service] Error al parsear JSON original, intentando reparar JSON truncado...", e.message);
      try {
        const repairedJson = repairTruncatedJson(rawResponse);
        parsedResponse = JSON.parse(repairedJson);
        console.log("[Ollama Service] JSON reparado exitosamente.");
      } catch (repairError) {
        console.error("Error parseando respuesta de Ollama original:", rawResponse);
        console.error("Error parseando respuesta reparada:", repairError.message);
        throw new Error("Ollama no retorno un JSON valido.");
      }
    }

    // Normalizar montos e items numéricos desde los strings devueltos
    if (parsedResponse) {
      if (parsedResponse.montos) {
        parsedResponse.montos.subtotal = parseCleanNumber(parsedResponse.montos.subtotal);
        parsedResponse.montos.descuento = parseCleanNumber(parsedResponse.montos.descuento);
        parsedResponse.montos.impuestos = parseCleanNumber(parsedResponse.montos.impuestos);
        parsedResponse.montos.total = parseCleanNumber(parsedResponse.montos.total);
      }

      if (Array.isArray(parsedResponse.items)) {
        parsedResponse.items = parsedResponse.items
          .filter(item => {
            if (!item) return false;
            const keys = Object.keys(item);
            if (keys.length === 0) return false;
            return keys.some(k => item[k] !== null && item[k] !== undefined && String(item[k]).trim() !== "");
          })
          .map((item) => {
            if (item) {
              item.cantidad = parseCleanNumber(item.cantidad);
              item.precioUnitario = parseCleanNumber(item.precioUnitario);
              item.descuento = parseCleanNumber(item.descuento);
              item.impuesto = parseCleanNumber(item.impuesto);
              item.totalLinea = parseCleanNumber(item.totalLinea);
            }
            return item;
          });
      }

      // Aplicar extractor programático híbrido si detectamos patrones de tabla
      const progItems = extractItemsFromText(rawText);
      if (progItems && progItems.length > 0) {
        console.log(`[Ollama Service] Aplicando extractor programático híbrido: ${progItems.length} ítems detectados.`);
        parsedResponse.items = progItems;
      }

      // Corregir comas de miles interpretadas como decimales en CLP
      formatCLPAmounts(parsedResponse);

      // Recalcular y corregir la coherencia matemática de subtotales, IVA y total general
      recalculateAndValidateTotals(parsedResponse);

      // Validacion de consistencia basica y recalculo de advertencias
      if (!parsedResponse.confianza) {
        parsedResponse.confianza = { general: 0.5, camposDetectados: [], camposFaltantes: [], advertencias: [] };
      }
      if (!Array.isArray(parsedResponse.confianza.advertencias)) {
        parsedResponse.confianza.advertencias = [];
      }

      const subtotal = Number(parsedResponse.montos?.subtotal || 0);
      const impuestos = Number(parsedResponse.montos?.impuestos || 0);
      const descuento = Number(parsedResponse.montos?.descuento || 0);
      const total = Number(parsedResponse.montos?.total || 0);

      const mathTotal = subtotal + impuestos - descuento;
      if (total > 0 && Math.abs(mathTotal - total) > 2) {
        parsedResponse.confianza.advertencias.push(
          `La suma de subtotal (${subtotal}) + impuestos (${impuestos}) - descuento (${descuento}) = ${mathTotal} no coincide con el total extraido (${total}).`
        );
      }
    }

    return parsedResponse;
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[Ollama Service] Falla en la solicitud a Ollama después de ${duration} segundos:`, error);
    
    if (error.cause) {
      console.error("[Ollama Service] Causa original:", error.cause);
    }
    
    // Detallar el error para facilitar el diagnóstico
    let detailMsg = error.message;
    if (error.name === "AbortError") {
      detailMsg = `La solicitud a Ollama excedió el tiempo límite de 180 segundos.`;
    } else if (error.cause) {
      detailMsg += ` (${error.cause.message || error.cause})`;
    }
    
    throw new Error(`Error en servicio Ollama: ${detailMsg}`);
  }
}
