import {
  listProveedores,
  getProveedor,
  createProveedor,
  updateProveedor,
  deleteProveedor,
  disableProveedor,
  restoreProveedor,
} from "./controllers.js";

import {
  ProveedorQuery,
  ProveedorCreateBody,
  ProveedorUpdateBody,
  ProveedorIdParam,
} from "./validators.js";

export default async function proveedoresRoutes(server) {
  // Igual a tu patrón: auth global ya se aplica antes de registrar rutas.
  server.get("/proveedores", { schema: { querystring: ProveedorQuery } }, listProveedores);
  server.get("/proveedores/:id", { schema: { params: ProveedorIdParam } }, getProveedor);
  server.post("/proveedores/add", { schema: { body: ProveedorCreateBody } }, createProveedor);
  server.patch("/proveedores/update/:id", {
    schema: { params: ProveedorIdParam, body: ProveedorUpdateBody },
  }, updateProveedor);
  server.delete("/proveedores/delete/:id", {
    schema: { params: ProveedorIdParam, querystring: ProveedorQuery },
  }, deleteProveedor);

  server.patch("/proveedores/disable/:id", { schema: { params: ProveedorIdParam } }, disableProveedor);
  server.patch("/proveedores/restore/:id", { schema: { params: ProveedorIdParam } }, restoreProveedor);
}
