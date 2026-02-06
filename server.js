// server.js
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";

import authz from "./src/lib/authz.js";
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
  maxAge: 86400,
});

// multipart ANTES de rutas que lo usan
await server.register(fastifyMultipart, {
  limits: { fileSize: 20 * 1024 * 1024 },
});

// auth (crea server.authenticate)
await server.register(authz);

// ✅ SERVIR /api/uploads/* desde backend/uploads/*
const uploadsRoot = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });

await server.register(fastifyStatic, {
  root: uploadsRoot,
  prefix: "/api/uploads/", // ahora /api/uploads/facturas/... funciona
  decorateReply: false,
});

server.get("/", async () => ({ hello: "Soy la api" }));

// Prefijo /api para todo
await server.register(Router, { prefix: "/api" });

const PORT = Number(process.env.PORT || 3001);
server.addHook("onClose", async () => prisma.$disconnect());

server.listen({ port: PORT, host: "0.0.0.0" });
