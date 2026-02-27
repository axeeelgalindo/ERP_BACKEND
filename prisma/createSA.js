// create Super Admin (SA) if not exists
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  await prisma.rolUsuario.upsert({
    where: { codigo: "SUPERADMIN" },
    update: {
      nombre: "SUPERADMIN",
      descripcion: "Super administrador del sistema",
      activo: true,
      eliminado: false,
    },
    create: {
      nombre: "SUPERADMIN",
      codigo: "SUPERADMIN",
      descripcion: "Super administrador del sistema",
      activo: true,
      eliminado: false,
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });