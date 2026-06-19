import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");
import * as XLSX from "xlsx";

/**
 * Detecta el tipo de documento basándose en la extensión o el tipo MIME y extrae el texto plano.
 * @param {Buffer} buffer Contenido del archivo en memoria.
 * @param {string} filename Nombre del archivo subido.
 * @param {string} mimeType Tipo MIME del archivo.
 * @returns {Promise<string>} Texto extraído y normalizado.
 */
export async function extraerTextoDeDocumento(buffer, filename, mimeType) {
  const extension = filename.split(".").pop().toLowerCase();

  // 1. PDF
  if (extension === "pdf" || mimeType === "application/pdf") {
    return await parsePDF(buffer);
  }

  // 2. Excel (xlsx, xls, ods)
  if (["xlsx", "xls", "ods"].includes(extension) || 
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel") {
    return parseExcel(buffer);
  }

  // 3. CSV
  if (extension === "csv" || mimeType === "text/csv") {
    return parseCSV(buffer);
  }

  // 4. Imagenes (OCR Placeholder)
  if (["png", "jpg", "jpeg", "gif", "tiff", "webp"].includes(extension) || mimeType.startsWith("image/")) {
    return await parseImagenOCR(buffer, filename);
  }

  throw new Error(`Tipo de archivo no soportado: ${extension || mimeType}`);
}

/**
 * Extrae texto de un archivo PDF digital.
 */
async function parsePDF(buffer) {
  try {
    const parser = new PDFParse({ data: buffer });
    const data = await parser.getText();
    if (!data.text || data.text.trim().length === 0) {
      // Si el texto está vacío, probablemente sea un PDF escaneado.
      return await parseScannedPDF(buffer);
    }
    return data.text;
  } catch (error) {
    console.error("Error parseando PDF:", error);
    throw new Error("No se pudo leer el contenido del PDF. Verifique que no esté protegido o dañado.");
  }
}

/**
 * Estructura preparada para el procesamiento de PDFs escaneados mediante OCR.
 */
async function parseScannedPDF(buffer) {
  // ARQUITECTURA OCR PREPARADA:
  // En producción, se integraría una herramienta de OCR como:
  // 1. Tesseract.js (npm install tesseract.js) ejecutándose localmente.
  // 2. Google Cloud Vision API o AWS Textract enviando el buffer por API.
  // Ejemplo de implementación con Tesseract.js:
  //
  // import { createWorker } from 'tesseract.js';
  // const worker = await createWorker('spa');
  // // Convertir páginas del PDF a imágenes usando pdf-img-convert
  // const text = await worker.recognize(imageBuffer);
  // await worker.terminate();
  // return text;

  console.warn("Se detectó un PDF escaneado (sin texto digital).");
  throw new Error(
    "El PDF subido parece ser una imagen escaneada y no contiene texto seleccionable. " +
    "La arquitectura para OCR está preparada en el backend, pero requiere la instalación y configuración " +
    "de un motor de OCR (ej. Tesseract.js o Google Cloud Vision) para procesar imágenes."
  );
}

/**
 * Convierte las hojas de Excel en texto plano formateado.
 */
function parseExcel(buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    let text = "";

    workbook.SheetNames.forEach((sheetName) => {
      text += `--- Hoja de Cálculo: ${sheetName} ---\n`;
      const sheet = workbook.Sheets[sheetName];
      // Convertimos la hoja a formato CSV ya que es muy legible para los LLMs
      const csv = XLSX.utils.sheet_to_csv(sheet);
      text += csv + "\n\n";
    });

    return text.trim();
  } catch (error) {
    console.error("Error parseando Excel:", error);
    throw new Error(`Error leyendo archivo Excel: ${error.message}`);
  }
}

/**
 * Extrae texto de un CSV.
 */
function parseCSV(buffer) {
  try {
    return buffer.toString("utf-8");
  } catch (error) {
    console.error("Error leyendo CSV:", error);
    throw new Error(`Error leyendo archivo CSV: ${error.message}`);
  }
}

/**
 * Estructura preparada para OCR de imágenes.
 */
async function parseImagenOCR(buffer, filename) {
  // ARQUITECTURA OCR PREPARADA PARA IMÁGENES:
  // En producción, aquí se procesaría el buffer usando un cliente de OCR:
  //
  // const vision = require('@google-cloud/vision');
  // const client = new vision.ImageAnnotatorClient();
  // const [result] = await client.textDetection(buffer);
  // return result.fullTextAnnotation.text;

  console.warn(`Se intentó subir una imagen para análisis: ${filename}`);
  throw new Error(
    "Las imágenes requieren procesamiento OCR para extraer su texto. " +
    "La arquitectura de OCR está disponible en el backend pero requiere la configuración de credenciales " +
    "del motor de OCR (ej. Google Cloud Vision o Tesseract.js) en las variables de entorno."
  );
}
