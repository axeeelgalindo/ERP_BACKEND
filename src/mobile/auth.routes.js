// src/mobile/auth.routes.js
import { mobileLogin } from "./auth.controllers.js";

export default async function mobileAuthRoutes(fastify, opts) {
  fastify.post("/login", mobileLogin(fastify));
}
