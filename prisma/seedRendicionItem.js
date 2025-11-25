/* prisma/seed_rendicion.js */
/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seed Rendición…");

  // 1) Busca un empleado. Si no hay, toma el del usuario empleado@blueinge.cl o el primero disponible.
  let empleado = await prisma.empleado.findFirst({
    include: { usuario: true },
    where: { usuario: { correo: "empleado@blueinge.cl" } },
  });
  if (!empleado) {
    empleado = await prisma.empleado.findFirst();
  }
  if (!empleado) {
    throw new Error("No hay empleados en la base. Crea uno antes de correr este seed.");
  }

  // 2) Crea/actualiza la rendición con ID fijo (idempotente)
  const rend = await prisma.rendicion.upsert({
    where: { id: "rend_demo_1" },
    update: { descripcion: "Rendición de gastos viaje terreno - Demo" },
    create: {
      id: "rend_demo_1",
      empleado_id: empleado.id,
      descripcion: "Rendición de gastos viaje terreno - Demo",
      estado: "pendiente",
      monto_total: 0, // se recalcula después
    },
  });

  // 3) Ítems (usa upsert por la UNIQUE compuesta: (rendicion_id, linea))
  const items = [
    {
      linea: 1,
      fecha: new Date(),
      descripcion: "Combustible",
      monto: 32500,
      categoria: "Transporte",
      comprobante_url: null,
    },
    {
      linea: 2,
      fecha: new Date(),
      descripcion: "Peajes",
      monto: 8200,
      categoria: "Transporte",
      comprobante_url: null,
    },
    {
      linea: 3,
      fecha: new Date(),
      descripcion: "Colación",
      monto: 7500,
      categoria: "Alimentación",
      comprobante_url: null,
    },
  ];

  // upsert de cada ítem por (rendicion_id, linea)
  for (const it of items) {
    await prisma.rendicionItem.upsert({
      where: {
        rendicion_id_linea: { rendicion_id: rend.id, linea: it.linea },
      },
      update: {
        fecha: it.fecha,
        descripcion: it.descripcion,
        monto: it.monto,
        categoria: it.categoria ?? null,
        comprobante_url: it.comprobante_url ?? null,
      },
      create: {
        rendicion_id: rend.id,
        linea: it.linea,
        fecha: it.fecha,
        descripcion: it.descripcion,
        monto: it.monto,
        categoria: it.categoria ?? null,
        comprobante_url: it.comprobante_url ?? null,
      },
    });
  }

  // 4) Recalcula monto_total = suma(items)
  const sum = await prisma.rendicionItem.aggregate({
    where: { rendicion_id: rend.id },
    _sum: { monto: true },
  });

  await prisma.rendicion.update({
    where: { id: rend.id },
    data: { monto_total: sum._sum.monto ?? 0 },
  });

  console.log("✅ Rendición e ítems actualizados. Total:", sum._sum.monto ?? 0);
}

main()
  .catch((e) => {
    console.error("❌ Seed rendición error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
