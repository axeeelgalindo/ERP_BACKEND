const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const epicasCount = await prisma.epica.count();
  const tareasCount = await prisma.tarea.count();
  console.log(`EPICAS IN DB: ${epicasCount}, TAREAS IN DB: ${tareasCount}`);
}

main().finally(() => prisma.$disconnect());
