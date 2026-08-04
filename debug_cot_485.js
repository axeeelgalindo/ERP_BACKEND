import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const cot = await prisma.cotizacion.findFirst({
    where: { numero: 476 },
    include: {
      glosas: true
    }
  });
  console.log("=== COT 476 ===");
  console.log(JSON.stringify(cot, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
