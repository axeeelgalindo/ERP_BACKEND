import {
  addDependencia,
  createTarea,
  deleteTarea,
  getTarea,
  listTareas,
  removeDependencia,
  updateTarea,
  disableTarea,
  restoreTarea,
} from "./controllers.js";

import {
  TareaCreateBody,
  TareaDepCreate,
  TareaDepIdParam,
  TareaIdParam,
  TareaQuery,
  TareaUpdateBody,
} from "./validators.js";

export default async function tareasRoutes(server) {
  // Si tu auth plugin decoró authenticate, úsalo
  const guard = server.authenticate ? { preHandler: [server.authenticate] } : {};

  server.get("/tareas", { schema: { querystring: TareaQuery }, ...guard }, listTareas);
  server.get("/tareas/:id", { schema: { params: TareaIdParam }, ...guard }, getTarea);

  server.post("/tareas/add", { schema: { body: TareaCreateBody }, ...guard }, createTarea);
  server.patch("/tareas/update/:id", { schema: { params: TareaIdParam, body: TareaUpdateBody }, ...guard }, updateTarea);

  // soft delete / restore
  server.patch("/tareas/disable/:id", { schema: { params: TareaIdParam }, ...guard }, disableTarea);
  server.patch("/tareas/restore/:id", { schema: { params: TareaIdParam }, ...guard }, restoreTarea);

  // hard delete
  server.delete("/tareas/delete/:id", { schema: { params: TareaIdParam }, ...guard }, deleteTarea);

  // dependencias
  server.post("/tareas/dependencias", { schema: { body: TareaDepCreate }, ...guard }, addDependencia);
  server.delete("/tareas/dependencias/:id", { schema: { params: TareaDepIdParam }, ...guard }, removeDependencia);
}
