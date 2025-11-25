import {
  listRendiciones,
  getRendicion,
  createRendicion,
  updateRendicion,
  deleteRendicion,
  disableRendicion,
  restoreRendicion,
  addRendicionItem,
  updateRendicionItem,
  deleteRendicionItem,
} from "./controllers.js";

import {
  RendicionQuery,
  RendicionCreateBody,
  RendicionUpdateBody,
  RendicionIdParam,
  RendItemCreateBody,
  RendItemUpdateBody,
  RendItemIdParam,
} from "./validators.js";

export default async function rendicionesRoutes(server) {
  // server.addHook("onRequest", server.authenticate);

  server.get("/rendiciones", { schema: { querystring: RendicionQuery } }, listRendiciones);
  server.get("/rendiciones/:id", { schema: { params: RendicionIdParam } }, getRendicion);

  server.post("/rendiciones/add", { schema: { body: RendicionCreateBody } }, createRendicion);

  server.patch("/rendiciones/update/:id", {
    schema: { params: RendicionIdParam, body: RendicionUpdateBody },
  }, updateRendicion);

  server.delete("/rendiciones/delete/:id", {
    schema: { params: RendicionIdParam, querystring: RendicionQuery },
  }, deleteRendicion);

  server.patch("/rendiciones/disable/:id", { schema: { params: RendicionIdParam } }, disableRendicion);
  server.patch("/rendiciones/restore/:id", { schema: { params: RendicionIdParam } }, restoreRendicion);

  // Items
  server.post("/rendiciones/:rendicion_id/items/add", {
    schema: { body: RendItemCreateBody, params: RendicionIdParam },
  }, addRendicionItem);

  server.patch("/rendiciones/items/update/:id", {
    schema: { params: RendItemIdParam, body: RendItemUpdateBody },
  }, updateRendicionItem);

  server.delete("/rendiciones/items/delete/:id", {
    schema: { params: RendItemIdParam },
  }, deleteRendicionItem);
}
