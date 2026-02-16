import {
  listClientes,
  getCliente,
  createCliente,
  updateCliente,
  deleteCliente,
  disableCliente,
  restoreCliente,

  // ✅ faltaban
  uploadClienteLogo,
  listClienteCuentas,
  createClienteCuenta,
  updateClienteCuenta,
  setClienteCuentaPrincipal,
  disableClienteCuenta,
  listClienteResponsables,
  createClienteResponsable,
  updateClienteResponsable,
  setClienteResponsablePrincipal,
  disableClienteResponsable,
} from "./controllers.js";

import {
  ClienteQuery,
  ClienteCreateBody,
  ClienteUpdateBody,
  ClienteIdParam,
} from "./validators.js";

export default async function clientesRoutes(server) {
  server.get(
    "/clientes",
    { schema: { querystring: ClienteQuery } },
    listClientes,
  );

  server.get(
    "/clientes/:id",
    { schema: { params: ClienteIdParam } },
    getCliente,
  );

  server.post(
    "/clientes/add",
    { schema: { body: ClienteCreateBody } },
    createCliente,
  );

  server.patch(
    "/clientes/update/:id",
    { schema: { params: ClienteIdParam, body: ClienteUpdateBody } },
    updateCliente,
  );

  // Soft delete / restore
  server.patch(
    "/clientes/disable/:id",
    { schema: { params: ClienteIdParam } },
    disableCliente,
  );

  server.patch(
    "/clientes/restore/:id",
    { schema: { params: ClienteIdParam } },
    restoreCliente,
  );

  // Delete físico
  server.delete(
    "/clientes/delete/:id",
    { schema: { params: ClienteIdParam } },
    deleteCliente,
  );

  // ✅ Subir logo (archivo)
  server.post("/clientes/logo/:id", uploadClienteLogo);

  /* =========================
     CUENTAS
  ========================= */
  server.get("/clientes/:id/cuentas", listClienteCuentas);

  server.post("/clientes/:id/cuentas", createClienteCuenta);

  server.patch("/clientes/:id/cuentas/:cuentaId", updateClienteCuenta);

  server.patch(
    "/clientes/:id/cuentas/:cuentaId/principal",
    setClienteCuentaPrincipal,
  );

  server.patch("/clientes/:id/cuentas/:cuentaId/disable", disableClienteCuenta);

  /* =========================
     RESPONSABLES
  ========================= */
  server.get("/clientes/:id/responsables", listClienteResponsables);

  server.post("/clientes/:id/responsables", createClienteResponsable);

  server.patch(
    "/clientes/:id/responsables/:responsableId",
    updateClienteResponsable,
  );

  server.patch(
    "/clientes/:id/responsables/:responsableId/principal",
    setClienteResponsablePrincipal,
  );

  server.patch(
    "/clientes/:id/responsables/:responsableId/disable",
    disableClienteResponsable,
  );
}
