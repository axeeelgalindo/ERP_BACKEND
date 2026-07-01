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

  // Limpiar simbolos de moneda, textos y espacios (dejar solo digitos, comas, puntos y signos)
  let cleanStr = str.replace(/[^\d.,+-]/g, "");
  if (!cleanStr) return null;

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
 * Normaliza una cadena para comparaciones robustas de nombres e identificadores
 * (remueve acentos, convierte a minúsculas y quita caracteres no alfanuméricos).
 * @param {string} str Cadena a normalizar.
 * @returns {string} Cadena normalizada.
 */
function normalizeStringForComparison(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Quitar acentos
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // Quitar todo lo que no sea letras o números
}

/**
 * Intenta adivinar el nombre del proveedor emisor a partir de las primeras líneas del texto plano
 * de la cotización, omitiendo al comprador e información de contacto.
 * @param {string} rawText Texto completo del documento.
 * @returns {string|null} Nombre del proveedor adivinado o null.
 */
function guessSupplierFromText(rawText) {
  if (!rawText) return null;
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i];
    const normalized = normalizeStringForComparison(line);
    
    // Ignorar si es el comprador, correos, sitios web, teléfonos, etc.
    if (normalized.includes("blueingenieria") || 
        normalized.includes("victormorales") || 
        normalized.includes("buyer") || 
        normalized.includes("consignee") || 
        normalized.includes("notify") ||
        normalized.includes("client") || 
        normalized.includes("comprador") ||
        line.includes("@") || 
        line.toLowerCase().includes("tel") || 
        line.toLowerCase().includes("web:") ||
        /^\d+$/.test(normalized)) {
      continue;
    }
    
    if (line.length > 3 && line.length < 100) {
      if (i + 1 < lines.length) {
        const nextLine = lines[i+1].trim();
        const nextNormalized = normalizeStringForComparison(nextLine);
        if (nextNormalized.includes("ltda") || 
            nextNormalized.includes("sa") || 
            nextNormalized.includes("spa") ||
            nextNormalized.includes("srl") ||
            nextNormalized.includes("equipamentos")) {
          return `${line} ${nextLine}`;
        }
      }
      return line;
    }
  }
  return null;
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

  const hasItems = items.length > 0;
  let allItemsZeroPrice = hasItems && items.every(item => {
    if (!item) return true;
    const price = Number(item.precioUnitario || 0);
    return price === 0;
  });

  const tempTotalVal = parseCleanNumber(parsedResponse.montos.total) || 0;

  // HEURÍSTICA: Si hay un único ítem y su precio unitario es 0 o nulo, pero el total general es mayor a 0,
  // asignamos el total general al precio unitario del ítem (dividido por su cantidad si es mayor a 1).
  if (items.length === 1 && allItemsZeroPrice && tempTotalVal > 0) {
    const singleItem = items[0];
    const qty = Number(singleItem.cantidad || 1);
    singleItem.precioUnitario = tempTotalVal / qty;
    singleItem.totalLinea = tempTotalVal;
    calculatedSubtotal = tempTotalVal;
    allItemsZeroPrice = false;
  }

  let useGlobalTotals = allItemsZeroPrice;
  
  if (hasItems && !allItemsZeroPrice && tempTotalVal > 0) {
    const ratio = calculatedSubtotal / tempTotalVal;
    if (ratio < 0.1 || ratio > 10) {
      console.log(`[Ollama Service] Suma de items (${calculatedSubtotal}) es incongruente con el total general (${tempTotalVal}). Asumiendo cotización global y reseteando precios de items a 0.`);
      items.forEach(item => {
        if (item) {
          item.precioUnitario = 0;
          item.totalLinea = 0;
        }
      });
      useGlobalTotals = true;
    }
  }

  if (hasItems && !useGlobalTotals) {
    parsedResponse.montos.subtotal = calculatedSubtotal;
    
    // 2. Extraer o estimar impuestos (IVA 19% en Chile)
    let impuestos = Number(parsedResponse.montos.impuestos || 0);
    const isCLP = parsedResponse.documentoProveedor?.moneda === "CLP";
    
    if (isCLP) {
      const expectedIVA = Math.round(calculatedSubtotal * 0.19);
      if (impuestos === 0 || impuestos === calculatedSubtotal || impuestos > calculatedSubtotal) {
        impuestos = expectedIVA;
      } else {
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
  } else {
    // Es una cotización global o de paquete (sin precios detallados por ítem)
    // Preservar los totales extraídos por Ollama en lugar de sobreescribirlos con 0.
    const subtotalVal = parseCleanNumber(parsedResponse.montos.subtotal) || 0;
    const totalVal = parseCleanNumber(parsedResponse.montos.total) || 0;
    const impuestoVal = parseCleanNumber(parsedResponse.montos.impuestos) || 0;
    const descuentoVal = parseCleanNumber(parsedResponse.montos.descuento) || 0;

    if (totalVal > 0 && subtotalVal === 0) {
      parsedResponse.montos.subtotal = totalVal - impuestoVal + descuentoVal;
      parsedResponse.montos.total = totalVal;
    } else if (subtotalVal > 0 && totalVal === 0) {
      parsedResponse.montos.subtotal = subtotalVal;
      parsedResponse.montos.total = subtotalVal + impuestoVal - descuentoVal;
    } else {
      parsedResponse.montos.subtotal = subtotalVal;
      parsedResponse.montos.total = totalVal;
    }
    parsedResponse.montos.impuestos = impuestoVal;
    parsedResponse.montos.descuento = descuentoVal;
  }
  
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
  const maxChars = 15000;
  const truncatedText = (rawText || "").length > maxChars 
    ? rawText.substring(0, maxChars) + "\n\n[...Texto truncado por longitud excesiva...]" 
    : rawText;

  // Sanitizar texto para evitar comillas dobles internas que rompen el formato JSON
  const sanitizedText = truncatedText.replace(/"/g, "'").replace(/\\/g, "/");

  console.log(`[Ollama Service] Iniciando análisis. Longitud texto original: ${rawText ? rawText.length : 0} caracteres. Texto procesado: ${sanitizedText.length} caracteres.`);

// Variables sugeridas para darle más contexto al modelo y evitar confusiones
const miEmpresa = "BLUE INGENIERIA"; 
const misRepresentantes = "Victor Morales"; 

const prompt = `Actúa como un sistema experto de extracción de datos para integración con un ERP. 
Tu tarea es analizar el texto de una cotización y extraer la información en un JSON estructurado.

REGLAS CRÍTICAS DE EXTRACCIÓN:
1. PROVEEDOR (Emisor): Es la empresa que VENDE. NUNCA extraigas a "${miEmpresa}" o "${misRepresentantes}" como proveedor. Ignora los datos del cliente.
2. MONEDA (Alta Prioridad): Analiza todo el texto (ej. "USD", "US$", "EXW TOTAL", "€", "CLP"). Si ves "USD" o "US$", la moneda es "USD".
3. LÓGICA DE ÍTEMS Y DESPIECES TÉCNICOS:
   - ATENCIÓN: Muchas cotizaciones incluyen listas inmensas de accesorios, repuestos o componentes que NO tienen precio (ej. cantidades de mangueras, tornillos, válvulas). IGNORA todas las tablas de accesorios técnicos que no tengan un precio asignado.
   - Busca la sección de "PRESUPUESTO" o "RESUMEN" al final del documento.
   - Si se cobra un equipo principal (ej. "Equipo de ultra alta presión") por un valor total, extrae ESE ítem como el producto principal con cantidad 1, y asigna el total global como su precio unitario.
4. FORMATO DE NÚMEROS: Extrae montos como strings sin símbolos (ej: "192.000,00").
5. FORMATO ESTRICTO: Solo devuelve JSON válido. 

ESTRUCTURA JSON REQUERIDA:
{
  "razonamiento": {
    "proveedor": "Explica a quién identificaste.",
    "moneda": "Símbolos encontrados.",
    "items": "Explica por qué ignoraste el despiece técnico y qué ítem principal elegiste."
  },
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
    "fechaVencimiento": null,
    "moneda": null,
    "condicionPago": null,
    "tiempoEntrega": null
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
  "observaciones": null
}

TEXTO DE LA COTIZACIÓN:
---
${sanitizedText}
---`;

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
          temperature: 0.0, // Báscalo a 0.0 para que sea estrictamente analítico
          num_predict: 3000, // Aumenta el límite de salida por si hay muchos ítems
          num_ctx: 8192, // VITAL: Aumenta la ventana de contexto para que lea los 15000 caracteres
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
      // Sobreescribir moneda si detectamos USD/EUR via regex y Ollama devolvió CLP por error
      if (parsedResponse.documentoProveedor) {
        const textUpper = (rawText || "").toUpperCase();
        let detectedCurrency = null;
        if (textUpper.includes("USD") || textUpper.includes("US$") || textUpper.includes("USDTOTAL")) {
          detectedCurrency = "USD";
        } else if (textUpper.includes("EUR") || textUpper.includes("€")) {
          detectedCurrency = "EUR";
        }
        
        if (detectedCurrency && parsedResponse.documentoProveedor.moneda !== detectedCurrency) {
          console.log(`[Ollama Service] Corrigiendo moneda de ${parsedResponse.documentoProveedor.moneda} a ${detectedCurrency} basado en detección de texto.`);
          parsedResponse.documentoProveedor.moneda = detectedCurrency;
        }
      }

      // Corregir proveedor si Ollama extrajo al cliente por error
      if (parsedResponse.proveedor && parsedResponse.proveedor.nombre) {
        const provName = String(parsedResponse.proveedor.nombre).toUpperCase();
        const normName = normalizeStringForComparison(parsedResponse.proveedor.nombre);
        if (normName.includes("blueingenieria") || normName.includes("victormorales")) {
          console.log(`[Ollama Service] Corrigiendo proveedor erróneo (cliente extraído como proveedor): ${parsedResponse.proveedor.nombre}`);
          const textUpper = (rawText || "").toUpperCase();
          if (textUpper.includes("COMET DO BRASIL")) {
            parsedResponse.proveedor.nombre = "COMET DO BRASIL INDÚSTRIA E COMÉRCIO DE EQUIPAMENTOS LTDA";
            parsedResponse.proveedor.rut = "21.571.621/0001-03";
          } else if (textUpper.includes("LEMASA")) {
            parsedResponse.proveedor.nombre = "LEMASA";
          } else {
            const guessed = guessSupplierFromText(rawText);
            if (guessed) {
              console.log(`[Ollama Service] Proveedor guessed de las primeras líneas del texto: ${guessed}`);
              parsedResponse.proveedor.nombre = guessed;
            } else {
              parsedResponse.proveedor.nombre = null;
            }
          }
        }
      }

      if (parsedResponse.montos) {
        parsedResponse.montos.subtotal = parseCleanNumber(parsedResponse.montos.subtotal);
        parsedResponse.montos.descuento = parseCleanNumber(parsedResponse.montos.descuento);
        parsedResponse.montos.impuestos = parseCleanNumber(parsedResponse.montos.impuestos);
        parsedResponse.montos.total = parseCleanNumber(parsedResponse.montos.total);

        // Corregir o rellenar totales usando extractor de respaldo si Ollama extrajo montos erróneos o nulos
        const progTotals = extractTotalsFromText(rawText);
        if (progTotals.foundTotal && (!parsedResponse.montos.total || parsedResponse.montos.total === 0 || Math.abs(parsedResponse.montos.total - progTotals.foundTotal) > 0.01)) {
          console.log(`[Ollama Service] Corrigiendo total general de ${parsedResponse.montos.total} a ${progTotals.foundTotal} usando extractor de respaldo.`);
          parsedResponse.montos.total = progTotals.foundTotal;
          if (progTotals.foundSubtotal) {
            parsedResponse.montos.subtotal = progTotals.foundSubtotal;
          } else {
            parsedResponse.montos.subtotal = progTotals.foundTotal - (progTotals.foundImpuestos || 0);
          }
          parsedResponse.montos.impuestos = progTotals.foundImpuestos || 0;
        }
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

/**
 * Extractor determinístico de respaldo para montos totales, subtotales e impuestos.
 * @param {string} rawText Texto plano extraído del documento.
 * @returns {object} Montos detectados.
 */
function extractTotalsFromText(rawText) {
  if (!rawText) return { foundTotal: null, foundSubtotal: null, foundImpuestos: null };

  const lines = rawText.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const prevLine = lines[i-1].trim();
    const currLine = lines[i].trim();
    if (/^(?:USDTOTAL|TOTAL|EXW TOTAL)$/i.test(currLine) && /^[$\s€]*[\d\.,]+$/.test(prevLine)) {
      lines[i-1] = prevLine + " " + currLine;
      lines[i] = "";
    }
  }
  const cleanText = lines.filter(l => l.trim() !== "").join("\n");

  let foundTotal = null;
  let foundSubtotal = null;
  let foundImpuestos = null;

  // Regex para TOTAL (horizontal-only spacing)
  const totalMatch = cleanText.match(/(?:(?:TOTAL GENERAL|USDTOTAL|EXW TOTAL|TOTAL)[ \t]*:?[ \t]*[ \t$€]*([\d\.,]+)|([\d\.,]+)[ \t]*[ \t$€]*(?:USDTOTAL|TOTAL|EXW TOTAL))/i);
  if (totalMatch) {
    const valStr = totalMatch[1] || totalMatch[2];
    foundTotal = parseCleanNumber(valStr);
  }

  // Neto / Subtotal (horizontal-only spacing)
  const subtotalMatch = cleanText.match(/(?:SUBTOTAL|NETO|VALOR NETO)[ \t]*:?[ \t]*[ \t$€]*([\d\.,]+)/i);
  if (subtotalMatch) {
    foundSubtotal = parseCleanNumber(subtotalMatch[1]);
  }

  // IVA / Impuestos (horizontal-only spacing)
  const impuestoMatch = cleanText.match(/(?:IVA|IMPUESTOS?|IMPTO)[ \t]*:?[ \t]*[ \t$€]*([\d\.,]+)/i);
  if (impuestoMatch) {
    foundImpuestos = parseCleanNumber(impuestoMatch[1]);
  }

  return { foundTotal, foundSubtotal, foundImpuestos };
}
