const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("Iniciando migración de fechas de transición...");

  // 1. Cotizaciones en estado ORDEN_VENTA o superior que no tengan fecha_ov
  const cots = await prisma.cotizacion.findMany({
    where: {
      estado: { in: ["ORDEN_VENTA", "FACTURADA", "PAGADA"] },
      fecha_ov: null,
      eliminado: false,
    },
  });

  console.log(`Encontradas ${cots.length} cotizaciones para actualizar fecha_ov`);

  for (const c of cots) {
    await prisma.cotizacion.update({
      where: { id: c.id },
      data: { fecha_ov: c.actualizado_en || c.creada_en },
    });
  }

  // 2. Cotizaciones en estado FACTURADA o superior que no tengan fecha_facturada
  const cotsF = await prisma.cotizacion.findMany({
    where: {
      estado: { in: ["FACTURADA", "PAGADA"] },
      fecha_facturada: null,
      eliminado: false,
    },
  });

  console.log(`Encontradas ${cotsF.length} cotizaciones para actualizar fecha_facturada`);

  for (const c of cotsF) {
    await prisma.cotizacion.update({
      where: { id: c.id },
      data: { fecha_facturada: c.actualizado_en || c.creada_en },
    });
  }

  console.log("Migración completada.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
