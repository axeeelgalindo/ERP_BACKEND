import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  try {
    const e = await prisma.empresa.findFirst();
    const empresa_id = String(e.id);
    
    console.log("Testing ventas query...");
    const ventas = await prisma.venta.findMany({
      where: {
        AND: [{ eliminado: false }],
        OR: [
          { ordenVenta: { empresa_id: String(empresa_id), eliminado: false } },
          { detalles: { some: { hhEmpleado: { empresa_id: String(empresa_id) } } } },
          { detalles: { some: { compras: { compra: { empresa_id: String(empresa_id), eliminado: false } } } } },
          { AND: [{ ordenVentaId: null }, { detalles: { every: { hhEmpleadoId: null } } }, { detalles: { every: { compraId: null } } }] }
        ],
      },
      include: {
        detalles: {
          include: {
            compras: { include: { compra: true } }
          }
        },
        ordenVenta: true
      }
    });

    console.log("Success");
  } catch(e) {
    console.error("ERROR:", e.message);
  } finally {
    await prisma.$disconnect();
  }
}
main();
