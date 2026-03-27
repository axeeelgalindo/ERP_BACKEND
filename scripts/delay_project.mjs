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

  // Fechas PLANIFICADAS (originales)
  const START_PLAN = new Date("2026-01-05T08:00:00Z");
  const END_PLAN = new Date("2026-03-14T18:00:00Z");

  // Fechas REALES (con 2 semanas de atraso = 14 días)
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const DELAY = 14 * MS_PER_DAY;
  
  const START_REAL = new Date(START_PLAN.getTime() + DELAY);
  const END_REAL = new Date(END_PLAN.getTime() + DELAY);

  console.log("Simulando atraso de 2 semanas...");
  console.log("Plan:", START_PLAN.toISOString().split('T')[0], "a", END_PLAN.toISOString().split('T')[0]);
  console.log("Real:", START_REAL.toISOString().split('T')[0], "a", END_REAL.toISOString().split('T')[0]);

  // Actualizar Proyecto
  await prisma.proyecto.update({
    where: { id: projectId },
    data: {
      fecha_inicio_plan: START_PLAN,
      fecha_fin_plan: END_PLAN,
      fecha_inicio_real: START_REAL,
      fecha_fin_real: END_REAL,
      estado: "completado"
    }
  });

  const epicas = project.epicas;
  for (let i = 0; i < epicas.length; i++) {
    const epica = epicas[i];
    
    // Plan
    const eP_Start = new Date(START_PLAN.getTime() + (END_PLAN.getTime() - START_PLAN.getTime()) * (i / epicas.length));
    const eP_End = new Date(START_PLAN.getTime() + (END_PLAN.getTime() - START_PLAN.getTime()) * ((i + 1) / epicas.length));
    
    // Real (con delay)
    const eR_Start = new Date(eP_Start.getTime() + DELAY);
    const eR_End = new Date(eP_End.getTime() + DELAY);

    await prisma.epica.update({
      where: { id: epica.id },
      data: {
        fecha_inicio_plan: eP_Start, fecha_fin_plan: eP_End,
        fecha_inicio_real: eR_Start, fecha_fin_real: eR_End,
        avance: 100, estado: "completado"
      }
    });

    for (let j = 0; j < epica.tareas.length; j++) {
      const tarea = epica.tareas[j];
      
      const tP_Start = new Date(eP_Start.getTime() + (eP_End.getTime() - eP_Start.getTime()) * (j / epica.tareas.length));
      const tP_End = new Date(eP_Start.getTime() + (eP_End.getTime() - eP_Start.getTime()) * ((j + 1) / epica.tareas.length));
      
      const tR_Start = new Date(tP_Start.getTime() + DELAY);
      const tR_End = new Date(tP_End.getTime() + DELAY);

      await prisma.tarea.update({
        where: { id: tarea.id },
        data: {
          fecha_inicio_plan: tP_Start, fecha_fin_plan: tP_End,
          fecha_inicio_real: tR_Start, fecha_fin_real: tR_End,
          avance: 100, estado: "completado",
          dias_plan: Math.max(1, Math.floor((tP_End - tP_Start) / MS_PER_DAY))
        }
      });

      for (let k = 0; k < tarea.detalles.length; k++) {
        const det = tarea.detalles[k];
        const dP_Start = new Date(tP_Start.getTime() + (tP_End.getTime() - tP_Start.getTime()) * (k / tarea.detalles.length));
        const dP_End = new Date(tP_Start.getTime() + (tP_End.getTime() - tP_Start.getTime()) * ((k + 1) / tarea.detalles.length));
        
        const dR_Start = new Date(dP_Start.getTime() + DELAY);
        const dR_End = new Date(dP_End.getTime() + DELAY);

        await prisma.tareaDetalle.update({
          where: { id: det.id },
          data: {
            fecha_inicio_plan: dP_Start, fecha_fin_plan: dP_End,
            fecha_inicio_real: dR_Start, fecha_fin_real: dR_End,
            avance: 100, estado: "completado",
            dias_plan: Math.max(1, Math.floor((dP_End - dP_Start) / MS_PER_DAY))
          }
        });
      }
    }
  }
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
