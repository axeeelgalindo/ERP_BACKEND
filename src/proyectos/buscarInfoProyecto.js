import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

/**
 * buscarInfoProyecto:
 * Trae TODO lo necesario para calcular el devengado de un proyecto:
 * - Proyecto (con epicas)
 * - Cotizacion ACEPTADA más reciente (con ventas y detalles de venta)
 * - Tareas (con detalles/subtareas)
 * - Compras (con proveedor)
 * - Rendiciones aprobadas
 * - Miembros del equipo (con HH)
 */
export async function buscarInfoProyecto(proyectoId) {
  const proyecto = await prisma.proyecto.findFirst({
    where: { id: proyectoId, eliminado: false },
    select: {
      id: true,
      nombre: true,
      estado: true,
      empresa_id: true,
      fecha_inicio_plan: true,
      fecha_fin_plan: true,
      fecha_inicio_real: true,
      fecha_fin_real: true,
      presupuesto: true,
      epicas: {
        where: { eliminado: false },
        select: {
          id: true, nombre: true, avance: true, estado: true,
          fecha_inicio_plan: true, fecha_fin_plan: true,
          fecha_inicio_real: true, fecha_fin_real: true,
          dias_plan: true,
        },
        orderBy: { orden: "asc" },
      },
    },
  });

  if (!proyecto) return null;

  // Cotizacion ACEPTADA más reciente vinculada al proyecto
  const cotizacion = await prisma.cotizacion.findFirst({
    where: { proyecto_id: proyectoId, eliminado: false, estado: "ACEPTADA" },
    orderBy: { fecha_documento: "desc" },
    select: {
      id: true, numero: true, subtotal: true, total: true,
      fecha_documento: true, estado: true,
      ventas: {
        where: { eliminado: false },
        select: {
          id: true, numero: true,
          utilidadObjetivoPct: true,
          utilidadObjetivoBase: true,
          detalles: {
            select: {
              id: true, descripcion: true, cantidad: true, total: true,
              costoTotal: true, ventaTotal: true, porcentajeUtilidad: true,
              modo: true,
            }
          }
        }
      }
    }
  });

  // Tareas del proyecto con sus subtareas
  const tareas = await prisma.tarea.findMany({
    where: { proyecto_id: proyectoId, eliminado: false },
    select: {
      id: true, nombre: true, jira_key: true, jira_tipo: true,
      estado: true, avance: true, epica_id: true,
      fecha_inicio_plan: true, fecha_fin_plan: true,
      fecha_inicio_real: true, fecha_fin_real: true,
      dias_plan: true, dias_reales: true,
      total_horas_plan: true, total_horas_reales: true,
      total_costo_plan: true, total_costo_real: true,
      detalles: {
        where: { eliminado: false },
        select: {
          id: true, titulo: true, estado: true, avance: true,
          fecha_inicio_plan: true, fecha_fin_plan: true,
          fecha_inicio_real: true, fecha_fin_real: true,
          horas_plan: true, horas_real: true,
          valor_hora: true, costo_plan: true, costo_real: true,
        }
      }
    },
    orderBy: [{ fecha_inicio_plan: "asc" }],
  });

  // Compras asociadas al proyecto
  const compras = await prisma.compra.findMany({
    where: { proyecto_id: proyectoId, eliminado: false },
    select: {
      id: true, numero: true, total: true, estado: true,
      tipo_doc: true, fecha_docto: true, factura_url: true,
      proveedor: { select: { nombre: true } },
    },
    orderBy: { id: "desc" },
  });

  // Rendiciones aprobadas
  const rendiciones = await prisma.rendicion.findMany({
    where: {
      proyecto_id: proyectoId,
      eliminado: false,
      estado: { in: ["aprobada", "pagada", "revisada"] }
    },
    select: { id: true, monto_total: true, estado: true }
  });

  // Miembros del equipo con HH
  const miembros = await prisma.proyectoMiembro.findMany({
    where: { proyecto_id: proyectoId },
    select: {
      rol: true,
      empleado: {
        select: {
          id: true, cargo: true, sueldo_base: true,
          usuario: { select: { nombre: true } },
          hhRegistros: {
            orderBy: [{ anio: "desc" }, { mes: "desc" }],
            take: 1,
            select: { costoHH: true, anio: true, mes: true }
          }
        }
      }
    }
  });

  return { proyecto, cotizacion, tareas, compras, rendiciones, miembros };
}
