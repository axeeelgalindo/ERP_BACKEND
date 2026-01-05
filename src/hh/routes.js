import {
  uploadLibroRemuneraciones,
  listHH,
} from "./controllers.js";

export default async function hhRoutes(server) {
  server.post("/hh/libro/upload", uploadLibroRemuneraciones);

  server.get("/hh/libro", listHH);
}
