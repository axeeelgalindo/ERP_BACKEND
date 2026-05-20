// src/asistencia/routes.js
import { getAsistenciaDia, upsertAsistencia, getAsistenciaMensual } from "./controllers.js";

export default async function asistenciaRoutes(server) {
  // Authentication hook for all endpoints under this module
  server.addHook("preHandler", server.authenticate);

  server.get("/asistencia", getAsistenciaDia);
  server.get("/asistencia/mensual", getAsistenciaMensual);
  server.post("/asistencia", upsertAsistencia);
}
