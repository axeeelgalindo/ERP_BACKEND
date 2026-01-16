// prisma/seed.js
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Seed:
 * - Empresa
 * - Roles (ADMIN, USER)
 * - Usuario Admin
 * - Cliente Demo
 * - TipoDia (Normal/Feriado/Urgencia)
 * - TipoItem (HH/Material/...)
 * - CIF Default (90000) asociado a la empresa
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

  // Ajusta/elimina lo que no exista en tu schema
  await safeDeleteMany("detalleVenta");
  await safeDeleteMany("venta");

  await safeDeleteMany("compraItem");
  await safeDeleteMany("compra");

  await safeDeleteMany("cotizacionGlosa");
  await safeDeleteMany("cotizacion");

  await safeDeleteMany("rendicionItem");
  await safeDeleteMany("rendicion");

  await safeDeleteMany("tareaDetalle");
  await safeDeleteMany("tareaDependencia");
  await safeDeleteMany("tarea");

  await safeDeleteMany("proyectoMiembro");
  await safeDeleteMany("proyecto");

  await safeDeleteMany("hHEmpleado");
  await safeDeleteMany("cIF");

  await safeDeleteMany("empleado");
  await safeDeleteMany("usuario");
  await safeDeleteMany("rolUsuario");

  await safeDeleteMany("producto");
  await safeDeleteMany("proveedor");
  await safeDeleteMany("cliente");

  await safeDeleteMany("tipoItem");
  await safeDeleteMany("tipoDia");
  await safeDeleteMany("unidadItem");

  await safeDeleteMany("aFPConfig");
  await safeDeleteMany("saludConfig");
  await safeDeleteMany("auditLog");

  await safeDeleteMany("empresa");

  console.log("✅ Reset listo.");
}

async function upsertEmpresa() {
  const nombre = "Blue Ingeniería SPA";

  const existing = await prisma.empresa.findFirst({
    where: { nombre },
    select: { id: true },
  });

  if (existing) {
    return prisma.empresa.update({
      where: { id: existing.id },
      data: {
        rut: "76.123.456-7",
        correo: "administracion@blueinge.com",
        telefono: "+56 9 1111 2222",
        activa: true,
      },
    });
  }

  return prisma.empresa.create({
    data: {
      nombre,
      rut: "76.123.456-7",
      correo: "administracion@blueinge.com",
      telefono: "+56 9 1111 2222",
      activa: true,
    },
  });
}

async function upsertRol({ nombre, codigo, descripcion }) {
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
  const correoAdmin = "admin@blueinge.com";
  const passAdmin = "12345";
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
    },
  });
}

async function upsertTipoDias({ empresaId }) {
  const tipos = [
    { nombre: "Normal", valor: 0 },
    { nombre: "Feriado", valor: 200000 },
    { nombre: "Urgencia", valor: 400000 },
  ];

  for (const tipo of tipos) {
    const existing = await prisma.tipoDia.findFirst({
      where: { empresa_id: empresaId, nombre: tipo.nombre, eliminado: false },
      select: { id: true },
    });

    if (existing) {
      await prisma.tipoDia.update({
        where: { id: existing.id },
        data: {
          valor: tipo.valor,
          eliminado: false,
          eliminado_en: null,
        },
      });
    } else {
      await prisma.tipoDia.create({
        data: {
          empresa_id: empresaId,
          nombre: tipo.nombre,
          valor: tipo.valor,
        },
      });
    }
  }
}

async function upsertTipoItems({ empresaId }) {
  const tipos = [
    { nombre: "HH", codigo: "HH", porcentajeUtilidad: 410 },
    { nombre: "Material", codigo: "material", porcentajeUtilidad: 30 },
    { nombre: "Logística", codigo: "logistica", porcentajeUtilidad: 20 },
    { nombre: "Transporte", codigo: "transporte", porcentajeUtilidad: 10 },
    { nombre: "Alimentación", codigo: "alimentacion", porcentajeUtilidad: 10 },
    { nombre: "Estadía", codigo: "estadia", porcentajeUtilidad: 10 },
  ];

  for (const tipo of tipos) {
    const existing = await prisma.tipoItem.findFirst({
      where: { empresa_id: empresaId, codigo: tipo.codigo, eliminado: false },
      select: { id: true },
    });

    if (existing) {
      await prisma.tipoItem.update({
        where: { id: existing.id },
        data: {
          nombre: tipo.nombre,
          porcentajeUtilidad: tipo.porcentajeUtilidad,
          eliminado: false,
          eliminado_en: null,
        },
      });
    } else {
      await prisma.tipoItem.create({
        data: {
          empresa_id: empresaId,
          nombre: tipo.nombre,
          codigo: tipo.codigo,
          porcentajeUtilidad: tipo.porcentajeUtilidad,
        },
      });
    }
  }
}

/**
 * ✅ CIF default (90000) por empresa
 * Esto reemplaza el intento de guardar "cif" dentro de TipoItem (que no existe).
 */
async function upsertCIFDefault({ empresaId }) {
  const CIF_DEFAULT = 120000;
  const nota = "CIF Default";

  const existing = await prisma.cIF.findFirst({
    where: {
      empresa_id: empresaId,
      anio: null,
      mes: null,
      nota,
    },
    select: { id: true },
  });

  if (existing) {
    return prisma.cIF.update({
      where: { id: existing.id },
      data: { valor: CIF_DEFAULT },
    });
  }

  return prisma.cIF.create({
    data: {
      empresa_id: empresaId,
      valor: CIF_DEFAULT,
      nota,
      anio: null,
      mes: null,
    },
  });
}

async function main() {
  console.log("🌱 Seed...");

  if (DO_RESET) await resetAll();

  const empresa = await upsertEmpresa();

  await upsertTipoDias({ empresaId: empresa.id });
  await upsertTipoItems({ empresaId: empresa.id });

  // ✅ CIF default por empresa
  const cifDefault = await upsertCIFDefault({ empresaId: empresa.id });

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
  console.log("CIF Default ID:", cifDefault?.id);
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
