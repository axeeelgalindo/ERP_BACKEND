import {
  listProyectos,
  getProyecto,
  createProyecto,
  updateProyecto,
  deleteProyecto,
  disableProyecto,
  restoreProyecto,
  approveProyecto,
  iniciarProyecto,
  finalizarProyecto,
  reporteDevengadoProyecto,
  obtenerInfoProyecto,
  addProyectoRetraso,
  addMiembroProyecto
} from "./controllers.js";
import { reporteDevengadoProfesional } from "./devengado_new.js";

import { importJiraCSV } from "./proyectos.jira.controller.js";

import {
  ProyectoCreateBody,
  ProyectoCreateRequestBody,
  ProyectoIdParam,
  ProyectoUpdateBody,
} from "./validators.js";

export default async function proyectosRoutes(server) {
  const guard = server.authenticate
    ? { preHandler: [server.authenticate] }
    : {};

  server.get("/proyectos/:id/devengado", reporteDevengadoProfesional);

  server.get("/proyectos", listProyectos);

  server.get(
    "/proyectos/:id",
    { schema: { params: ProyectoIdParam } },
    getProyecto,
  );

  server.post(
    "/proyectos/add",
    { schema: { body: ProyectoCreateRequestBody }, ...guard },
    createProyecto,
  );

  server.patch(
    "/proyectos/update/:id",
    { schema: { params: ProyectoIdParam, body: ProyectoUpdateBody }, ...guard },
    updateProyecto,
  );

  server.delete(
    "/proyectos/delete/:id",
    { schema: { params: ProyectoIdParam }, ...guard },
    deleteProyecto,
  );

  server.patch(
    "/proyectos/disable/:id",
    { schema: { params: ProyectoIdParam }, ...guard },
    disableProyecto,
  );

  server.patch(
    "/proyectos/restore/:id",
    { schema: { params: ProyectoIdParam }, ...guard },
    restoreProyecto,
  );

  server.patch(
    "/proyectos/approve/:id",
    { schema: { params: ProyectoIdParam }, ...guard },
    approveProyecto,
  );

  // ✅ Import Jira
  server.post("/proyectos/:id/jira/import", { ...guard }, importJiraCSV);

  server.post("/proyectos/:id/iniciar", iniciarProyecto);
  server.post("/proyectos/:id/finalizar", finalizarProyecto);
  server.post("/proyectos/:id/retrasos", { ...guard }, addProyectoRetraso);
  server.post("/proyectos/:id/miembros/add", { ...guard }, addMiembroProyecto);

  //devengado
  server.get("/proyectos/:id/reporte-devengado", reporteDevengadoProyecto);

  //obtener info
  server.get("/proyectos/:id/info", obtenerInfoProyecto);
}
