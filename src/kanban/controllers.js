// backend/src/kanban/controllers.js
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";

const prisma = new PrismaClient();

/**
 * Obtener datos para el Tablero Kanban Global (Épicas, Tareas y Subtareas)
 */
export async function getKanbanData(request, reply) {
  const scope = resolveScope(request);
  const { proyecto_id, responsable_id, q, periodo = "semanal" } = request.query || {};

  const now = new Date();
  let dateRange = {};

  if (periodo === "semanal") {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    dateRange = { fecha_inicio_plan: { gte: start, lt: end } };
  } else if (periodo === "mensual") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    dateRange = { fecha_inicio_plan: { gte: start, lt: end } };
  } else if (periodo === "anual") {
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear() + 1, 0, 1);
    dateRange = { fecha_inicio_plan: { gte: start, lt: end } };
  }

  // Base 'where' filters
  const projectFilter = { empresa_id: scope.empresaId, eliminado: false };

  // 1. Fetch EPICAS
  // NOTA: Si se filtra por responsable_id, las épicas usualmente no se muestran porque no tienen responsable_id directo
  let epicas = [];
  if (!responsable_id) {
    epicas = await prisma.epica.findMany({
      where: {
        proyecto: projectFilter,
        ...(proyecto_id ? { proyecto_id } : {}),
        eliminado: false,
        ...(q ? { nombre: { contains: q, mode: "insensitive" } } : {}),
        ...dateRange,
      },
      include: { 
        proyecto: { select: { nombre: true } },
        responsable: { include: { usuario: { select: { nombre: true } } } }
      },
    });
  }

  // 2. Fetch TAREAS
  const tareas = await prisma.tarea.findMany({
    where: {
      proyecto: projectFilter,
      ...(proyecto_id ? { proyecto_id } : {}),
      ...(responsable_id ? { responsable_id } : {}),
      eliminado: false,
      ...(q ? { nombre: { contains: q, mode: "insensitive" } } : {}),
      ...dateRange,
    },
    include: {
      proyecto: { select: { nombre: true } },
      epica: { select: { nombre: true } },
      responsable: { include: { usuario: { select: { nombre: true } } } },
      evidencias: true,
    },
  });

  // 3. Fetch SUBTAREAS (TareaDetalle)
  const subtareas = await prisma.tareaDetalle.findMany({
    where: {
      tarea: {
        proyecto: projectFilter,
        ...(proyecto_id ? { proyecto_id } : {}),
      },
      ...(responsable_id ? { responsable_id } : {}),
      eliminado: false,
      ...(q ? { titulo: { contains: q, mode: "insensitive" } } : {}), // ✅ CORRECCIÓN: titulo en lugar de nombre
      ...dateRange,
    },
    include: {
      tarea: {
        include: {
          proyecto: { select: { nombre: true } },
        },
      },
      responsable: { include: { usuario: { select: { nombre: true } } } },
      evidencias: true,
    },
  });

  // NORMALIZACIÓN
  const normalizedItems = [
    ...epicas.map((e) => ({
      ...e,
      tipo: "EPICA",
      parent_name: e.proyecto?.nombre,
      responsable_nombre: e.responsable?.usuario?.nombre || "Sin Asignar",
    })),
    ...tareas.map((t) => ({
      ...t,
      tipo: "TAREA",
      parent_name: t.epica?.nombre || t.proyecto?.nombre,
      responsable_nombre: t.responsable?.usuario?.nombre || "Sin Asignar",
    })),
    ...subtareas.map((s) => ({
      ...s,
      tipo: "SUBTAREA",
      nombre: s.titulo, // ✅ Normalizamos titulo a nombre para la UI
      parent_name: s.tarea?.nombre,
      proyecto: s.tarea?.proyecto,
      responsable_nombre: s.responsable?.usuario?.nombre || "Sin Asignar",
    })),
  ];

  // Agrupar por columnas
  const columns = {
    "POR HACER": normalizedItems.filter((i) => i.estado === "pendiente"),
    "EN CURSO": normalizedItems.filter((i) => i.estado === "en_progreso"),
    "EN REVISIÓN": normalizedItems.filter((i) => i.estado === "en_revision"),
    "COMPLETADO": normalizedItems.filter((i) => ["completada", "finalizado"].includes(i.estado)),
  };

  // Estadísticas
  const total = normalizedItems.length;
  const critical = normalizedItems.filter((i) => i.prioridad === 1 || (i.dias_desviacion && i.dias_desviacion > 0)).length;
  const inProgress = columns["EN CURSO"].length;
  const efficiency = total > 0 ? Math.round((columns["COMPLETADO"].length / total) * 100) : 0;

  // Filtros (opciones)
  const [projectsList, employeesList] = await Promise.all([
    prisma.proyecto.findMany({
      where: projectFilter,
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    }),
    prisma.empleado.findMany({
      where: { usuario: { empresa_id: scope.empresaId }, eliminado: false },
      include: { usuario: { select: { nombre: true } } },
      orderBy: { usuario: { nombre: "asc" } },
    }),
  ]);

  return reply.send({
    ok: true,
    columns,
    stats: { total, critical, inProgress, efficiency },
    filters: {
      projects: projectsList,
      employees: employeesList.map((e) => ({
        id: e.id,
        nombre: e.usuario?.nombre || "Sin Nombre",
      })),
    },
  });
}
