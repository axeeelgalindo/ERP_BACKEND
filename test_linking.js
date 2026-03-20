import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const compraId = 'cmmdj4cu2002iv8j891ezz17x1';
  const ventaId = 'cmmdj1fkw0027v8j83mpe66u8u';
  const empresaId = 'cmmdikurc0000v8rcwn04dg2d';

  console.log('--- START TEST LINKING ---');

  await prisma.$transaction(async (tx) => {
    // 1) Link Compra to Venta
    await tx.compraCosteo.deleteMany({ where: { compra_id: compraId } });
    await tx.compraCosteo.create({
      data: {
        empresa_id: empresaId,
        compra_id: compraId,
        venta_id: ventaId,
        monto: 219203
      }
    });

    // 2) The new logic from controllers.js
    const ventasConProyecto = await tx.venta.findMany({
      where: { id: { in: [ventaId] } },
      include: { ordenVenta: { select: { proyecto_id: true } } }
    });
    
    const linkedProyectoId = ventasConProyecto.find(v => v.ordenVenta?.proyecto_id)?.ordenVenta?.proyecto_id;
    console.log('Linked Project ID found:', linkedProyectoId);

    if (linkedProyectoId) {
      await tx.compra.update({
        where: { id: compraId },
        data: { proyecto_id: linkedProyectoId, destino: "PROYECTO" }
      });
      console.log('Success: Compra.proyecto_id updated to', linkedProyectoId);
    } else {
      console.log('Error: No project ID found for the linked sale.');
    }
  });

  const finalCompra = await prisma.compra.findUnique({
    where: { id: compraId },
    select: { proyecto_id: true }
  });
  console.log('Final Compra proyecto_id:', finalCompra.proyecto_id);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
