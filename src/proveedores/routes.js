// src/proveedor/routes.js
import {
  listProveedores,
  getProveedor,
  createProveedor,
  updateProveedor,
  deleteProveedor,
} from "./controllers.js";

export default async function proveedorRoutes(fastify) {
  // Si tu auth es global, no pongas nada acá.
  // Si necesitas auth por route:
  // fastify.addHook("onRequest", fastify.authenticate);

  fastify.get("/proveedores", listProveedores);
  fastify.get("/proveedores/:id", getProveedor);

  fastify.post("/proveedores", createProveedor);
  fastify.patch("/proveedores/:id", updateProveedor);

  fastify.delete("/proveedores/:id", deleteProveedor);
}