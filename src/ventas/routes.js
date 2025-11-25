import {
  listVentas,
  getVenta,
  createVenta,
  updateVenta,
  deleteVenta,
  disableVenta,
  restoreVenta,
  setEstadoVenta,
  addItem,
  updateItem,
  deleteItem,
} from "./controllers.js";

import {
  VentaQuery,
  VentaCreateBody,
  VentaUpdateBody,
  VentaIdParam,
  EstadoBody,
  ItemCreateBody,
  ItemUpdateBody,
  ItemIdParam,
} from "./validators.js";

export default async function ventasRoutes(server) {
  server.get("/ventas", { schema: { querystring: VentaQuery } }, listVentas);
  server.get("/ventas/:id", { schema: { params: VentaIdParam } }, getVenta);

  server.post("/ventas/add", { schema: { body: VentaCreateBody } }, createVenta);

  server.patch("/ventas/update/:id", {
    schema: { params: VentaIdParam, body: VentaUpdateBody },
  }, updateVenta);

  server.delete("/ventas/delete/:id", {
    schema: { params: VentaIdParam, querystring: VentaQuery },
  }, deleteVenta);

  server.patch("/ventas/disable/:id", { schema: { params: VentaIdParam } }, disableVenta);
  server.patch("/ventas/restore/:id", { schema: { params: VentaIdParam } }, restoreVenta);

  // estado
  server.patch("/ventas/estado/:id", {
    schema: { params: VentaIdParam, body: EstadoBody },
  }, setEstadoVenta);

  // Ítems
  server.post("/ventas/:id/items", {
    schema: { params: VentaIdParam, body: ItemCreateBody },
  }, addItem);

  server.patch("/ventas/items/:itemId", {
    schema: { params: ItemIdParam, body: ItemUpdateBody },
  }, updateItem);

  server.delete("/ventas/items/:itemId", {
    schema: { params: ItemIdParam },
  }, deleteItem);
}
