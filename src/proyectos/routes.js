import {
  listProyectos,
  getProyecto,
  createProyecto,
  updateProyecto,
  deleteProyecto,
  disableProyecto,
  restoreProyecto,
  approveProyecto,
} from "./controllers.js";

import {
  ProyectoCreateBody,
  ProyectoIdParam,
  ProyectoQuery,
  ProyectoUpdateBody,
} from "./validators.js";

export default async function proyectosRoutes(server) {
  const guard = server.authenticate ? { preHandler: [server.authenticate] } : {};

  // Listado / detalle (pueden funcionar solo con x-empresa-id si no usas auth)
  server.get("/proyectos", listProyectos);
  server.get("/proyectos/:id", { schema: { params: ProyectoIdParam } }, getProyecto);

  // Crear / actualizar / borrar (si prefieres exigir auth, añade ...guard)
  server.post("/proyectos/add", { schema: { body: ProyectoCreateBody }, ...guard }, createProyecto);
  server.patch("/proyectos/update/:id", { schema: { params: ProyectoIdParam, body: ProyectoUpdateBody }, ...guard }, updateProyecto);
  server.delete("/proyectos/delete/:id", { schema: { params: ProyectoIdParam }, ...guard }, deleteProyecto);

  // Soft delete / restore (recomendado exigir auth)
  server.patch("/proyectos/disable/:id", { schema: { params: ProyectoIdParam }, ...guard }, disableProyecto);
  server.patch("/proyectos/restore/:id", { schema: { params: ProyectoIdParam }, ...guard }, restoreProyecto);

  // Aprobar (requiere validar usuario => necesita auth)
  server.patch("/proyectos/approve/:id", { schema: { params: ProyectoIdParam }, ...guard }, approveProyecto);
}
