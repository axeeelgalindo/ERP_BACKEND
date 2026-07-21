const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.usuario.findMany({
    where: { eliminado: false },
    include: {
      rol: true
    }
  });
  console.log("USERS:", users.map(u => ({ id: u.id, correo: u.correo, contrasena: u.contrasena, rol: u.rol.nombre, rolCodigo: u.rol.codigo })));
}

main().finally(() => prisma.$disconnect());
