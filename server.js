import Fastify from "fastify";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { PrismaClient } from "@prisma/client";

import authz from "./src/lib/authz.js";     // 👈 ruta correcta
import Router from "./src/utils/Routes.js";

const server = Fastify({ logger: true });
const prisma = new PrismaClient();

await server.register(sensible);
await server.register(jwt, { secret: process.env.JWT_SECRET });

await server.register(cors, {
  origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-empresa-id"],
  exposedHeaders: [],
  maxAge: 86400,
});

// 👇 Debe ir ANTES del Router (crea server.authenticate)
await server.register(authz);

server.get("/", async () => ({ hello: "Soy la api" }));

// Prefijo /api para todo
await server.register(Router, { prefix: "/api" });

const PORT = Number(process.env.PORT || 3001);
server.addHook("onClose", async () => prisma.$disconnect());
server.listen({ port: PORT, host: "0.0.0.0" });
