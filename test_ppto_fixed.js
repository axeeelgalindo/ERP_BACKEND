import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const proyectoId = 'cmmxwe2gt0004v8zgjnv81nqf';
  const empresaId = 'cmmdikurc0000v8rcwn04dg2d';

  console.log('--- TEST PPTO CONSUMIDO ---');

  // Create a purchase with tipo_doc 34 (Factura Exenta)
  const c = await prisma.compra.create({
    data: {
      empresa_id: empresaId,
      proyecto_id: proyectoId,
      total: 500000,
      tipo_doc: 34,
      proveedorId: 'cmmdim2720002v8rcy3w83p14',
      estado: 'FACTURADA',
      fecha_docto: new Date(),
      destino: 'PROYECTO'
    }
  });
  console.log('Created purchase with tipo_doc 34, ID:', c.id);

  // Now simulate the devengado calculation (logic from devengado_new.js)
  const compras = await prisma.compra.findMany({
    where: { proyecto_id: proyectoId, eliminado: false }
  });

  const pptoCalculado = compras.reduce((acc, c) => {
    const td = Number(c.tipo_doc);
    if ([33, 34, 39, 41, 46, 56, 69].includes(td)) return acc + (c.total || 0);
    if (td === 61) return acc - (c.total || 0);
    return acc;
  }, 0);

  console.log('Ppto Consumido calculado:', pptoCalculado);

  if (pptoCalculado >= 500000) {
    console.log('Success: Ppto Consumido reflects the new purchase.');
  } else {
    console.log('Error: Ppto Consumido did not reflect the new purchase correctly.');
  }

  // Cleanup
  await prisma.compra.delete({ where: { id: c.id } });
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
