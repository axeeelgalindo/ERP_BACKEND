import {
  listCompras,
  getCompra,
  createCompra,
  updateCompra,
  deleteCompra,
  disableCompra,
  restoreCompra,
} from "./controllers.js";

import {
  CompraQuery,
  CompraCreateBody,
  CompraUpdateBody,
  CompraIdParam,
} from "./validators.js";

export default async function comprasRoutes(server) {
  // Autenticación ya está global, seguimos el patrón del resto
  server.get("/compras", { schema: { querystring: CompraQuery } }, listCompras);
  server.get("/compras/:id", { schema: { params: CompraIdParam } }, getCompra);

  server.post("/compras/add", { schema: { body: CompraCreateBody } }, createCompra);

  server.patch("/compras/update/:id", {
    schema: { params: CompraIdParam, body: CompraUpdateBody },
  }, updateCompra);

  server.delete("/compras/delete/:id", {
    schema: { params: CompraIdParam, querystring: CompraQuery },
  }, deleteCompra);

  server.patch("/compras/disable/:id", { schema: { params: CompraIdParam } }, disableCompra);
  server.patch("/compras/restore/:id", { schema: { params: CompraIdParam } }, restoreCompra);
}
