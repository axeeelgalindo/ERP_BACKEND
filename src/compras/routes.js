import {
  listCompras,
  createCompra,
  deleteCompra,
  disableCompra,
  getCompra,
  restoreCompra,
  updateCompra,
  listComprasDisponiblesVenta,
  importComprasCSV,
} from "./controllers.js";

export default async function compraRoutes(server) {
  // upload csv
  server.post("/compras/import-csv", importComprasCSV);

  // LIST
  server.get("/compras", listCompras);

  // GET
  server.get("/compras/:id", getCompra);

  // CREATE
  server.post("/compras", createCompra);

  // UPDATE
  server.put("/compras/:id", updateCompra);

  // SOFT DELETE
  server.patch("/compras/:id/disable", disableCompra);

  // RESTORE
  server.patch("/compras/:id/restore", restoreCompra);

  // DELETE físico
  server.delete("/compras/:id", deleteCompra);

  server.get("/compras/disponibles-venta", listComprasDisponiblesVenta);
}
