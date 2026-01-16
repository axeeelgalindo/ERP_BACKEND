// src/modules/hh/routes.js
import {
  uploadLibroRemuneraciones,
  listHH,

  // ✅ CIF (en el mismo controller de HH)
  createCIF,
  listCIF,
  getUltimoCIF,
} from "./controllers.js";

export default async function hhRoutes(server) {
  server.post("/hh/libro/upload", uploadLibroRemuneraciones);
  server.get("/hh/libro", listHH);

  // ✅ CIF endpoints
  server.post("/hh/cif", createCIF);
  server.get("/hh/cif", listCIF);
  server.get("/hh/cif/ultimo", getUltimoCIF);
}
