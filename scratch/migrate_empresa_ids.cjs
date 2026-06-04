const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Migrating Epicas...");
  const epicas = await prisma.epica.findMany({
    where: { empresa_id: null },
    include: { proyecto: true }
  });

  let epicasUpdated = 0;
  for (const ep of epicas) {
    if (ep.proyecto) {
      await prisma.epica.update({
        where: { id: ep.id },
        data: { empresa_id: ep.proyecto.empresa_id }
      });
      epicasUpdated++;
    }
  }
  console.log(`Updated ${epicasUpdated} Epicas.`);

  console.log("Migrating Tareas...");
  const tareas = await prisma.tarea.findMany({
    where: { empresa_id: null },
    include: { proyecto: true }
  });

  let tareasUpdated = 0;
  for (const t of tareas) {
    if (t.proyecto) {
      await prisma.tarea.update({
        where: { id: t.id },
        data: { empresa_id: t.proyecto.empresa_id }
      });
      tareasUpdated++;
    }
  }
  console.log(`Updated ${tareasUpdated} Tareas.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
