import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const v = await prisma.venta.findFirst({
    where: { ordenVenta: { proyecto_id: 'cmmxwe2gt0004v8zgjnv81nqf' }, eliminado: false },
    select: { id: true, numero: true }
  });
  console.log('Venta del proyecto:', v);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
