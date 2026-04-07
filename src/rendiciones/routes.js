// src/routes/rendiciones.routes.js
import {
  createRendicion,
  listRendiciones,
  getRendicionById,
  updateRendicion,
  deleteRendicion,
  uploadComprobanteItem,
  uploadRendicionMainDoc,
} from "./controllers.js";

export default async function rendicionesRoutes(fastify) {
  fastify.get("/rendiciones", listRendiciones);
  fastify.get("/rendiciones/:id", getRendicionById);
  fastify.post("/rendiciones", createRendicion);
  fastify.patch("/rendiciones/:id", updateRendicion);
  fastify.delete("/rendiciones/:id", deleteRendicion);

  // Comprobante principal (anticipo/reembolso)
  fastify.post("/rendiciones/:id/documento", uploadRendicionMainDoc);

   // Comprobante por item (multipart file)
  fastify.post(
    "/rendiciones/:id/items/:itemId/comprobante",
    uploadComprobanteItem
  );
}