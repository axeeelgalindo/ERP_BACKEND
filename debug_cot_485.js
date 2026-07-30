import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const cot = await prisma.cotizacion.findFirst({
    where: { numero: 469 },
    include: {
      ventas: {
        where: { eliminado: false },
        include: { detalles: true }
      }
    }
  });
  console.log("=== COT 469 ===");
  console.log(JSON.stringify(cot, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
