import { listVentas, createVenta,listOrdenesVenta, getVenta } from "./controllers.js";

import {
  createTipoDia,
  createTipoItem,
  createUnidadItem,
  getTipoDias,
  getTipoItems,
  getUnidadItems,
  listCompraItemsForVentas,
  listEmpleadosForVentas,
  listHHEmpleadosForVentas,
  

} from "./complements/controllers.js";


export default async function ventasRoutes(server) {
  server.get("/ventas/ordenes-venta", listOrdenesVenta);

  server.post("/ventas/add", createVenta);
  server.get("/ventas", listVentas);
  server.get("/ventas/:id", getVenta);
  server.post("/tipoDia/add", createTipoDia);
  server.post("/unidadItem/add", createUnidadItem);
  server.post("/tipoItem/add", createTipoItem);

  server.get("/ventas/tipodias", getTipoDias);
  server.get("/ventas/tipoitems", getTipoItems);
  server.get("/ventas/unidaditems", getUnidadItems);

  server.get("/ventas/empleados", listEmpleadosForVentas);
  server.get("/ventas/hh-empleados", listHHEmpleadosForVentas);
  server.get("/ventas/compra-items", listCompraItemsForVentas);
}
