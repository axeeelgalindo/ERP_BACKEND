const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const cots = await prisma.cotizacion.findMany({
    where: { estado: 'ORDEN_VENTA' },
    include: { cliente: true }
  });

  console.log("Cots with ORDEN_VENTA:", cots.map(c => ({
    id: c.id,
    num: c.numero,
    estado: c.estado,
    creada_en: c.creada_en,
    actualizado_en: c.actualizado_en,
    fecha_ov: c.fecha_ov
  })));
}

main().finally(() => prisma.$disconnect());
