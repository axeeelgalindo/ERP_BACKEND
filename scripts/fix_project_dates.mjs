import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const projectId = "cmn7u1axq000dv8w045p5ltqy";

async function main() {
  const project = await prisma.proyecto.findUnique({
    where: { id: projectId },
    include: {
      epicas: {
        where: { eliminado: false },
        include: {
          tareas: {
            where: { eliminado: false },
            include: {
              detalles: { where: { eliminado: false } }
            }
          }
        }
      }
    }
  });

  if (!project) {
    console.log("No se encontró el proyecto");
    return;
  }

  // Fechas solicitadas
  const START = new Date("2026-01-05T08:00:00Z");
  const END = new Date("2026-03-14T18:00:00Z");

  // Actualizar Proyecto
  await prisma.proyecto.update({
    where: { id: projectId },
    data: {
      fecha_inicio_plan: START,
      fecha_fin_plan: END,
      fecha_inicio_real: START,
      fecha_fin_real: END,
      estado: "completado"
    }
  });

  const epicas = project.epicas;
  for (let i = 0; i < epicas.length; i++) {
    const epica = epicas[i];
    const eStart = new Date(START.getTime() + (END.getTime() - START.getTime()) * (i / epicas.length));
    const eEnd = new Date(START.getTime() + (END.getTime() - START.getTime()) * ((i + 1) / epicas.length));
    
    await prisma.epica.update({
      where: { id: epica.id },
      data: {
        fecha_inicio_plan: eStart, fecha_fin_plan: eEnd,
        fecha_inicio_real: eStart, fecha_fin_real: eEnd,
        avance: 100, estado: "completado"
      }
    });

    for (let j = 0; j < epica.tareas.length; j++) {
      const tarea = epica.tareas[j];
      const tStart = new Date(eStart.getTime() + (eEnd.getTime() - eStart.getTime()) * (j / epica.tareas.length));
      const tEnd = new Date(eStart.getTime() + (eEnd.getTime() - eStart.getTime()) * ((j + 1) / epica.tareas.length));
      
      await prisma.tarea.update({
        where: { id: tarea.id },
        data: {
          fecha_inicio_plan: tStart, fecha_fin_plan: tEnd,
          fecha_inicio_real: tStart, fecha_fin_real: tEnd,
          avance: 100, estado: "completado",
          dias_plan: Math.max(1, Math.floor((tEnd - tStart) / 86400000))
        }
      });

      for (let k = 0; k < tarea.detalles.length; k++) {
        const det = tarea.detalles[k];
        const dStart = new Date(tStart.getTime() + (tEnd.getTime() - tStart.getTime()) * (k / tarea.detalles.length));
        const dEnd = new Date(tStart.getTime() + (tEnd.getTime() - tStart.getTime()) * ((k + 1) / tarea.detalles.length));
        
        await prisma.tareaDetalle.update({
          where: { id: det.id },
          data: {
            fecha_inicio_plan: dStart, fecha_fin_plan: dEnd,
            fecha_inicio_real: dStart, fecha_fin_real: dEnd,
            avance: 100, estado: "completado",
            dias_plan: Math.max(1, Math.floor((dEnd - dStart) / 86400000))
          }
        });
      }
    }
  }
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
