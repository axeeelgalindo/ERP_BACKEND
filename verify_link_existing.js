import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const proyectoId = 'cmmxwe2gt0004v8zgjnv81nqf';
  const ventaId = 'cmmdj1fkw0027v8j83mpe6u8u';
  const empresaId = 'cmmdikurc0000v8rcwn04dg2d';

  // Find a purchase with total > 0 and no project
  const c = await prisma.compra.findFirst({
    where: { empresa_id: empresaId, proyecto_id: null, eliminado: false },
    select: { id: true, total: true, tipo_doc: true }
  });

  if (!c) {
    console.log('No se encontró compra sin proyecto para probar.');
    return;
  }

  console.log('Compra encontrada para vincular:', c);

  // Simulate the new setCompraCosteos logic
  await prisma.$transaction(async (tx) => {
      // 1) Link
      await tx.compraCosteo.create({
          data: {
              empresa_id: empresaId,
              compra_id: c.id,
              venta_id: ventaId,
              monto: c.total
          }
      });

      // 2) Sync logic
      const v = await tx.venta.findUnique({
          where: { id: ventaId },
          include: { ordenVenta: true }
      });
      const pid = v?.ordenVenta?.proyecto_id;
      if (pid) {
          await tx.compra.update({
              where: { id: c.id },
              data: { proyecto_id: pid, destino: 'PROYECTO' }
          });
          console.log('Vinculación exitosa en DB. Proyecto ID:', pid);
      }
  });

  // Final check of the KPI calculation logic
  const compras = await prisma.compra.findMany({
    where: { proyecto_id: proyectoId, eliminado: false }
  });

  const pptoCalculado = compras.reduce((acc, c) => {
    const td = Number(c.tipo_doc);
    if ([33, 34, 39, 41, 46, 56, 69].includes(td)) return acc + (c.total || 0);
    if (td === 61) return acc - (c.total || 0);
    return acc;
  }, 0);

  console.log('Ppto Consumido del proyecto ahora:', pptoCalculado);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
