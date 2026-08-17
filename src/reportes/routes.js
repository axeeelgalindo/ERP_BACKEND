// src/reportes/routes.js
import { getReporteTareasCompletadas } from "./controllers.js";

export default async function reportesRoutes(server) {
  const guard = server.authenticate
    ? { preHandler: [server.authenticate] }
    : {};

  server.get("/reportes/tareas-completadas", { ...guard }, getReporteTareasCompletadas);
}
