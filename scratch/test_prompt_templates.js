import fs from "fs";
import dotenv from "dotenv";

dotenv.config({ path: "/home/deptoinformatica/Escritorio/ERP/backend/.env" });

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:0.5b";

async function main() {
  const text = fs.readFileSync("scratch/extracted_6000.txt", "utf8");

  // Template using empty strings "" instead of null
  const prompt = `Analiza el siguiente texto de una cotización y extrae la información en el formato JSON especificado.

REGLAS:
1. Proveedor: emisor de la cotización.
2. Moneda: "CLP", "USD", "EUR" o la detectada.
3. Montos: subtotal, descuento, impuestos (IVA), total. Escríbelos como strings.
4. Items: lista de productos/servicios. Cada uno con descripcion, cantidad, precioUnitario, totalLinea.

ESTRUCTURA JSON:
{
  "proveedor": {
    "nombre": "",
    "rut": "",
    "direccion": "",
    "telefono": "",
    "email": "",
    "sitioWeb": ""
  },
  "documentoProveedor": {
    "numeroCotizacion": "",
    "referencia": "",
    "fechaCotizacion": "",
    "fechaEntregaEsperada": "",
    "moneda": "",
    "condicionPago": "",
    "condicionEntrega": ""
  },
  "montos": {
    "subtotal": "",
    "descuento": "",
    "impuestos": "",
    "total": ""
  },
  "items": [
    {
      "codigo": "",
      "descripcion": "",
      "cantidad": "",
      "unidad": "",
      "precioUnitario": "",
      "descuento": "",
      "impuesto": "",
      "totalLinea": ""
    }
  ],
  "terminosCondiciones": [],
  "observaciones": ""
}

Texto de la cotización:
${text}
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
  console.log("=== RESPONSE ===");
  console.log(payload.response);
}

main();
