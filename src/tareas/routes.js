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
  assignEpicaToTarea,
  createTareasBatch,
  unassignEpicaFromTarea,
  addDetallesToTarea,
  listTareasByEpica,
  // ...otros
} from "./controllers.js";
import { processTransition } from "./transition.controllers.js";

import {
  TareaCreateBody,
  TareaDepCreate,
  TareaDepIdParam,
  TareaIdParam,
  TareaQuery,
  TareaUpdateBody,
} from "./validators.js";

import {
  listTareaDetalles,
  createTareaDetalle,
  updateTareaDetalle,
  deleteTareaDetalle,
} from "./detalles.controllers.js";

import {
  TareaDetalleCreateBody,
  TareaDetalleUpdateBody,
  TareaDetalleIdParam,
  TareaDetalleListByTareaParam,
} from "./detalles.validators.js";

import {
  createEpica,
  disableEpica,
  getEpica,
  listEpicas,
  restoreEpica,
  updateEpica,
} from "./epicas.controllers.js";

export default async function tareasRoutes(server) {
  const guard = server.authenticate ? { preHandler: [server.authenticate] } : {};

  // ===== TAREAS =====

  // listado general (tu existente)
  server.get("/tareas", { schema: { querystring: TareaQuery }, ...guard }, listTareas);

  // ✅ listado por épica (para wizard)
  // GET /tareas/by-epica?proyecto_id=...&epica_id=...
  server.get("/tareas/by-epica", { ...guard }, listTareasByEpica);

  server.get("/tareas/:id", { schema: { params: TareaIdParam }, ...guard }, getTarea);

  server.post("/tareas/add", { schema: { body: TareaCreateBody }, ...guard }, createTarea);

  server.patch(
    "/tareas/update/:id",
    { schema: { params: TareaIdParam, body: TareaUpdateBody }, ...guard },
    updateTarea
  );

  // soft delete / restore
  server.patch("/tareas/disable/:id", { schema: { params: TareaIdParam }, ...guard }, disableTarea);
  server.patch("/tareas/restore/:id", { schema: { params: TareaIdParam }, ...guard }, restoreTarea);

  // hard delete
  server.delete("/tareas/delete/:id", { schema: { params: TareaIdParam }, ...guard }, deleteTarea);

  // dependencias
  server.post("/tareas/dependencias", { schema: { body: TareaDepCreate }, ...guard }, addDependencia);

  server.delete(
    "/tareas/dependencias/:id",
    { schema: { params: TareaDepIdParam }, ...guard },
    removeDependencia
  );

  // ===== DETALLES DE TAREA (SUBTAREAS) =====

  server.get(
    "/tareas/:tareaId/detalles",
    { schema: { params: TareaDetalleListByTareaParam }, ...guard },
    listTareaDetalles
  );

  server.post(
    "/tareas-detalle/add",
    { schema: { body: TareaDetalleCreateBody }, ...guard },
    createTareaDetalle
  );

  server.patch(
    "/tareas-detalle/update/:id",
    { schema: { params: TareaDetalleIdParam, body: TareaDetalleUpdateBody }, ...guard },
    updateTareaDetalle
  );

  server.delete(
    "/tareas-detalle/delete/:id",
    { schema: { params: TareaDetalleIdParam }, ...guard },
    deleteTareaDetalle
  );

  // ✅ batch subtareas
  server.post("/tareas-detalle/batch-add", { ...guard }, addDetallesToTarea);

  // ===== EPICAS =====
  server.get("/epicas", { ...guard }, listEpicas); // ?proyectoId=...
  server.get("/epicas/:id", { ...guard }, getEpica);
  server.post("/epicas/add", { ...guard }, createEpica);
  server.put("/epicas/update/:id", { ...guard }, updateEpica);
  server.patch("/epicas/disable/:id", { ...guard }, disableEpica);
  server.post("/epicas/:id/restore", { ...guard }, restoreEpica);

  // ===== FUNCIONES EXTRA =====

  // ✅ asignar épica a tarea existente (sin épica)
  server.patch("/tareas/assign-epica/:tarea_id", { ...guard }, assignEpicaToTarea);

  // ✅ quitar épica (volver a "Sin épica")
  server.patch("/tareas/unassign-epica/:tarea_id", { ...guard }, unassignEpicaFromTarea);

  // ✅ Transiciones interactivas (Kanban)
  server.post("/tareas/:id/transition", { ...guard }, processTransition);

  // ✅ crear varias tareas en una épica
  server.post("/tareas/batch-add", { ...guard }, createTareasBatch);
}