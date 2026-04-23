import {
  listCotizaciones,
  getCotizacion,
  createCotizacion,
  updateCotizacion,
  updateCotizacionEstado,
  deleteCotizacion,
  importVentasCSV,
  uploadCotizacionDoc,
  deleteCotizacionAdjunto,
  addPago,
  deletePago,
  uploadPagoDoc,
} from "./controllers.js";

import {
  importCotizacionFromPdf,
  importCotizacionesFromPdfBatch,
} from "./pdf.controllers.js";

export default async function cotizacionesRoutes(server) {
  // ✅ Protege todas las rutas del módulo
  server.addHook("preHandler", async (request, reply) => {
    // Si tienes fastify-jwt registrado, esto existe:
    await request.jwtVerify();

    // ✅ opcional pero recomendado: normaliza scope para tu getScope()
    const u = request.user || {};
    request.scope = {
      userId: u.userId ?? u.sub ?? u.id ?? null,
      empresaId: u.empresaId ?? u.empresa?.id ?? null,
      rolCodigo: (u.rol?.codigo ?? u.rolCodigo ?? "").toString().toUpperCase(),
    };
  });

  server.get("/cotizaciones", listCotizaciones);
  server.get("/cotizaciones/:id", getCotizacion);
  server.post("/cotizaciones/add", createCotizacion);
  server.put("/cotizaciones/update/:id", updateCotizacion);
  server.post("/cotizaciones/:id/estado", updateCotizacionEstado);
  server.delete("/cotizaciones/:id", deleteCotizacion);
  server.post("/cotizaciones/import/pdf", importCotizacionFromPdf);
  server.post("/cotizaciones/import/pdf/batch", importCotizacionesFromPdfBatch);
  server.post("/cotizaciones/import/rcv", importVentasCSV);
  server.post("/cotizaciones/:id/upload/:docType", uploadCotizacionDoc);
  server.delete("/cotizaciones/adjuntos/:adjuntoId", deleteCotizacionAdjunto);
  
  // Pagos
  server.post("/cotizaciones/:id/pagos", addPago);
  server.delete("/cotizaciones/pagos/:pagoId", deletePago);
  server.post("/cotizaciones/pagos/:pagoId/upload/comprobante", uploadPagoDoc);
}
