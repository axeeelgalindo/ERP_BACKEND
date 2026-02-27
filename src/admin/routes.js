// src/admin/routes.js
import {
  adminBuscarCotizaciones,
  adminCambiarNumeroCotizacion,
  adminSyncCotizacionesNumeroSeq,
} from "./controllers.js";

export default async function routes(fastify) {
  // ✅ IMPORTANTE: estas rutas requieren usuario autenticado
  // (esto llena request.user / request.scope según tu auth plugin)
  fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/admin/cotizaciones", adminBuscarCotizaciones);
  fastify.post("/admin/cotizaciones/sync-seq", adminSyncCotizacionesNumeroSeq);
  fastify.patch("/admin/cotizaciones/:id/numero", adminCambiarNumeroCotizacion);
}