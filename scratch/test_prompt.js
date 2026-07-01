import fs from "fs";
import dotenv from "dotenv";

dotenv.config({ path: "/home/deptoinformatica/Escritorio/ERP/backend/.env" });

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:0.5b";

async function main() {
  const text = fs.readFileSync("scratch/extracted_6000.txt", "utf8");

  // A very simple, direct prompt
  const prompt = `Analiza esta cotización y extrae la información en JSON.
Extrae los siguientes campos:
1. proveedor: nombre (razon social), rut (o CNPJ/tributario)
2. documentoProveedor: numeroCotizacion (o propuesta/folio), fechaCotizacion (formato YYYY-MM-DD), moneda ("CLP", "USD", etc.), condicionPago
3. montos: subtotal, impuestos, descuento, total
4. items: lista de productos/servicios. Cada uno con: descripcion, cantidad, precioUnitario, totalLinea

Texto:
${text}

Responde ÚNICAMENTE con el objeto JSON:`;

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
      }
    })
  });

  const payload = await res.json();
  console.log("Response:", payload.response);
}

main();
