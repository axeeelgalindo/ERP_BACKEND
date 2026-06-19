import fs from "fs";
import path from "path";
import { extraerTextoDeDocumento } from "../src/modules/documentos/document-parser.service.js";

const pdfPath = "/home/deptoinformatica/Escritorio/ERP/backend/uploads/1781792521721-790571238-cotización_17070_BLUE_ING_PLAZO_DE_ENTREGA_2_A_3_SEMANAS.pdf";

async function main() {
  try {
    const buffer = fs.readFileSync(pdfPath);
    const text = await extraerTextoDeDocumento(buffer, "cotizacion.pdf", "application/pdf");
    console.log("=== EXTRACTED TEXT ===");
    console.log(text);
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
