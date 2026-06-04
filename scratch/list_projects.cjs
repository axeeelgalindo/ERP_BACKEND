const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.proyecto.findMany({
    where: { eliminado: false }
  });
  console.log("PROJECTS IN DB:", projects.map(p => ({ id: p.id, nombre: p.nombre, estado: p.estado })));
}

main().finally(() => prisma.$disconnect());
