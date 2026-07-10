import { PrismaClient } from "@prisma/client";
import { pipeline } from "stream/promises";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { recomputeTareaFromDetalles } from "./detalles.controllers.js";
import { recomputeEpicaFromTareas } from "./epicas.controllers.js";
import { resolveScope } from "../lib/scope.js";
import { notifyTaskReview } from "./notification.js";

const prisma = new PrismaClient();

export async function processTransition(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const parts = request.parts();
  
  let fields = {};
  let uploadUrls = [];

  for await (const part of parts) {
    if (part.type === "file" && part.filename) {
      const ext = path.extname(part.filename);
      const rand = crypto.randomBytes(8).toString("hex");
      const savedName = `ev_${rand}${ext}`;
      const uploadsRoot = path.resolve(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });
      
      const savePath = path.join(uploadsRoot, savedName);
      await pipeline(part.file, fs.createWriteStream(savePath));
      uploadUrls.push(`/api/uploads/${savedName}`);
    } else {
      fields[part.fieldname] = part.value;
    }
  }

  const { tipo, targetStatus, fecha_inicio_real, comentario } = fields;

  if (!tipo || !targetStatus) {
    return reply.code(400).send({ ok: false, message: "Faltan datos de transición (tipo, targetStatus)" });
  }

  // Mapeo de estados del frontend ("POR HACER") a DB ("pendiente")
  const statusMap = {
    "POR HACER": "pendiente",
    "EN CURSO": "en_progreso",
    "EN REVISIÓN": "en_revision",
    "COMPLETADO": "completada",
  };

  const newStatus = statusMap[targetStatus] || targetStatus;

  try {
    const result = await prisma.$transaction(async (tx) => {
      let item = null;
      let updateData = { estado: newStatus };

      if (newStatus === "en_progreso" && fecha_inicio_real) {
        updateData.fecha_inicio_real = new Date(fecha_inicio_real);
        updateData.avance = 5; // Avance inicial
      }

      if (newStatus === "completada") {
        updateData.avance = 100;
        updateData.fecha_fin_real = new Date();
      }

      if (tipo === "SUBTAREA") {
        item = await tx.tareaDetalle.findUnique({ where: { id } });
        if (!item) throw new Error("Subtarea no encontrada");
        
        await tx.tareaDetalle.update({
          where: { id },
          data: updateData
        });

        if (uploadUrls.length > 0) {
          for (const url of uploadUrls) {
            await tx.tareaEvidencia.create({
              data: {
                subtarea_id: id,
                tarea_id: item.tarea_id,
                archivo_url: url,
                comentario: comentario || null
              }
            });
          }
        }
        
        const tUpd = await recomputeTareaFromDetalles(tx, item.tarea_id);
        if (tUpd?.epica_id) await recomputeEpicaFromTareas(tx, tUpd.epica_id);

      } else if (tipo === "TAREA") {
        item = await tx.tarea.findUnique({ where: { id } });
        if (!item) throw new Error("Tarea no encontrada");

        await tx.tarea.update({
          where: { id },
          data: updateData
        });

        if (uploadUrls.length > 0) {
          for (const url of uploadUrls) {
            await tx.tareaEvidencia.create({
              data: {
                tarea_id: id,
                archivo_url: url,
                comentario: comentario || null
              }
            });
          }
        }
        
        if (item.epica_id) await recomputeEpicaFromTareas(tx, item.epica_id);

      } else if (tipo === "EPICA") {
        item = await tx.epica.findUnique({ where: { id } });
        if (!item) throw new Error("Épica no encontrada");

        await tx.epica.update({
          where: { id },
          data: updateData
        });
        // Epicas no tienen tabla de evidencias propia en este esquema (se ven en tareas), 
        // pero podemos guardar el comentario/archivo si existiera una tabla. 
        // Por ahora solo actualizamos estado/fechas.
      }

      return { ok: true };
    });

    if (newStatus === "en_revision") {
      notifyTaskReview({
        tareaId: id,
        isSubtask: tipo === "SUBTAREA",
        actorName: request.user?.nombre
      }).catch(err => {
        console.error("[Mail] Error triggered in notifyTaskReview transition hook:", err);
      });
    }

    return reply.send(result);
  } catch (err) {
    console.error("Transition error:", err);
    return reply.code(500).send({ ok: false, message: err.message });
  }
}
