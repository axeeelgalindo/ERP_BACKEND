import {
  listProductos,
  getProducto,
  createProducto,
  updateProducto,
  deleteProducto,
  disableProducto,
  restoreProducto,
} from "./controllers.js";

import {
  ProductoQuery,
  ProductoCreateBody,
  ProductoUpdateBody,
  ProductoIdParam,
} from "./validators.js";

export default async function productosRoutes(server) {
  // Siguiendo tu patrón actual (auth global antes del Router)
  server.get("/productos", { schema: { querystring: ProductoQuery } }, listProductos);
  server.get("/productos/:id", { schema: { params: ProductoIdParam } }, getProducto);
  server.post("/productos/add", { schema: { body: ProductoCreateBody } }, createProducto);
  server.patch("/productos/update/:id", {
    schema: { params: ProductoIdParam, body: ProductoUpdateBody },
  }, updateProducto);
  server.delete("/productos/delete/:id", {
    schema: { params: ProductoIdParam, querystring: ProductoQuery },
  }, deleteProducto);

  // Soft delete / restore
  server.patch("/productos/disable/:id", { schema: { params: ProductoIdParam } }, disableProducto);
  server.patch("/productos/restore/:id", { schema: { params: ProductoIdParam } }, restoreProducto);
}
