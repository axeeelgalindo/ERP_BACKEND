// src/mobile/tareas.controllers.js
import { PrismaClient } from "@prisma/client";
import { pipeline } from "stream/promises";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { recomputeTareaFromDetalles } from "../tareas/detalles.controllers.js";
import { recomputeEpicaFromTareas } from "../tareas/epicas.controllers.js";

const prisma = new PrismaClient();

export async function listMobileProyectos(request, reply) {
  const user = request.user;
  
  if (!user || !user.empleadoId) {
    return reply.unauthorized("Solo empleados pueden ver proyectos");
  }

  // Proyectos donde el empleado es miembro y esta activo
  const miembros = await prisma.proyectoMiembro.findMany({
    where: {
      empleado_id: user.empleadoId,
      proyecto: {
        empresa_id: user.empresa.id,
        eliminado: false,
      }
    },
    include: {
      proyecto: true
    }
  });

  const proyectos = miembros.map(m => m.proyecto);
  return reply.send({ ok: true, proyectos });
}

export async function listMobileTareas(request, reply) {
  const user = request.user;
  const { proyectoId } = request.params;

  if (!user || !user.empleadoId) return reply.unauthorized();

  // Tareas y subtareas asignadas al empleado en ese proyecto
  const tareas = await prisma.tarea.findMany({
    where: {
      proyecto_id: proyectoId,
      eliminado: false,
      OR: [
        { responsable_id: user.empleadoId },
        { 
          detalles: { 
            some: { responsable_id: user.empleadoId, eliminado: false } 
          } 
        }
      ]
    },
    include: {
      epica: { select: { nombre: true } },
      detalles: {
        where: { responsable_id: user.empleadoId, eliminado: false }
      }
    },
    orderBy: { orden: 'asc' }
  });

  return reply.send({ ok: true, tareas });
}

export async function startMobileTarea(request, reply) {
  const user = request.user;
  const { id } = request.params;
  const { tipo } = request.body || {}; // "TAREA" o "SUBTAREA"

  if (tipo === "SUBTAREA") {
    const subt = await prisma.tareaDetalle.findUnique({ where: { id } });
    if (!subt) return reply.notFound("Subtarea no encontrada");
    
    await prisma.tareaDetalle.update({
      where: { id },
      data: {
        estado: "en_progreso",
        fecha_inicio_real: subt.fecha_inicio_real || new Date(),
        avance: subt.avance > 0 ? subt.avance : 5
      }
    });

    const tareaUpdated = await recomputeTareaFromDetalles(prisma, subt.tarea_id);
    if (tareaUpdated?.epica_id) await recomputeEpicaFromTareas(prisma, tareaUpdated.epica_id);

  } else {
    // Es Tarea
    const t = await prisma.tarea.findUnique({ where: { id } });
    if (!t) return reply.notFound("Tarea no encontrada");

    const updated = await prisma.tarea.update({
      where: { id },
      data: {
        estado: "en_progreso",
        fecha_inicio_real: t.fecha_inicio_real || new Date(),
        avance: t.avance > 0 ? t.avance : 5
      }
    });

    if (updated.epica_id) await recomputeEpicaFromTareas(prisma, updated.epica_id);
  }

  return reply.send({ ok: true, msg: "Iniciada correctamente" });
}

export async function finishMobileTarea(request, reply) {
  const parts = request.parts(); // fastify-multipart
  let fields = {};
  let uploadUrls = [];

  for await (const part of parts) {
    if (part.type === "file") {
      const ext = path.extname(part.filename);
      const rand = crypto.randomBytes(8).toString("hex");
      const savedName = `ev_${rand}${ext}`;
      const savePath = path.resolve(process.cwd(), "uploads", savedName);
      
      await pipeline(part.file, fs.createWriteStream(savePath));
      uploadUrls.push(`/api/uploads/${savedName}`);
    } else {
      fields[part.fieldname] = part.value;
    }
  }

  const { id } = request.params;
  const { tipo, comentario } = fields; // tipo = "TAREA" o "SUBTAREA"

  if (uploadUrls.length === 0) {
    return reply.badRequest("Se requiere subir al menos una foto de evidencia");
  }

  // Insertar en TareaEvidencia y cambiar estado a "en_revision"
  if (tipo === "SUBTAREA") {
    const subt = await prisma.tareaDetalle.findUnique({ where: { id } });
    if (!subt) return reply.notFound();

    await prisma.$transaction(async (tx) => {
      for (const url of uploadUrls) {
        await tx.tareaEvidencia.create({
          data: {
            subtarea_id: id,
            tarea_id: subt.tarea_id,
            archivo_url: url,
            comentario: comentario || null
          }
        });
      }
      await tx.tareaDetalle.update({
        where: { id },
        data: {
          estado: "en_revision",
          fecha_fin_real: new Date() // Tentativo, si el jefe aprueba, queda.
        }
      });
      const tUpd = await recomputeTareaFromDetalles(tx, subt.tarea_id);
      if (tUpd?.epica_id) await recomputeEpicaFromTareas(tx, tUpd.epica_id);
    });
  } else {
    // TAREA
    const t = await prisma.tarea.findUnique({ where: { id } });
    if (!t) return reply.notFound();

    await prisma.$transaction(async (tx) => {
      for (const url of uploadUrls) {
        await tx.tareaEvidencia.create({
          data: {
            tarea_id: id,
            archivo_url: url,
            comentario: comentario || null
          }
        });
      }
      await tx.tarea.update({
        where: { id },
        data: {
          estado: "en_revision",
          fecha_fin_real: new Date()
        }
      });
      if (t.epica_id) await recomputeEpicaFromTareas(tx, t.epica_id);
    });
  }

  return reply.send({ ok: true, msg: "Evidencia enviada a revisión" });
}

export async function listMobileEpicas(request, reply) {
  const { proyectoId } = request.params;
  const rows = await prisma.epica.findMany({
    where: { proyecto_id: proyectoId, eliminado: false },
    orderBy: { nombre: "asc" },
  });
  return reply.send({ ok: true, rows });
}

export async function createMobileEpica(request, reply) {
  const { proyectoId } = request.params;
  const { nombre, descripcion } = request.body || {};
  if (!nombre) return reply.badRequest("Nombre es obligatorio");

  const row = await prisma.epica.create({
    data: {
      proyecto_id: proyectoId,
      nombre: nombre.trim(),
      descripcion: descripcion?.trim() || null,
      estado: "pendiente",
      avance: 0,
      source: "MOBILE",
    },
  });
  return reply.send({ ok: true, row });
}

export async function createMobileTarea(request, reply) {
  const user = request.user;
  const { proyectoId } = request.params;
  const { nombre, descripcion, epica_id, fecha_inicio_plan, dias_plan } = request.body || {};

  if (!nombre || !epica_id) return reply.badRequest("Nombre y Epica son obligatorios");

  // Fechas por defecto si no vienen
  const fip = fecha_inicio_plan ? new Date(fecha_inicio_plan) : new Date();
  const dp = parseInt(dias_plan) || 1;
  const ffp = new Date(fip.getTime() + (dp - 1) * 24 * 60 * 60 * 1000);

  const row = await prisma.tarea.create({
    data: {
      proyecto_id: proyectoId,
      epica_id,
      nombre: nombre.trim(),
      descripcion: descripcion?.trim() || null,
      responsable_id: user.empleadoId,
      estado: "pendiente",
      avance: 0,
      fecha_inicio_plan: fip,
      fecha_fin_plan: ffp,
      dias_plan: dp,
      source: "MOBILE",
    },
  });

  await recomputeEpicaFromTareas(prisma, epica_id);
  return reply.send({ ok: true, row });
}

export async function createMobileSubtarea(request, reply) {
  const user = request.user;
  const { tareaId } = request.params;
  const { titulo, descripcion, fecha_inicio_plan, dias_plan } = request.body || {};

  if (!titulo) return reply.badRequest("Titulo es obligatorio");

  const t = await prisma.tarea.findUnique({ where: { id: tareaId } });
  if (!t) return reply.notFound("Tarea no encontrada");

  const fip = fecha_inicio_plan ? new Date(fecha_inicio_plan) : new Date();
  const dp = parseInt(dias_plan) || 1;
  const ffp = new Date(fip.getTime() + (dp - 1) * 24 * 60 * 60 * 1000);

  const row = await prisma.tareaDetalle.create({
    data: {
      tarea_id: tareaId,
      titulo: titulo.trim(),
      descripcion: descripcion?.trim() || null,
      responsable_id: user.empleadoId,
      estado: "pendiente",
      avance: 0,
      fecha_inicio_plan: fip,
      fecha_fin_plan: ffp,
      dias_plan: dp,
    },
  });

  const tUpd = await recomputeTareaFromDetalles(prisma, tareaId);
  if (tUpd?.epica_id) await recomputeEpicaFromTareas(prisma, tUpd.epica_id);

  return reply.send({ ok: true, row });
}
