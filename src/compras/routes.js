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

  // ✅ NUEVO
  uploadFacturaCompra,
  getCompraCosteos,
  setCompraCosteos,
  asignarRendicionACompra,
} from "./controllers.js";

export default async function compraRoutes(server) {
  // upload csv
  server.post("/compras/import-csv", importComprasCSV);

  // ✅ subir factura pdf
  server.post("/compras/:id/factura", uploadFacturaCompra);

  // ✅ costeos (ventas)
  server.get("/compras/:id/costeos", getCompraCosteos);
  server.put("/compras/:id/costeos", setCompraCosteos);

  // LIST
  server.get("/compras", listCompras);

  // GET
  server.get("/compras/:id", getCompra);

  // CREATE
  server.post("/compras", createCompra);

  // ASIGNAR RENDICIÓN (vincular compra con rendición)
  server.patch("/compras/:id/asignar-rendicion", asignarRendicionACompra);

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
