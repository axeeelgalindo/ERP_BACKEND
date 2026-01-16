// prisma/seed.js
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Seed mínimo:
 * - Empresa
 * - Roles (ADMIN, USER)
 * - Usuario Admin
 * - Cliente Demo (sin direccion)
 */

const DO_RESET = false; // true solo si quieres limpiar TODO antes de sembrar

function shouldIgnoreDeleteError(e) {
  return e?.code === "P2021" || e?.code === "P2022";
}

async function safeDeleteMany(delegateName, where = undefined) {
  const delegate = prisma[delegateName];
  if (!delegate?.deleteMany) return;

  try {
    await delegate.deleteMany(where ? { where } : undefined);
  } catch (e) {
    if (shouldIgnoreDeleteError(e)) {
      console.log(`⚠️ Skip deleteMany(${delegateName}) -> ${e.code}`);
      return;
    }
    throw e;
  }
}

async function resetAll() {
  console.log("🧨 Reset total (hard delete) ...");

  await safeDeleteMany("cotizacionGlosa");
  await safeDeleteMany("cotizacion");

  await safeDeleteMany("cliente");

  await safeDeleteMany("empleado");
  await safeDeleteMany("usuario");
  await safeDeleteMany("rolUsuario");

  await safeDeleteMany("empresa");

  console.log("✅ Reset listo.");
}

async function upsertEmpresa() {
  const nombre = "Blueinge Demo";

  const existing = await prisma.empresa.findFirst({
    where: { nombre },
    select: { id: true },
  });

  if (existing) {
    return prisma.empresa.update({
      where: { id: existing.id },
      data: {
        rut: "76.123.456-7",
        correo: "demo@blueinge.com",
        telefono: "+56 9 1111 2222",
        activa: true,
      },
    });
  }

  return prisma.empresa.create({
    data: {
      nombre,
      rut: "76.123.456-7",
      correo: "demo@blueinge.com",
      telefono: "+56 9 1111 2222",
      activa: true,
    },
  });
}

async function upsertRol({ nombre, codigo, descripcion }) {
  // Si tu schema no tiene "codigo", cámbialo por "nombre"
  const existing = await prisma.rolUsuario.findFirst({
    where: { codigo },
    select: { id: true },
  });

  if (existing) {
    return prisma.rolUsuario.update({
      where: { id: existing.id },
      data: {
        nombre,
        codigo,
        descripcion,
        activo: true,
        eliminado: false,
        eliminado_en: null,
      },
    });
  }

  return prisma.rolUsuario.create({
    data: { nombre, codigo, descripcion, activo: true },
  });
}

async function upsertUsuarioAdmin({ empresaId, rolAdminId }) {
  const correoAdmin = "admin@demo.com";
  const passAdmin = "Admin1234!";
  const hash = await bcrypt.hash(passAdmin, 10);

  const existing = await prisma.usuario.findFirst({
    where: { correo: correoAdmin, eliminado: false },
    select: { id: true },
  });

  let usuarioAdmin;
  if (existing) {
    usuarioAdmin = await prisma.usuario.update({
      where: { id: existing.id },
      data: {
        empresa_id: empresaId,
        rol_id: rolAdminId,
        nombre: "Administrador",
        contrasena: hash,
        eliminado: false,
        eliminado_en: null,
      },
    });
  } else {
    usuarioAdmin = await prisma.usuario.create({
      data: {
        empresa_id: empresaId,
        rol_id: rolAdminId,
        nombre: "Administrador",
        correo: correoAdmin,
        contrasena: hash,
      },
    });
  }

  return { usuarioAdmin, correoAdmin, passAdmin };
}

async function upsertClienteDemo({ empresaId }) {
  const correo = "cliente@demo.com";

  const existing = await prisma.cliente.findFirst({
    where: { empresa_id: empresaId, correo, eliminado: false },
    select: { id: true },
  });

  if (existing) {
    return prisma.cliente.update({
      where: { id: existing.id },
      data: {
        nombre: "Cliente Demo",
        eliminado: false,
        eliminado_en: null,
      },
    });
  }

  return prisma.cliente.create({
    data: {
      empresa_id: empresaId,
      nombre: "Cliente Demo",
      correo,
      // ✅ sin direccion (tu schema no lo tiene)
    },
  });
}

async function main() {
  console.log("🌱 Seed mínimo...");

  if (DO_RESET) await resetAll();

  const empresa = await upsertEmpresa();

  const rolAdmin = await upsertRol({
    nombre: "ADMIN",
    codigo: "ADMIN",
    descripcion: "Administrador",
  });

  const rolUser = await upsertRol({
    nombre: "USER",
    codigo: "USER",
    descripcion: "Usuario estándar",
  });

  const { usuarioAdmin, correoAdmin, passAdmin } = await upsertUsuarioAdmin({
    empresaId: empresa.id,
    rolAdminId: rolAdmin.id,
  });

  const cliente = await upsertClienteDemo({ empresaId: empresa.id });

  console.log("✅ Seed listo.");
  console.log("====================================");
  console.log("🔐 Credenciales Admin:");
  console.log(`Correo: ${correoAdmin}`);
  console.log(`Clave : ${passAdmin}`);
  console.log("Empresa ID:", empresa.id);
  console.log("Rol ADMIN ID:", rolAdmin.id);
  console.log("Rol USER ID:", rolUser.id);
  console.log("Usuario Admin ID:", usuarioAdmin.id);
  console.log("Cliente Demo ID:", cliente?.id);
  console.log("====================================");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
