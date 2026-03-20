import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const p = await prisma.proyecto.findUnique({
    where: { id: 'cmmxwe2gt0004v8zgjnv81nqf' },
    select: { empresa_id: true }
  });
  console.log('Empresa ID del proyecto:', p?.empresa_id);

  const prov = await prisma.proveedor.findFirst({
    where: { empresa_id: p?.empresa_id },
    select: { id: true, nombre: true }
  });
  console.log('Proveedor de esa empresa:', prov);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
