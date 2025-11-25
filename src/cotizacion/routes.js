// src/modules/cotizaciones/routes.js
import {
  listCotizaciones,
  getCotizacion,
  createCotizacion,
  updateCotizacion,
  deleteCotizacion,
  disableCotizacion,
  restoreCotizacion,
  setEstadoCotizacion,
  addItem,
  updateItem,
  deleteItem,
  getNextNumeroCotizacion,
} from "./controllers.js";

import {
  CotizacionQuery,
  CotizacionCreateBody,
  CotizacionUpdateBody,
  CotizacionIdParam,
  EstadoBody,
  ItemCreateBody,
  ItemUpdateBody,
  ItemIdParam,
} from "./validators.js";

export default async function cotizacionesRoutes(server) {
  // Si quieres proteger todo con auth:
  // server.addHook("onRequest", server.authenticate);

  // preview próximo número
  server.get("/cotizaciones/next-numero", getNextNumeroCotizacion);

  // listar y obtener una
  server.get(
    "/cotizaciones",
    { schema: { querystring: CotizacionQuery } },
    listCotizaciones
  );

  server.get(
    "/cotizaciones/:id",
    { schema: { params: CotizacionIdParam } },
    getCotizacion
  );

  // crear
  server.post(
    "/cotizaciones/add",
    { schema: { body: CotizacionCreateBody } },
    createCotizacion
  );

  // actualizar
  server.patch(
    "/cotizaciones/update/:id",
    {
      schema: { params: CotizacionIdParam, body: CotizacionUpdateBody },
    },
    updateCotizacion
  );

  // borrar físico (con ?force=true si no está en borrador)
  server.delete(
    "/cotizaciones/delete/:id",
    {
      schema: { params: CotizacionIdParam, querystring: CotizacionQuery },
    },
    deleteCotizacion
  );

  // soft-delete / restore
  server.patch(
    "/cotizaciones/disable/:id",
    { schema: { params: CotizacionIdParam } },
    disableCotizacion
  );

  server.patch(
    "/cotizaciones/restore/:id",
    { schema: { params: CotizacionIdParam } },
    restoreCotizacion
  );

  // cambiar solo el estado
  server.patch(
    "/cotizaciones/estado/:id",
    {
      schema: { params: CotizacionIdParam, body: EstadoBody },
    },
    setEstadoCotizacion
  );

  // ítems
  server.post(
    "/cotizaciones/:id/items",
    {
      schema: { params: CotizacionIdParam, body: ItemCreateBody },
    },
    addItem
  );

  server.patch(
    "/cotizaciones/items/:itemId",
    {
      schema: { params: ItemIdParam, body: ItemUpdateBody },
    },
    updateItem
  );

  server.delete(
    "/cotizaciones/items/:itemId",
    {
      schema: { params: ItemIdParam },
    },
    deleteItem
  );
}
