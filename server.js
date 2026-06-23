// server.js
import 'dotenv/config';
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
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";

const server = Fastify({ logger: true });
const prisma = new PrismaClient();

await server.register(sensible);

// Registrar Swagger
await server.register(fastifySwagger, {
  openapi: {
    info: {
      title: "Blue Ingeniería ERP API",
      description: "Documentación interactiva de la API del ERP de Blue Ingeniería",
      version: "1.0.0",
    },
    servers: [
      {
        url: "http://localhost:3002",
        description: "Servidor de Desarrollo Local",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Ingresa el token JWT en el formato: Bearer <token>",
        },
      },
    },
  },
});

// Registrar Swagger UI
await server.register(fastifySwaggerUi, {
  routePrefix: "/documentation",
  uiConfig: {
    docExpansion: "list",
    deepLinking: false,
  },
  exposeRoute: true,
});

await server.register(jwt, { secret: process.env.JWT_SECRET });

await server.register(cors, {
  origin: [
    "http://localhost:3000",
    "http://localhost:3003",
    "http://127.0.0.1:3000",
    "https://erp-orcin-ten.vercel.app",
    "https://api-erp.blue-ingenieria.com",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-empresa-id"],
  maxAge: 86400,
});

// multipart ANTES de rutas que lo usan
await server.register(fastifyMultipart, {
  limits: { fileSize: 500 * 1024 * 1024 },
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

const PORT = Number(process.env.PORT || 3002);
server.addHook("onClose", async () => prisma.$disconnect());

server.listen({ port: PORT, host: "0.0.0.0" });
