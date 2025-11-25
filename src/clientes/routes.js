import {
  listClientes, getCliente, createCliente, updateCliente,
  deleteCliente, disableCliente, restoreCliente,
} from "./controllers.js";

import {
  ClienteQuery, ClienteCreateBody, ClienteUpdateBody, ClienteIdParam,
} from "./validators.js";

export default async function clientesRoutes(server) {
  // Si ya decoraste authenticate globalmente, no hace falta hook aquí;
  // resolveScope lanzará 401 si falta contexto.
  // server.addHook("onRequest", server.authenticate);

  server.get("/clientes", { schema: { querystring: ClienteQuery } }, listClientes);
  server.get("/clientes/:id", { schema: { params: ClienteIdParam } }, getCliente);
  server.post("/clientes/add", { schema: { body: ClienteCreateBody } }, createCliente);
  server.patch("/clientes/update/:id", {
    schema: { params: ClienteIdParam, body: ClienteUpdateBody },
  }, updateCliente);

  // Soft delete / restore
  server.patch("/clientes/disable/:id", { schema: { params: ClienteIdParam } }, disableCliente);
  server.patch("/clientes/restore/:id", { schema: { params: ClienteIdParam } }, restoreCliente);

  // Delete físico
  server.delete("/clientes/delete/:id", { schema: { params: ClienteIdParam } }, deleteCliente);
}
