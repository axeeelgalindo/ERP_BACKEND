import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const p = await prisma.proyecto.findUnique({
    where: { id: 'cmmxwe2gt0004v8zgjnv81nqf' },
    select: { presupuesto: true, nombre: true }
  });
  console.log('Proyecto:', p);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
