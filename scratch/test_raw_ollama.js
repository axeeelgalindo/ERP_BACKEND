import fs from "fs";
import dotenv from "dotenv";

dotenv.config({ path: "/home/deptoinformatica/Escritorio/ERP/backend/.env" });

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:0.5b";

async function main() {
  const { extraerTextoDeDocumento } = await import("../src/modules/documentos/document-parser.service.js");
  const pdfPath = "/home/deptoinformatica/Escritorio/ERP/backend/uploads/1782835771834-598988654-Cot.0026978_L300_UAP_IV_P-20_DIESEL_-_BLUE_INGENIERIA_10JUN26.pdf";
  const buffer = fs.readFileSync(pdfPath);
  const rawText = await extraerTextoDeDocumento(buffer, "cotizacion.pdf", "application/pdf");

  const maxChars = 6000;
  const truncatedText = rawText.length > maxChars 
    ? rawText.substring(0, maxChars) + "\n\n[...Texto truncado...]" 
    : rawText;

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

  console.log("Sending to Ollama...");
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: prompt,
      format: "json",
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 2048,
        num_ctx: 8192,
      }
    })
  });

  const payload = await res.json();
  console.log("=== RAW RESPONSE ===");
  console.log(payload.response);
}

main();
