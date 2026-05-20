import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import fs from "fs";
import path from "path";
import util from "util";
import { pipeline } from "stream";

const pump = util.promisify(pipeline);
const prisma = new PrismaClient();

const getUploadPath = (empleadoNombre) => {
  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const normalizedName = String(empleadoNombre).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
  const finalPath = path.join(uploadsRoot, "archivos", normalizedName);
  if (!fs.existsSync(finalPath)) {
    fs.mkdirSync(finalPath, { recursive: true });
  }
  return { finalPath, normalizedName };
};

export const listDocumentos = async (request, reply) => {
  const { id } = request.params;
  const scope = resolveScope(request);

  const empleado = await prisma.empleado.findUnique({
    where: { id },
    include: { usuario: { select: { empresa_id: true } } }
  });

  if (!empleado) return reply.notFound("Empleado no encontrado");
  if (!scope.isMaster && empleado?.usuario?.empresa_id !== scope.empresaId) {
    return reply.forbidden("No autorizado");
  }

  const docs = await prisma.empleadoDocumento.findMany({
    where: { empleado_id: id },
    orderBy: { creado_en: 'asc' }
  });

  return reply.send(docs);
};

export const createCarpeta = async (request, reply) => {
  const { id } = request.params;
  const { nombre, parent_id } = request.body;
  const scope = resolveScope(request);

  const empleado = await prisma.empleado.findUnique({
    where: { id },
    include: { usuario: { select: { empresa_id: true } } }
  });

  if (!empleado) return reply.notFound("Empleado no encontrado");
  if (!scope.isMaster && empleado?.usuario?.empresa_id !== scope.empresaId) {
    return reply.forbidden("No autorizado");
  }

  const carpeta = await prisma.empleadoDocumento.create({
    data: {
      empleado_id: id,
      nombre,
      es_carpeta: true,
      parent_id: parent_id || null,
      subido_por: request.user?.nombre || request.user?.name || request.session?.user?.name || "Administrador",
    }
  });

  return reply.send(carpeta);
};

export const uploadDocumento = async (request, reply) => {
  const { id } = request.params;
  const scope = resolveScope(request);

  const empleado = await prisma.empleado.findUnique({
    where: { id },
    include: { usuario: { select: { empresa_id: true, nombre: true } } }
  });

  if (!empleado) return reply.notFound("Empleado no encontrado");
  if (!scope.isMaster && empleado?.usuario?.empresa_id !== scope.empresaId) {
    return reply.forbidden("No autorizado");
  }

  const parts = request.parts();
  let parent_id = null;
  const uploadedFiles = [];

  const empleadoNombre = empleado?.usuario?.nombre || `empleado_${id}`;
  const { finalPath, normalizedName } = getUploadPath(empleadoNombre);

  for await (const part of parts) {
    if (part.type === 'file') {
      const filename = `${Date.now()}_${part.filename.replace(/[^a-zA-Z0-9_.-]/g, '')}`;
      const filePath = path.join(finalPath, filename);
      
      await pump(part.file, fs.createWriteStream(filePath));
      const stats = fs.statSync(filePath);
      const url = `/api/uploads/archivos/${normalizedName}/${filename}`;

      const doc = await prisma.empleadoDocumento.create({
        data: {
          empleado_id: id,
          nombre: part.filename,
          es_carpeta: false,
          url,
          tamano: `${(stats.size / 1024).toFixed(1)} KB`,
          parent_id: parent_id || null,
          subido_por: request.user?.nombre || request.user?.name || request.session?.user?.name || "Usuario"
        }
      });
      uploadedFiles.push(doc);
    } else {
      if (part.fieldname === 'parent_id') {
        parent_id = part.value === 'null' || !part.value ? null : part.value;
      }
    }
  }

  return reply.send({ success: true, files: uploadedFiles });
};

export const deleteDocumento = async (request, reply) => {
  const { docId } = request.params;
  const scope = resolveScope(request);

  const doc = await prisma.empleadoDocumento.findUnique({
    where: { id: docId },
    include: { empleado: { include: { usuario: { select: { empresa_id: true } } } } }
  });

  if (!doc) return reply.notFound("Documento no encontrado");
  if (!scope.isMaster && doc.empleado?.usuario?.empresa_id !== scope.empresaId) {
    return reply.forbidden("No autorizado");
  }

  // Eliminar físicamente
  if (doc.es_carpeta) {
    // Buscar todos los hijos (archivos) que están dentro de esta carpeta
    const children = await prisma.empleadoDocumento.findMany({
      where: { parent_id: docId }
    });
    for (const child of children) {
      if (!child.es_carpeta && child.url) {
        const physicalRelative = child.url.replace('/api/uploads/', '');
        const physicalPath = path.resolve(process.cwd(), 'uploads', physicalRelative);
        if (fs.existsSync(physicalPath)) fs.unlinkSync(physicalPath);
      }
    }
  } else if (doc.url) {
    // Si es un solo archivo
    const physicalRelative = doc.url.replace('/api/uploads/', '');
    const physicalPath = path.resolve(process.cwd(), 'uploads', physicalRelative);
    if (fs.existsSync(physicalPath)) {
      try {
        fs.unlinkSync(physicalPath);
      } catch (err) {
        console.error("Error al eliminar archivo físico:", err);
      }
    }
  }

  // Borrado en cascada configurado en Prisma para los hijos
  await prisma.empleadoDocumento.delete({ where: { id: docId } });
  
  return reply.send({ success: true, msg: "Eliminado correctamente" });
};
