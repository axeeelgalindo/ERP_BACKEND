const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const cots = await prisma.cotizacion.findMany({
    where: { 
      fecha_ov: null,
      estado: { in: ['ORDEN_VENTA', 'ENTREGADO', 'POR_FACTURAR', 'FACTURADA', 'PAGADA'] }
    }
  });

  console.log(`Found ${cots.length} cotizaciones to fix...`);

  let fixes = 0;
  for (const c of cots) {
    // If it's FACTURADA or PAGADA, we also ensure fecha_facturada is set
    const updateData = { fecha_ov: c.actualizado_en || c.creada_en };
    if ((c.estado === 'FACTURADA' || c.estado === 'PAGADA') && !c.fecha_facturada) {
       updateData.fecha_facturada = c.actualizado_en || c.creada_en;
    }

    await prisma.cotizacion.update({
      where: { id: c.id },
      data: updateData
    });
    fixes++;
  }
  
  console.log(`Successfully fixed ${fixes} cotizaciones.`);
}

main().finally(() => prisma.$disconnect());
