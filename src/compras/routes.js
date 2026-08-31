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
  importComprasClassified,
  checkRcvDocuments,

  // ✅ NUEVO
  uploadFacturaCompra,
  getCompraCosteos,
  setCompraCosteos,
  asignarRendicionACompra,
  
  // ✅ OLLAMA & Workflow
  listItemsCosteoDisponibles,
  analizarCotizacionProveedor,
  createOrdenCompraProveedor,
} from "./controllers.js";

export default async function compraRoutes(server) {
  // ✅ Protege todas las rutas de compras
  server.addHook("preHandler", async (request, reply) => {
    await request.jwtVerify();
    const u = request.user || {};
    request.scope = {
      userId: u.userId ?? u.sub ?? u.id ?? null,
      empresaId: u.empresaId ?? u.empresa?.id ?? null,
      rolCodigo: (u.rol?.codigo ?? u.rolCodigo ?? "").toString().toUpperCase(),
    };
  });

  // workflow items
  server.get("/compras/items-costeo-disponibles", listItemsCosteoDisponibles);
  server.post("/compras/ordenes-compra/analizar-cotizacion", analizarCotizacionProveedor);
  server.post("/compras/ordenes-compra", createOrdenCompraProveedor);
  // upload csv
  server.post("/compras/import-csv", importComprasCSV);
  server.post("/compras/import-classified", importComprasClassified);
  server.post("/compras/check-rcv", checkRcvDocuments);

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
