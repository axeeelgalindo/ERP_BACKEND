// src/mobile/routes.js
import { mobileLogin } from "./auth.controllers.js";
import { 
  listMobileProyectos, 
  listMobileTareas, 
  startMobileTarea, 
  finishMobileTarea 
} from "./tareas.controllers.js";

// Necesario si vas a usar multipart para recibir la foto
import fastifyMultipart from "@fastify/multipart";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";

export default async function mobileRoutes(fastify, opts) {
  // ======= AUTH =======
  fastify.post("/mobile/auth/login", mobileLogin(fastify));

  // ======= TAREAS (Requiere Authentication) =======
  fastify.register(async function (protectedFastify) {
    protectedFastify.addHook("onRequest", protectedFastify.authenticate);

    protectedFastify.get("/mobile/proyectos", listMobileProyectos);
    protectedFastify.get("/mobile/proyectos/:proyectoId/tareas", listMobileTareas);
    
    protectedFastify.post("/mobile/tareas/:id/iniciar", startMobileTarea);
    protectedFastify.post("/mobile/tareas/:id/finalizar", finishMobileTarea);
  });
}
