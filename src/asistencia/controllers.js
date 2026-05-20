// src/asistencia/controllers.js
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";

const prisma = new PrismaClient();

/**
 * GET /api/asistencia
 * Query params:
 *   - fecha: YYYY-MM-DD (defaults to today)
 *   - q: text filter for employee name/email
 *   - cargo: text filter for employee cargo
 *   - estado: text filter for state (AUSENTE, PRESENTE, etc.)
 */
export const getAsistenciaDia = async (req, reply) => {
  try {
    const scope = resolveScope(req);
    const empresaId = scope.empresaId;

    if (!empresaId) {
      return reply.badRequest("Falta empresaId en el contexto");
    }

    const { fecha, q, cargo, estado } = req.query || {};

    // Default to today in YYYY-MM-DD
    let fechaStr = fecha;
    if (!fechaStr) {
      fechaStr = new Date().toISOString().split("T")[0];
    }

    const targetDate = new Date(`${fechaStr}T00:00:00.000Z`);

    // Fetch all active, non-deleted employees for this company
    const employees = await prisma.empleado.findMany({
      where: {
        eliminado: false,
        activo: true,
        usuario: {
          empresa_id: empresaId,
          eliminado: false,
          ...(q
            ? {
                OR: [
                  { nombre: { contains: q, mode: "insensitive" } },
                  { correo: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        ...(cargo
          ? {
              cargo: { contains: cargo, mode: "insensitive" },
            }
          : {}),
      },
      include: {
        usuario: {
          select: {
            nombre: true,
            correo: true,
          },
        },
      },
    });

    // Fetch attendance records for this date and company
    const attendanceRecords = await prisma.asistencia.findMany({
      where: {
        fecha: targetDate,
        empleado: {
          usuario: {
            empresa_id: empresaId,
          },
        },
      },
    });

    const recordMap = new Map(attendanceRecords.map((r) => [r.empleado_id, r]));

    const result = employees.map((emp) => {
      const record = recordMap.get(emp.id);
      return {
        id: record?.id || null,
        empleadoId: emp.id,
        nombre: emp.usuario?.nombre || "(Sin usuario)",
        correo: emp.usuario?.correo || "—",
        cargo: emp.cargo || "—",
        estado: record?.estado || "AUSENTE", // AUSENTE is the default
        observacion: record?.observacion || "",
        fecha: fechaStr,
      };
    });

    // Filter by estado if requested
    const finalResult = estado
      ? result.filter((r) => r.estado.toUpperCase() === estado.toUpperCase())
      : result;

    return finalResult;
  } catch (err) {
    req.log.error(err);
    return reply.internalServerError("Error al obtener la asistencia del día");
  }
};

/**
 * POST /api/asistencia
 * Body:
 *   - empleadoId: string
 *   - fecha: YYYY-MM-DD
 *   - estado: AUSENTE | PRESENTE | JUSTIFICADO | PERMISO
 *   - observacion: string (optional)
 */
export const upsertAsistencia = async (req, reply) => {
  try {
    const scope = resolveScope(req);
    const empresaId = scope.empresaId;

    if (!empresaId) {
      return reply.badRequest("Falta empresaId en el contexto");
    }

    const { empleadoId, fecha, estado, observacion } = req.body || {};

    if (!empleadoId || !fecha || !estado) {
      return reply.badRequest("Faltan campos obligatorios: empleadoId, fecha, estado");
    }

    const validStates = ["AUSENTE", "PRESENTE", "PERMISO", "OFICINA", "TALLER", "TERRENO", "LICENCIA_MEDICA", "VACACIONES"];
    if (!validStates.includes(estado.toUpperCase())) {
      return reply.badRequest("Estado inválido. Debe ser: AUSENTE, PRESENTE, PERMISO, OFICINA, TALLER, TERRENO, LICENCIA_MEDICA o VACACIONES");
    }

    const targetDate = new Date(`${fecha}T00:00:00.000Z`);

    // Verify employee belongs to this company and exists
    const emp = await prisma.empleado.findFirst({
      where: {
        id: empleadoId,
        eliminado: false,
        usuario: {
          empresa_id: empresaId,
        },
      },
    });

    if (!emp) {
      return reply.notFound("Empleado no encontrado o no pertenece a su empresa");
    }

    const record = await prisma.asistencia.upsert({
      where: {
        empleado_id_fecha: {
          empleado_id: empleadoId,
          fecha: targetDate,
        },
      },
      update: {
        estado: estado.toUpperCase(),
        observacion: observacion || null,
      },
      create: {
        empleado_id: empleadoId,
        fecha: targetDate,
        estado: estado.toUpperCase(),
        observacion: observacion || null,
      },
    });

    return record;
  } catch (err) {
    req.log.error(err);
    return reply.internalServerError("Error al registrar la asistencia");
  }
};

/**
 * GET /api/asistencia/mensual
 * Query params:
 *   - mes: number (1-12)
 *   - anio: number
 *   - q: text filter for employee name/email
 *   - cargo: text filter for employee cargo
 *   - estado: text filter (filters employees having at least one day with this state in the month)
 */
export const getAsistenciaMensual = async (req, reply) => {
  try {
    const scope = resolveScope(req);
    const empresaId = scope.empresaId;

    if (!empresaId) {
      return reply.badRequest("Falta empresaId en el contexto");
    }

    const { mes, anio, q, cargo, estado } = req.query || {};

    const targetMes = mes ? parseInt(mes, 10) : new Date().getMonth() + 1;
    const targetAnio = anio ? parseInt(anio, 10) : new Date().getFullYear();

    if (isNaN(targetMes) || targetMes < 1 || targetMes > 12) {
      return reply.badRequest("Mes inválido. Debe estar entre 1 y 12");
    }
    if (isNaN(targetAnio) || targetAnio < 1900 || targetAnio > 2100) {
      return reply.badRequest("Año inválido");
    }

    // Boundaries of the month in UTC to align with Date.Date database type
    const startDate = new Date(Date.UTC(targetAnio, targetMes - 1, 1));
    const endDate = new Date(Date.UTC(targetAnio, targetMes, 1));

    // Fetch active employees matching name/email/cargo filters
    const employees = await prisma.empleado.findMany({
      where: {
        eliminado: false,
        activo: true,
        usuario: {
          empresa_id: empresaId,
          eliminado: false,
          ...(q
            ? {
                OR: [
                  { nombre: { contains: q, mode: "insensitive" } },
                  { correo: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        ...(cargo
          ? {
              cargo: { contains: cargo, mode: "insensitive" },
            }
          : {}),
      },
      include: {
        usuario: {
          select: {
            nombre: true,
            correo: true,
          },
        },
      },
    });

    // Fetch all attendance records for the month and company
    const attendanceRecords = await prisma.asistencia.findMany({
      where: {
        fecha: {
          gte: startDate,
          lt: endDate,
        },
        empleado: {
          usuario: {
            empresa_id: empresaId,
          },
        },
      },
    });

    // Group attendance records by employee_id and date (YYYY-MM-DD)
    const recordMap = new Map();
    attendanceRecords.forEach((rec) => {
      if (!recordMap.has(rec.empleado_id)) {
        recordMap.set(rec.empleado_id, []);
      }
      recordMap.get(rec.empleado_id).push(rec);
    });

    // Build the grid list
    const result = employees.map((emp) => {
      const records = recordMap.get(emp.id) || [];
      const asistenciasObj = {};

      records.forEach((rec) => {
        // Format date strictly as YYYY-MM-DD
        const dateStr = rec.fecha.toISOString().split("T")[0];
        asistenciasObj[dateStr] = {
          id: rec.id,
          estado: rec.estado,
          observacion: rec.observacion || "",
        };
      });

      return {
        empleadoId: emp.id,
        nombre: emp.usuario?.nombre || "(Sin usuario)",
        correo: emp.usuario?.correo || "—",
        cargo: emp.cargo || "—",
        asistencias: asistenciasObj,
      };
    });

    // Filter by estado if requested (at least one day must match the requested status)
    const finalResult = estado
      ? result.filter((emp) => {
          return Object.values(emp.asistencias).some(
            (rec) => rec.estado.toUpperCase() === estado.toUpperCase()
          );
        })
      : result;

    return finalResult;
  } catch (err) {
    req.log.error(err);
    return reply.internalServerError("Error al obtener la asistencia mensual");
  }
};
