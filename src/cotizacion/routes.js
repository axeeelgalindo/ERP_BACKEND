import { listCotizaciones, getCotizacion, createCotizacionFromVentas, updateCotizacionEstado } from "./controllers.js";

export default async function cotizacionesRoutes(server) {
  server.get("/cotizaciones", listCotizaciones);
  server.get("/cotizaciones/:id", getCotizacion);
  server.post("/cotizaciones/add", createCotizacionFromVentas);
  server.post("/cotizaciones/:id/estado", updateCotizacionEstado);
}