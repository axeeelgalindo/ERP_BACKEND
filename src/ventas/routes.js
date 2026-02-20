import {
  listVentas,
  createVenta,
  listOrdenesVenta,
  getVenta,
  updateVenta,
  deleteVenta,
  disableVenta,
} from "./controllers.js";

import {
  createTipoDia,
  createTipoItem,
  createUnidadItem,
  getTipoDias,
  getTipoItems,
  getUnidadItems,
  listCompraItemsForVentas,
  listEmpleadosForVentas,
  listHHPeriodos
} from "./complements/controllers.js";

export default async function ventasRoutes(server) {
  server.get("/ventas/ordenes-venta", listOrdenesVenta);

  server.post("/ventas/add", createVenta);
  server.put("/ventas/:id", updateVenta);

  server.get("/ventas", listVentas);
  server.get("/ventas/:id", getVenta);
  server.post("/tipoDia/add", createTipoDia);
  server.post("/unidadItem/add", createUnidadItem);
  server.post("/tipoItem/add", createTipoItem);

  server.get("/ventas/tipodias", getTipoDias);
  server.get("/ventas/tipoitems", getTipoItems);
  server.get("/ventas/unidaditems", getUnidadItems);

  server.get("/ventas/empleados", listEmpleadosForVentas);
  server.get("/hh/periodos", listHHPeriodos);
  server.get("/ventas/compra-items", listCompraItemsForVentas);


  // Deshabilitar (soft delete)
  server.patch("/ventas/:id/disable", disableVenta);

  // Eliminar (hard delete con ?force=true, si no => soft delete)
  server.delete("/ventas/:id/delete", deleteVenta);
}
