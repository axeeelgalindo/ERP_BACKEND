// src/services/auditLog.service.js
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Registra una acción en el historial de auditoría.
 *
 * @param {Object} params
 * @param {string|null} params.empresaId   ID de empresa (o null si aplica global)
 * @param {string|null} params.usuarioId   ID del usuario que ejecutó la acción
 * @param {string} params.entidad          Nombre de la entidad: "Proyecto", "Tarea", "Rendicion", "Venta", etc.
 * @param {string} params.registroId       ID del registro afectado (ej: id de la rendición, venta, etc.)
 * @param {string} params.accion           Tipo de acción: "CREATE", "UPDATE", "DELETE",
 *                                         "CAMBIO_ESTADO", "LOGIN", "CREATE_DESDE_COTIZACION", etc.
 * @param {object|null} params.detalles    Objeto JSON con info adicional (antes/después, campos cambiados, etc.)
 * @param {string|null} params.ip          IP del cliente (request.ip)
 * @param {string|null} params.userAgent   User-Agent del cliente
 */
export async function registrarAuditLog({
  empresaId = null,
  usuarioId = null,
  entidad,
  registroId,
  accion,
  detalles = null,
  ip = null,
  userAgent = null,
}) {
  try {
    await prisma.auditLog.create({
      data: {
        empresa_id: empresaId,
        usuario_id: usuarioId,
        entidad,
        registro_id: registroId,
        accion,
        detalles,
        ip,
        user_agent: userAgent,
      },
    });
  } catch (err) {
    // Nunca romper la request por un problema de log
    console.error('Error registrando AuditLog:', err);
  }
}
