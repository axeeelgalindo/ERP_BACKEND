import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const c = await prisma.compra.findFirst({
    where: { 
        empresa_id: 'cmmdikurc0000v8rcwn04dg2d', 
        proyecto_id: null,
        eliminado: false 
    },
    select: { id: true, numero: true, total: true }
  });
  console.log('Compra sin proyecto:', c);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
