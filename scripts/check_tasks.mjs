import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const projectId = "cmn7u1axq000dv8w045p5ltqy";
  const tasks = await prisma.tarea.findMany({
    where: { proyecto_id: projectId, eliminado: false },
    select: { id: true, nombre: true, epica_id: true, avance: true }
  });
  console.log("Total tareas:", tasks.length);
  const withoutEpic = tasks.filter(t => !t.epica_id);
  console.log("Tareas sin épica:", withoutEpic.length);
  console.log(withoutEpic.map(t => `${t.nombre} (Avance: ${t.avance}%)`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
