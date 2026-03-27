import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const projectId = "cmn7u1axq000dv8w045p5ltqy";

async function main() {
  console.log("Iniciando simulación de término anticipado (CORREGIDO)...");
  
  const TODAY = new Date("2026-03-26T12:00:00Z");
  const START_PLAN = new Date("2026-01-05T08:00:00Z");
  const END_PLAN = new Date("2026-04-02T18:00:00Z");
  const START_REAL = new Date("2026-01-05T08:00:00Z");
  const END_REAL = TODAY;

  // 1. Proyecto (SIN campo 'avance')
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

  // 2. Epicas
  const epicas = await prisma.epica.findMany({ where: { proyecto_id: projectId, eliminado: false } });
  for (let i = 0; i < epicas.length; i++) {
    const e = epicas[i];
    const eR_Start = new Date(START_REAL.getTime() + (END_REAL.getTime() - START_REAL.getTime()) * (i / epicas.length));
    const eR_End = new Date(START_REAL.getTime() + (END_REAL.getTime() - START_REAL.getTime()) * ((i + 1) / epicas.length));
    
    await prisma.epica.update({
      where: { id: e.id },
      data: {
        fecha_inicio_real: eR_Start,
        fecha_fin_real: eR_End,
        avance: 100,
        estado: "completado"
      }
    });

    // 3. Tareas
    const tareas = await prisma.tarea.findMany({ where: { epica_id: e.id, eliminado: false } });
    for (let j = 0; j < tareas.length; j++) {
      const t = tareas[j];
      const tR_Start = new Date(eR_Start.getTime() + (eR_End.getTime() - eR_Start.getTime()) * (j / tareas.length));
      const tR_End = new Date(eR_Start.getTime() + (eR_End.getTime() - eR_Start.getTime()) * ((j + 1) / tareas.length));
      
      await prisma.tarea.update({
        where: { id: t.id },
        data: {
          fecha_inicio_real: tR_Start,
          fecha_fin_real: tR_End,
          avance: 100,
          estado: "completado"
        }
      });

      // 4. Subtareas
      const subtareas = await prisma.tareaDetalle.findMany({ where: { tarea_id: t.id, eliminado: false } });
      for (let k = 0; k < subtareas.length; k++) {
        const det = subtareas[k];
        const sR_Start = new Date(tR_Start.getTime() + (tR_End.getTime() - tR_Start.getTime()) * (k / subtareas.length));
        const sR_End = new Date(tR_Start.getTime() + (tR_End.getTime() - tR_Start.getTime()) * ((k + 1) / subtareas.length));
        
        await prisma.tareaDetalle.update({
          where: { id: det.id },
          data: {
            fecha_inicio_real: sR_Start,
            fecha_fin_real: sR_End,
            avance: 100,
            estado: "completado"
          }
        });
      }
    }
  }
  console.log("Simulación completada con éxito.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
