import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const projectId = "cmn7u1axq000dv8w045p5ltqy";

async function main() {
  console.log("Minimal update...");
  try {
    await prisma.proyecto.update({
      where: { id: projectId },
      data: {
        fecha_inicio_plan: new Date("2026-01-05T08:00:00Z"),
        fecha_fin_plan: new Date("2026-04-02T18:00:00Z"),
        estado: "completado",
        avance: 100
      }
    });
    console.log("Success!");
  } catch (e) {
    console.error("FAIL:", e.message);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
