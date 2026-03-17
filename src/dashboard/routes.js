// src/dashboard/routes.js
import { getDashboardData } from "./controllers.js";

export default async function dashboardRoutes(fastify, options) {
  // Aseguramos que la ruta requiera autenticación
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/dashboard", getDashboardData);
}
