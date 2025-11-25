import {
  listEmpresas,
  getEmpresa,
  createEmpresa,
  updateEmpresa,
  deleteEmpresa,
  disableEmpresa,
  restoreEmpresa,
} from "./controllers.js";

import {
  EmpresaCreateBody,
  EmpresaUpdateBody,
  EmpresaIdParam,
  EmpresaQuery,
} from "./validators.js";

export default async function empresaRoutes(server) {
  // El guard de auth si tu plugin ya lo decoró
  const guard = server.authenticate ? { preHandler: [server.authenticate] } : {};

  // Listar empresas
  server.get("/empresa", { ...guard, schema: { querystring: EmpresaQuery } }, listEmpresas);

  // Obtener empresa
  server.get("/empresa/:id", { ...guard, schema: { params: EmpresaIdParam } }, getEmpresa);

  // Crear empresa
  server.post("/empresa/add", { ...guard, schema: { body: EmpresaCreateBody } }, createEmpresa);

  // Actualizar empresa
  server.patch(
    "/empresa/update/:id",
    { ...guard, schema: { params: EmpresaIdParam, body: EmpresaUpdateBody } },
    updateEmpresa
  );

  // Soft-delete
  server.patch("/empresa/disable/:id", { ...guard, schema: { params: EmpresaIdParam } }, disableEmpresa);

  // Restaurar
  server.patch("/empresa/restore/:id", { ...guard, schema: { params: EmpresaIdParam } }, restoreEmpresa);

  // Hard delete (solo si está deshabilitada o con ?force=true)
  server.delete("/empresa/delete/:id", { ...guard, schema: { params: EmpresaIdParam } }, deleteEmpresa);
}
