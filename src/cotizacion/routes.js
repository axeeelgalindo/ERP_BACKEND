// src/modules/cotizaciones/routes.js
import {
  listCotizaciones,
  getCotizacion,
  createCotizacion,
  updateCotizacion,
  updateCotizacionEstado,
} from "./controllers.js";

export default async function cotizacionesRoutes(server) {
  server.get("/cotizaciones", listCotizaciones);
  server.get("/cotizaciones/:id", getCotizacion);

  // ✅ crear cotización con glosas
  server.post("/cotizaciones/add", createCotizacion);

  // ✅ actualizar cabecera / total / glosas (si las mandas)
  server.put("/cotizaciones/update/:id", updateCotizacion);

  // ✅ estado
  server.post("/cotizaciones/:id/estado", updateCotizacionEstado);
}
