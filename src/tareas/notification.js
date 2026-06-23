import { PrismaClient } from "@prisma/client";
import { sendEmail } from "../lib/mail.js";

const prisma = new PrismaClient();

/**
 * Notifica a un empleado sobre la asignación de una tarea o subtarea por correo.
 * @param {Object} options
 * @param {string} options.tareaId ID de la tarea o subtarea
 * @param {string} options.responsableId ID del empleado asignado
 * @param {boolean} options.isSubtask Indica si es una subtarea (TareaDetalle)
 */
export async function notifyTaskAssignment({ tareaId, responsableId, isSubtask = false }) {
  if (!responsableId) return;

  try {
    // 1. Fetch employee and their associated user details
    const empleado = await prisma.empleado.findFirst({
      where: { id: responsableId, eliminado: false },
      include: {
        usuario: {
          select: { nombre: true, correo: true }
        }
      }
    });

    if (!empleado || !empleado.usuario || !empleado.usuario.correo) {
      console.log(`[Mail] No user or email found for employee ID: ${responsableId}`);
      return;
    }

    const emailTo = empleado.usuario.correo;
    const nombreEmpleado = empleado.usuario.nombre;

    // 2. Fetch task/subtask details
    let tareaNombre = "";
    let tareaDescripcion = "";
    let fechaInicio = "";
    let fechaFin = "";
    let proyectoNombre = "No asociado";
    let proyectoId = "";
    let prioridadVal = 2;

    if (isSubtask) {
      const subtask = await prisma.tareaDetalle.findFirst({
        where: { id: tareaId },
        include: {
          tarea: {
            include: {
              proyecto: { select: { id: true, nombre: true } }
            }
          }
        }
      });
      if (!subtask) return;
      tareaNombre = subtask.titulo;
      tareaDescripcion = subtask.descripcion || "Sin descripción";
      fechaInicio = subtask.fecha_inicio_plan ? new Date(subtask.fecha_inicio_plan).toLocaleDateString("es-CL") : "No definida";
      fechaFin = subtask.fecha_fin_plan ? new Date(subtask.fecha_fin_plan).toLocaleDateString("es-CL") : "No definida";
      if (subtask.tarea && subtask.tarea.proyecto) {
        proyectoNombre = subtask.tarea.proyecto.nombre;
        proyectoId = subtask.tarea.proyecto.id;
      }
      if (subtask.tarea) {
        const parentTask = await prisma.tarea.findFirst({
          where: { id: subtask.tarea.id },
          select: { prioridad: true }
        });
        prioridadVal = parentTask?.prioridad ?? 2;
      }
    } else {
      const task = await prisma.tarea.findFirst({
        where: { id: tareaId },
        include: {
          proyecto: { select: { id: true, nombre: true } }
        }
      });
      if (!task) return;
      tareaNombre = task.nombre;
      tareaDescripcion = task.descripcion || "Sin descripción";
      fechaInicio = task.fecha_inicio_plan ? new Date(task.fecha_inicio_plan).toLocaleDateString("es-CL") : "No definida";
      fechaFin = task.fecha_fin_plan ? new Date(task.fecha_fin_plan).toLocaleDateString("es-CL") : "No definida";
      if (task.proyecto) {
        proyectoNombre = task.proyecto.nombre;
        proyectoId = task.proyecto.id;
      }
      prioridadVal = task.prioridad ?? 2;
    }

    const subject = `Nueva asignación: ${tareaNombre}`;
    const textContent = `Hola ${nombreEmpleado},\n\nSe te ha asignado una nueva actividad en el sistema ERP.\n\nDetalles:\n- Actividad: ${tareaNombre}\n- Descripción: ${tareaDescripcion}\n- Proyecto: ${proyectoNombre}\n- Fecha de Inicio Planificada: ${fechaInicio}\n- Fecha de Término Planificada: ${fechaFin}\n\nSaludos,\nEquipo ERP`;

    const frontendUrl = process.env.FRONTEND_URL || "https://erp-orcin-ten.vercel.app";
    let linkUrl = `${frontendUrl}/kanban`;
    if (proyectoId) {
      linkUrl = `${frontendUrl}/proyectos/${proyectoId}`;
    }

    let prioridadTexto = "Prioridad Media";
    let prioridadBadgeStyle = "background-color: #dbeafe; color: #1e40af;";
    if (prioridadVal === 1) {
      prioridadTexto = "Prioridad Baja";
      prioridadBadgeStyle = "background-color: #d1fae5; color: #065f46;";
    } else if (prioridadVal === 2) {
      prioridadTexto = "Prioridad Media";
      prioridadBadgeStyle = "background-color: #dbeafe; color: #1e40af;";
    } else if (prioridadVal >= 3) {
      prioridadTexto = "Prioridad Alta";
      prioridadBadgeStyle = "background-color: #fee2e2; color: #991b1b;";
    }

    const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8"/>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <title>Blue Ingeniería ERP - Nueva Tarea</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f7fafc; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
<table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 auto; background-color: #ffffff; border-collapse: collapse; box-shadow: 0 1px 3px rgba(0,0,0,0.1); font-family: 'Inter', sans-serif;">
    <!-- Top Accent Bar -->
    <tr>
        <td style="padding: 0; height: 6px; font-size: 0; line-height: 0;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; height: 6px;">
                <tr>
                    <td width="50%" style="background-color: #00658b; height: 6px;"></td>
                    <td width="50%" style="background-color: #66c9fd; height: 6px;"></td>
                </tr>
            </table>
        </td>
    </tr>

    <!-- Header -->
    <tr>
        <td style="background-color: #00274e; padding: 24px;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <tr>
                    <td style="vertical-align: middle; text-align: left;">
                        <img alt="Logo" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDzOs9MU69iyCGdUJwdE8Nx0MAdWvAKyB0JrCT7WQ0rSKk0FVMWiwMqb7KevJZmMTMuwgAc77gRizJM4smZ4qVPW36Pqiv03E7xB5ncy4_lf8ytR4jU5asWACqQQGxQv5sieGyCF8hQcrlKA27fByra8OoIBJBiD0RfGG0qKWB-EYJn1eocisfjBl1FtmP37XZ9cbv5_We4TdaCRBm2ozQyf-5ppYNP4t2Ku8MaHS9Hp5TsAGlELSiuGx3TRIzbHvPtGwttTjWwKg4" height="40" style="display: block; border: 0; height: 40px; width: auto;"/>
                    </td>
                    <td align="right" style="vertical-align: middle; text-align: right; color: #ffffff; font-family: 'Inter', sans-serif;">
                        <div style="font-size: 20px; font-weight: bold; line-height: 1.2;">Sistema ERP</div>
                    </td>
                </tr>
            </table>
        </td>
    </tr>

    <!-- Content Canvas -->
    <tr>
        <td style="padding: 24px; background-color: #f7fafc;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                <!-- Welcome Section -->
                <tr>
                    <td style="padding-bottom: 24px;">
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                            <tr>
                                <td style="vertical-align: middle; font-size: 22px; font-weight: bold; color: #00274e; padding-bottom: 12px;">
                                    🔔 Nueva actividad asignada
                                </td>
                            </tr>
                            <tr>
                                <td style="font-size: 16px; color: #181c1e; padding-bottom: 8px; font-family: 'Inter', sans-serif;">
                                    Hola <strong style="color: #00274e;">${nombreEmpleado}</strong>,
                                </td>
                            </tr>
                            <tr>
                                <td style="font-size: 14px; line-height: 1.5; color: #43474f;">
                                    Se te ha asignado una nueva actividad en el sistema ERP. A continuación se presentan los detalles técnicos de la tarea para tu seguimiento inmediato.
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>

                <!-- Data Card -->
                <tr>
                    <td style="background-color: #ffffff; border: 2px solid #e5e9eb; border-radius: 12px; padding: 24px; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                            <!-- Card Header -->
                            <tr>
                                <td style="border-bottom: 1px solid #ebeef0; padding-bottom: 16px;">
                                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                                        <tr>
                                            <td style="vertical-align: top;">
                                                <span style="font-size: 11px; text-transform: uppercase; font-weight: bold; color: #00658b; letter-spacing: 0.05em; display: block; margin-bottom: 6px;">Tipo de actividad</span>
                                                <table border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                                                    <tr>
                                                        
                                                        <td style="vertical-align: middle;">
                                                            <span style="font-size: 18px; font-weight: bold; color: #00274e;">${tareaNombre}</span>
                                                        </td>
                                                    </tr>
                                                </table>
                                            </td>
                                            <td align="right" style="vertical-align: top; padding-left: 12px;">
                                                <span style="font-size: 11px; text-transform: uppercase; font-weight: bold; color: #737780; letter-spacing: 0.05em; display: block; margin-bottom: 6px;">Proyecto</span>
                                                <span style="font-size: 13px; font-weight: bold; color: #181c1e;">${proyectoNombre}</span>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>

                            <!-- Tech Specs Table -->
                            <tr>
                                <td style="padding-top: 16px;">
                                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                                        <tr>
                                            <td style="padding: 10px 0; border-bottom: 1px solid #f1f4f6; font-size: 12px; font-weight: bold; color: #00658b; text-transform: uppercase; letter-spacing: 0.05em;">Descripción</td>
                                            <td align="right" style="padding: 10px 0; border-bottom: 1px solid #f1f4f6; font-size: 14px; color: #43474f; max-width: 60%;">${tareaDescripcion}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 10px 0; border-bottom: 1px solid #f1f4f6; font-size: 12px; font-weight: bold; color: #00658b; text-transform: uppercase; letter-spacing: 0.05em;">Fecha de Inicio</td>
                                            <td align="right" style="padding: 10px 0; border-bottom: 1px solid #f1f4f6; font-size: 14px; color: #181c1e;">
                                                📅 <span style="font-family: monospace; font-weight: bold;">${fechaInicio}</span>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 10px 0; font-size: 12px; font-weight: bold; color: #00658b; text-transform: uppercase; letter-spacing: 0.05em;">Fecha de Término</td>
                                            <td align="right" style="padding: 10px 0; font-size: 14px; color: #181c1e;">
                                                📅 <span style="font-family: monospace; font-weight: bold;">${fechaFin}</span>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>

                <!-- Call to Action -->
                <tr>
                    <td style="padding: 24px 0 8px 0; text-align: center;">
                        <table align="center" border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                            <tr>
                                <td align="center">
                                    <a href="${linkUrl}" target="_blank" style="background-color: #00274e; color: #ffffff; font-size: 15px; font-weight: bold; text-decoration: none; padding: 14px 36px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 6px rgba(0,39,78,0.15);">
                                        Ver en ERP ↗
                                    </a>
                                </td>
                            </tr>
                            <tr>
                                <td style="font-size: 13px; color: #43474f; text-align: center; padding-top: 16px; padding-left: 20px; padding-right: 20px; line-height: 1.4;">
                                    Por favor, inicia sesión en el ERP para ver más detalles y actualizar el estado de tus tareas.
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </td>
    </tr>

    <!-- Footer -->
    <tr>
        <td style="background-color: #f1f4f6; border-top: 1px solid #c3c6d0; padding: 32px 24px;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; border-top: 1px solid #e0e3e5; padding-top: 24px; margin-top: 16px;">
                <tr>
                    <td align="center" style="font-size: 12px; color: #737780; padding-top: 16px;">
                        <div style="font-size: 11px; font-weight: bold; color: #43474f; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 4px;">BLUE INGENIERÍA | DEPARTAMENTO TÉCNICO</div>
                        <div>© 2026 Blue Ingeniería. Todos los derechos reservados.</div>
                        <div style="padding-top: 16px;">
                            <table align="center" border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse; border: 1px solid #737780; border-radius: 9999px; background-color: #ebeef0;">
                                <tr>
                                    <td style="padding: 4px 12px; font-size: 9px; font-weight: bold; color: #43474f; text-transform: uppercase; letter-spacing: 0.05em;">
                                        🛡️ CORREO DEL SISTEMA AUTORIZADO
                                    </td>
                                </tr>
                            </table>
                        </div>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>
</body>
</html>`;

    // Enviar el correo de forma asíncrona
    sendEmail({
      to: emailTo,
      subject,
      text: textContent,
      html: htmlContent
    }).catch(err => {
      console.error("[Mail] Failed to send email:", err);
    });

  } catch (error) {
    console.error("[Mail] Error preparing task assignment notification:", error);
  }
}
