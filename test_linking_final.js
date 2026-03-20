import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const ventaId = 'cmmdj1fkw0027v8j83mpe6u8u';
  const compraId = 'cmmdj4cu2002iv8j891ez17x1';

  const c = await prisma.compra.findUnique({ where: { id: compraId } });
  const v = await prisma.venta.findUnique({ where: { id: ventaId } });

  console.log('Compra exists:', !!c);
  console.log('Venta exists:', !!v);

  if (c && v) {
      await prisma.$transaction(async (tx) => {
        await tx.compraCosteo.deleteMany({ where: { compra_id: compraId } });
        await tx.compraCosteo.create({
          data: {
            empresa_id: c.empresa_id,
            compra_id: compraId,
            venta_id: ventaId,
            monto: 1000
          }
        });

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
        }
      });
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
