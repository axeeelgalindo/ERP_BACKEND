const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const currentMonth = 3; // April (0-indexed)
  const currentYear = 2026;

  console.log(`Checking for month: ${currentYear}-${currentMonth + 1}`);

  const cotizaciones = await prisma.cotizacion.findMany({
    include: { cliente: true }
  });

  console.log("--- COTIZACIONES ---");
  cotizaciones.forEach(c => {
    const d = new Date(c.creada_en);
    const isThisMonth = d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    
    let isOVThisMonth = false;
    if (c.fecha_ov) {
      const dov = new Date(c.fecha_ov);
      isOVThisMonth = dov.getMonth() === currentMonth && dov.getFullYear() === currentYear;
    }

    console.log(`ID: ${c.id}, Num: ${c.numero}, Estado: ${c.estado}, Creada: ${c.creada_en}, Fecha OV: ${c.fecha_ov}, Total: ${c.total}`);
    if (isThisMonth) console.log("  -> [CREADA ESTE MES]");
    if (isOVThisMonth) console.log("  -> [OV ESTE MES]");
  });

  const ventas = await prisma.venta.findMany({
    include: { ordenVenta: true }
  });

  console.log("\n--- VENTAS ---");
  ventas.forEach(v => {
    const d = new Date(v.fecha);
    const isThisMonth = d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    console.log(`ID: ${v.id}, Num: ${v.numero}, Fecha: ${v.fecha}, Folio: ${v.folio}, Total: ${v.total}, OV_Estado: ${v.ordenVenta?.estado}`);
    if (isThisMonth) console.log("  -> [ESTE MES]");
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
