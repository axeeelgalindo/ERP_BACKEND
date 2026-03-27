import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const projectId = "cmn7u1axq000dv8w045p5ltqy";
  const project = await prisma.proyecto.findUnique({
    where: { id: projectId },
    select: { id: true, nombre: true, presupuesto: true }
  });
  console.log("Proyecto:", project.nombre, "Presupuesto:", project.presupuesto);

  const tasks = await prisma.tarea.findMany({
    where: { proyecto_id: projectId, eliminado: false },
    select: { 
      id: true, nombre: true, 
      total_costo_plan: true, total_horas_plan: true, dias_plan: true,
      fecha_inicio_real: true, fecha_fin_real: true,
      avance: true,
      detalles: { select: { id: true, costo_plan: true, horas_plan: true, dias_plan: true, avance: true } }
    }
  });

  tasks.forEach(t => {
    console.log(`Tarea: ${t.nombre}`);
    console.log(`  Real Range: ${t.fecha_inicio_real} - ${t.fecha_fin_real}`);
    console.log(`  Avance: ${t.avance}%`);
    console.log(`  Costo Plan: ${t.total_costo_plan}, Horas Plan: ${t.total_horas_plan}, Dias Plan: ${t.dias_plan}`);
    t.detalles.forEach(d => {
      console.log(`    Subtarea: ${d.id} - Costo: ${d.costo_plan}, Avance: ${d.avance}%`);
    });
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
