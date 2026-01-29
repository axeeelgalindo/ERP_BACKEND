// src/modules/hh/routes.js
import {
  uploadLibroRemuneraciones,
  listHH,
  createCIF,
  listCIF,
  getUltimoCIF,
} from "./controllers.js";

export default async function hhRoutes(server) {
  // ✅ Safety check (si authenticate no existe, el problema está en authz/plugin order)
  if (typeof server.authenticate !== "function") {
    server.log.error(
      { authenticate: typeof server.authenticate },
      "[HH] server.authenticate no está disponible. Revisa registro de authz."
    );
    throw new Error("Auth no registrado antes de HH routes");
  }

  // ✅ Protege todas las rutas de este módulo
  server.addHook("preHandler", server.authenticate);

  server.post("/hh/libro/upload", uploadLibroRemuneraciones);
  server.get("/hh/libro", listHH);

  server.post("/hh/cif", createCIF);
  server.get("/hh/cif", listCIF);
  server.get("/hh/cif/ultimo", getUltimoCIF);
}
