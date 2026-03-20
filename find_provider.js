import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const empresaId = 'cmmdikurc0000v8rcwn04dg2d';
  const p = await prisma.proveedor.findFirst({
    where: { empresa_id: empresaId, eliminado: false },
    select: { id: true, nombre: true }
  });
  console.log('Proveedor encontrado:', p);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
