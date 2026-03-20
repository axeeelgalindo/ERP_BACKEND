import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const v = await prisma.venta.findFirst({
    where: { ordenVenta: { proyecto_id: 'cmmxwe2gt0004v8zgjnv81nqf' }, eliminado: false },
    select: { id: true }
  });
  const c = await prisma.compra.findFirst({
    where: { empresa_id: 'cmmdikurc0000v8rcwn04dg2d', proyecto_id: null, eliminado: false },
    select: { id: true }
  });

  console.log('ID_VENTA:', v?.id);
  console.log('ID_COMPRA:', c?.id);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
