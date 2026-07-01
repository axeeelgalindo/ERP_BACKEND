import fs from "fs";
import { extraerTextoDeDocumento } from "../src/modules/documentos/document-parser.service.js";

async function main() {
  const pdfPath = "/home/deptoinformatica/Escritorio/ERP/backend/uploads/1782835771834-598988654-Cot.0026978_L300_UAP_IV_P-20_DIESEL_-_BLUE_INGENIERIA_10JUN26.pdf";
  const buffer = fs.readFileSync(pdfPath);
  const text = await extraerTextoDeDocumento(buffer, "cotizacion.pdf", "application/pdf");
  fs.writeFileSync("scratch/extracted_6000.txt", text.substring(0, 6000));
  console.log("Wrote first 6000 characters to scratch/extracted_6000.txt");
}

main();
