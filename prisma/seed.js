// prisma/seed.js
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * =============================
 * CONFIG
 * =============================
 */
const DO_RESET = true; // si no quieres limpiar antes, ponlo en false

function shouldIgnoreDeleteError(e) {
  return e?.code === "P2021" || e?.code === "P2022";
}

async function safeDeleteMany(delegateName) {
  const delegate = prisma[delegateName];
  if (!delegate?.deleteMany) return;

  try {
    await delegate.deleteMany();
  } catch (e) {
    if (shouldIgnoreDeleteError(e)) {
      console.log(
        `⚠️  Skip deleteMany(${delegateName}) -> ${e.code} (${
          e.meta?.table || "tabla/col no existe"
        })`
      );
      return;
    }
    throw e;
  }
}

async function resetAll() {
  console.log("🧨 Reset total (sin romper si faltan tablas)...");

  // hijo -> padre
  await safeDeleteMany("detalleVenta");
  await safeDeleteMany("venta");

  await safeDeleteMany("compraItem");
  await safeDeleteMany("compra");

  // 👇 NO creamos cotización, pero si existen las limpiamos en reset
  await safeDeleteMany("cotizacionItem");
  await safeDeleteMany("cotizacion");

  await safeDeleteMany("rendicionItem");
  await safeDeleteMany("rendicion");

  await safeDeleteMany("tareaDetalle");
  await safeDeleteMany("tareaDependencia");
  await safeDeleteMany("tarea");
  await safeDeleteMany("proyectoMiembro");
  await safeDeleteMany("proyecto");

  await safeDeleteMany("hHEmpleado");

  await safeDeleteMany("empleado");
  await safeDeleteMany("usuario");
  await safeDeleteMany("rolUsuario");

  await safeDeleteMany("producto");
  await safeDeleteMany("proveedor");
  await safeDeleteMany("cliente");

  // catálogos admin
  await safeDeleteMany("tipoItem");
  await safeDeleteMany("tipoDia");
  await safeDeleteMany("unidadItem");

  await safeDeleteMany("aFPConfig");
  await safeDeleteMany("saludConfig");

  await safeDeleteMany("auditLog");
  await safeDeleteMany("empresa");

  console.log("✅ Reset listo.");
}

/**
 * =============================
 * UPSERT HELPERS (JS)
 * =============================
 */
async function upsertEmpresa() {
  const existing = await prisma.empresa.findFirst({
    where: { nombre: "Blueinge Demo", eliminado: false },
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
        eliminado: false,
        eliminado_en: null,
      },
    });
  }

  return prisma.empresa.create({
    data: {
      nombre: "Blueinge Demo",
      rut: "76.123.456-7",
      correo: "demo@blueinge.com",
      telefono: "+56 9 1111 2222",
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

async function upsertEmpleadoAdmin({ usuarioId }) {
  const existing = await prisma.empleado.findFirst({
    where: { usuario_id: usuarioId, eliminado: false },
    select: { id: true },
  });

  if (existing) {
    return prisma.empleado.update({
      where: { id: existing.id },
      data: {
        rut: "11.111.111-1",
        cargo: "Administrador",
        activo: true,
        eliminado: false,
        eliminado_en: null,
      },
    });
  }

  return prisma.empleado.create({
    data: {
      usuario_id: usuarioId,
      rut: "11.111.111-1",
      cargo: "Administrador",
      activo: true,
    },
  });
}

async function upsertUnidadItem({ empresaId, nombre }) {
  const existing = await prisma.unidadItem.findFirst({
    where: { empresa_id: empresaId, nombre, eliminado: false },
    select: { id: true },
  });

  if (existing) {
    return prisma.unidadItem.update({
      where: { id: existing.id },
      data: { eliminado: false, eliminado_en: null },
    });
  }

  return prisma.unidadItem.create({
    data: { empresa_id: empresaId, nombre },
  });
}

async function upsertTipoItem({
  empresaId,
  nombre,
  codigo,
  porcentajeUtilidad,
  unidadItemId,
}) {
  const existing = await prisma.tipoItem.findFirst({
    where: { empresa_id: empresaId, codigo, eliminado: false },
    select: { id: true },
  });

  if (existing) {
    return prisma.tipoItem.update({
      where: { id: existing.id },
      data: {
        nombre,
        porcentajeUtilidad,
        unidadItemId,
        eliminado: false,
        eliminado_en: null,
      },
    });
  }

  return prisma.tipoItem.create({
    data: {
      empresa_id: empresaId,
      nombre,
      codigo,
      porcentajeUtilidad,
      unidadItemId,
    },
  });
}

async function upsertTipoDia({ empresaId, nombre, valor }) {
  const existing = await prisma.tipoDia.findFirst({
    where: { empresa_id: empresaId, nombre, eliminado: false },
    select: { id: true },
  });

  if (existing) {
    return prisma.tipoDia.update({
      where: { id: existing.id },
      data: { valor, eliminado: false, eliminado_en: null },
    });
  }

  return prisma.tipoDia.create({
    data: { empresa_id: empresaId, nombre, valor },
  });
}

async function upsertProyecto({ empresaId }) {
  const existing = await prisma.proyecto.findFirst({
    where: { empresa_id: empresaId, nombre: "Proyecto Demo", eliminado: false },
    select: { id: true },
  });

  if (existing) {
    return prisma.proyecto.update({
      where: { id: existing.id },
      data: {
        descripcion: "Proyecto para pruebas",
        eliminado: false,
        eliminado_en: null,
      },
    });
  }

  return prisma.proyecto.create({
    data: {
      empresa_id: empresaId,
      nombre: "Proyecto Demo",
      descripcion: "Proyecto para pruebas",
    },
  });
}

async function upsertCliente({ empresaId }) {
  const correo = "cliente@demo.com";
  const existing = await prisma.cliente.findFirst({
    where: { empresa_id: empresaId, correo, eliminado: false },
    select: { id: true },
  });

  if (existing) {
    return prisma.cliente.update({
      where: { id: existing.id },
      data: { nombre: "Cliente Demo", eliminado: false, eliminado_en: null },
    });
  }

  return prisma.cliente.create({
    data: { empresa_id: empresaId, nombre: "Cliente Demo", correo },
  });
}

async function upsertProveedor({ empresaId }) {
  const correo = "proveedor@demo.com";
  const existing = await prisma.proveedor.findFirst({
    where: { empresa_id: empresaId, correo, eliminado: false },
    select: { id: true },
  });

  if (existing) {
    return prisma.proveedor.update({
      where: { id: existing.id },
      data: { nombre: "Proveedor Demo", eliminado: false, eliminado_en: null },
    });
  }

  return prisma.proveedor.create({
    data: { empresa_id: empresaId, nombre: "Proveedor Demo", correo },
  });
}

async function upsertProducto({ empresaId }) {
  // Producto: @@unique([sku, eliminado]) (global por sku+eliminado, ojo)
  const sku = "SKU-DEMO-1";

  const existing = await prisma.producto.findFirst({
    where: { sku, eliminado: false },
    select: { id: true },
  });

  if (existing) {
    return prisma.producto.update({
      where: { id: existing.id },
      data: {
        empresa_id: empresaId,
        nombre: "Insumo Demo",
        precio: 10000,
        stock: 100,
        eliminado: false,
        eliminado_en: null,
      },
    });
  }

  return prisma.producto.create({
    data: {
      empresa_id: empresaId,
      nombre: "Insumo Demo",
      sku,
      precio: 10000,
      stock: 100,
    },
  });
}

/**
 * =============================
 * MAIN
 * =============================
 */
async function main() {
  console.log("🌱 Iniciando seed.js...");
  console.log(
    "🧩 Delegates PrismaClient:",
    Object.keys(prisma)
      .filter((k) => !k.startsWith("$"))
      .sort()
      .join(", ")
  );

  if (DO_RESET) await resetAll();

  // =========================
  // Empresa
  // =========================
  const empresa = await upsertEmpresa();

  // =========================
  // Roles
  // =========================
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

  // =========================
  // Usuario Admin + Empleado
  // =========================
  const { usuarioAdmin, correoAdmin, passAdmin } = await upsertUsuarioAdmin({
    empresaId: empresa.id,
    rolAdminId: rolAdmin.id,
  });

  const empleadoAdmin = await upsertEmpleadoAdmin({ usuarioId: usuarioAdmin.id });

  // =========================
  // Catálogos (por empresa)
  // =========================
  const unidadHH = await upsertUnidadItem({ empresaId: empresa.id, nombre: "HH" });
  const unidadUN = await upsertUnidadItem({ empresaId: empresa.id, nombre: "UN" });

  const tipoItemHH = await upsertTipoItem({
    empresaId: empresa.id,
    nombre: "Horas Hombre",
    codigo: "HH",
    porcentajeUtilidad: 30,
    unidadItemId: unidadHH.id,
  });

  const tipoItemMAT = await upsertTipoItem({
    empresaId: empresa.id,
    nombre: "Materiales",
    codigo: "MATERIAL",
    porcentajeUtilidad: 25,
    unidadItemId: unidadUN.id,
  });

  await upsertTipoDia({ empresaId: empresa.id, nombre: "Normal", valor: 0 });
  await upsertTipoDia({ empresaId: empresa.id, nombre: "Fin de semana", valor: 200000 });
  await upsertTipoDia({ empresaId: empresa.id, nombre: "Urgente", valor: 400000 });
  await upsertTipoDia({ empresaId: empresa.id, nombre: "Feriado", valor: 250000 });

  // =========================
  // Proyecto / Cliente / Proveedor / Producto
  // =========================
  const proyecto = await upsertProyecto({ empresaId: empresa.id });
  const cliente = await upsertCliente({ empresaId: empresa.id });
  const proveedor = await upsertProveedor({ empresaId: empresa.id });
  const producto = await upsertProducto({ empresaId: empresa.id });

  // =========================
  // Compra + Item
  // =========================
  const compra = await prisma.compra.create({
    data: {
      empresa_id: empresa.id,
      proyecto_id: proyecto.id,
      proveedorId: proveedor.id,
      total: 50000,
      estado: "ORDEN_COMPRA",
      factura_url: null,
    },
  });

  const compraItem = await prisma.compraItem.create({
    data: {
      compra_id: compra.id,
      producto_id: producto.id,
      proveedor_id: proveedor.id,
      item: "Insumo Demo",
      cantidad: 5,
      precio_unit: 10000,
      total: 50000,
      tipoItemId: tipoItemMAT.id,
    },
  });

  // =========================
  // Venta + Detalle (modo COMPRA)
  // =========================
  // 👇 IMPORTANTÍSIMO: NO cotización => ordenVentaId NULL
  const venta = await prisma.venta.create({
    data: { ordenVentaId: null, descripcion: "Venta demo (sin cotización)" },
  });

  await prisma.detalleVenta.create({
    data: {
      ventaId: venta.id,
      descripcion: "Compra vinculada (demo) - sin cotización",
      cantidad: 5,
      total: 50000,
      modo: "COMPRA",
      tipoItemId: tipoItemMAT.id,
      compraId: compraItem.id,
      costoUnitario: 10000,
      costoTotal: 50000,
      ventaUnitario: 12500,
      ventaTotal: 62500,
      utilidad: 12500,
      porcentajeUtilidad: 25,
    },
  });

  console.log("✅ Seed listo.");
  console.log("====================================");
  console.log("🔐 Credenciales de inicio de sesión:");
  console.log(`Correo: ${correoAdmin}`);
  console.log(`Clave : ${passAdmin}`);
  console.log("Empleado Admin ID:", empleadoAdmin.id);
  console.log("Empresa ID:", empresa.id);
  console.log("Rol USER ID:", rolUser.id);
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
