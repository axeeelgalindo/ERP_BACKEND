// src/routes/rendiciones.routes.js
import {
  createRendicion,
  listRendiciones,
  getRendicionById,
  updateRendicion,
  deleteRendicion,
  uploadComprobanteItem,
} from "./controllers.js";

export default async function rendicionesRoutes(fastify) {
  fastify.get("/rendiciones", listRendiciones);
  fastify.get("/rendiciones/:id", getRendicionById);
  fastify.post("/rendiciones", createRendicion);
  fastify.patch("/rendiciones/:id", updateRendicion);
  fastify.delete("/rendiciones/:id", deleteRendicion);

   // Comprobante por item (multipart file)
  fastify.post(
    "/rendiciones/:id/items/:itemId/comprobante",
    uploadComprobanteItem
  );
}