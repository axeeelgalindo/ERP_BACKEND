import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load backend/.env explicitly
dotenv.config({ path: "/home/deptoinformatica/Escritorio/ERP/backend/.env" });

async function main() {
  try {
    const { extraerTextoDeDocumento } = await import("../src/modules/documentos/document-parser.service.js");
    const { analizarCotizacionConOllama } = await import("../src/modules/ia/ollama.service.js");

    const pdfPath = "/home/deptoinformatica/Escritorio/ERP/backend/uploads/1782835771834-598988654-Cot.0026978_L300_UAP_IV_P-20_DIESEL_-_BLUE_INGENIERIA_10JUN26.pdf";
    const buffer = fs.readFileSync(pdfPath);
    const text = await extraerTextoDeDocumento(buffer, "cotizacion.pdf", "application/pdf");
    
    console.log("=== EXTRACTED TEXT ===");
    console.log(text);
    console.log("Using Ollama Model:", process.env.OLLAMA_MODEL || "llama3.2:3b");
    const result = await analizarCotizacionConOllama(text);
    console.log("=== FINAL RESULT ===");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
