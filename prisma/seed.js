// prisma/seed.js
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Seed alineado a tu lógica actual:
 * - Empresa (1)
 * - Roles: SUPERADMIN / ADMIN / USER (y deja todo idempotente)
 * - Usuario superadmin + su Empleado (para rendiciones / tareas)
 * - Cliente demo + Responsable + Cuenta bancaria (para cotizaciones/ventas)
 * - Proveedor demo
 * - Catálogos por empresa: UnidadItem, TipoItem, TipoDia
 * - CIF default por empresa
 *
 * Nota: NO crea proyectos/cotizaciones/ventas/compras/rendiciones para no ensuciar dev,
 * pero deja todo listo para usar la app.
 */

const DO_RESET = false; // true SOLO si quieres borrar datos (dev local)
const PASSWORD_DEFAULT = process.env.SEED_ADMIN_PASSWORD || "12345";

function shouldIgnoreDeleteError(e) {
  return e?.code === "P2021" || e?.code === "P2022";
}

async function safeDeleteMany(delegateName, where = undefined) {
  const delegate = prisma[delegateName];
  if (!delegate?.deleteMany) return;
  try {
    await delegate.deleteMany(where ? { where } : undefined);
  } catch (e) {
    if (shouldIgnoreDeleteError(e)) return;
    throw e;
  }
}

async function resetAll() {
  console.log("🧨 Reset total (hard delete) ...");

  // orden: hijos -> padres (según tus relaciones)
  await safeDeleteMany("auditLog");

  await safeDeleteMany("compraCosteo");
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
  await safeDeleteMany("tareaHistorial");
  await safeDeleteMany("tarea");
  await safeDeleteMany("epica");

  await safeDeleteMany("proyectoMiembro");
  await safeDeleteMany("proyecto");

  await safeDeleteMany("hHEmpleado");
  await safeDeleteMany("cIF");

  await safeDeleteMany("empleado");
  await safeDeleteMany("usuario");
  await safeDeleteMany("rolUsuario");

  await safeDeleteMany("producto");
  await safeDeleteMany("proveedor");

  await safeDeleteMany("clienteResponsable");
  await safeDeleteMany("clienteCuentaBancaria");
  await safeDeleteMany("cliente");

  await safeDeleteMany("tipoItem");
  await safeDeleteMany("tipoDia");
  await safeDeleteMany("unidadItem");

  await safeDeleteMany("aFPConfig");
  await safeDeleteMany("saludConfig");

  await safeDeleteMany("empresa");

  console.log("✅ Reset listo.");
}

/* =========================
   Upserts base
========================= */

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
        eliminado: false,
        eliminado_en: null,
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

async function upsertRol({ nombre, codigo, descripcion, orden }) {
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
        orden: orden ?? null,
        activo: true,
        eliminado: false,
        eliminado_en: null,
      },
    });
  }

  return prisma.rolUsuario.create({
    data: {
      nombre,
      codigo,
      descripcion,
      orden: orden ?? null,
      activo: true,
    },
  });
}

async function upsertUsuarioConEmpleado({
  empresaId,
  rolId,
  correo,
  nombre,
  password,
  empleado, // { rut?, cargo?, telefono? }
}) {
  const hash = await bcrypt.hash(password, 10);

  const existing = await prisma.usuario.findFirst({
    where: { correo, eliminado: false },
    select: { id: true },
  });

  const usuario = existing
    ? await prisma.usuario.update({
        where: { id: existing.id },
        data: {
          empresa_id: empresaId,
          rol_id: rolId,
          nombre,
          contrasena: hash,
          eliminado: false,
          eliminado_en: null,
        },
      })
    : await prisma.usuario.create({
        data: {
          empresa_id: empresaId,
          rol_id: rolId,
          nombre,
          correo,
          contrasena: hash,
        },
      });

  // Empleado asociado (opcional por schema, pero te conviene tenerlo para rendiciones/HH)
  const empExisting = await prisma.empleado.findFirst({
    where: { usuario_id: usuario.id },
    select: { id: true },
  });

  const empData = {
    rut: empleado?.rut ?? null,
    cargo: empleado?.cargo ?? "Administrador",
    telefono: empleado?.telefono ?? null,
    activo: true,
    eliminado: false,
    eliminado_en: null,
  };

  const empleadoRow = empExisting
    ? await prisma.empleado.update({
        where: { id: empExisting.id },
        data: empData,
      })
    : await prisma.empleado.create({
        data: {
          usuario_id: usuario.id,
          ...empData,
        },
      });

  return { usuario, empleado: empleadoRow };
}

async function upsertClienteDemo({ empresaId }) {
  const correo = "cliente@demo.com";

  const existing = await prisma.cliente.findFirst({
    where: { empresa_id: empresaId, correo, eliminado: false },
    select: { id: true },
  });

  const cliente = existing
    ? await prisma.cliente.update({
        where: { id: existing.id },
        data: {
          nombre: "Cliente Demo",
          rut: "11.111.111-1",
          telefono: "+56 9 2222 3333",
          notas: "Cliente de prueba para desarrollo",
          eliminado: false,
          eliminado_en: null,
        },
      })
    : await prisma.cliente.create({
        data: {
          empresa_id: empresaId,
          nombre: "Cliente Demo",
          rut: "11.111.111-1",
          correo,
          telefono: "+56 9 2222 3333",
          notas: "Cliente de prueba para desarrollo",
        },
      });

  // Responsable principal
  const respCorreo = "contacto@demo.com";
  const respExisting = await prisma.clienteResponsable.findFirst({
    where: { cliente_id: cliente.id, correo: respCorreo, eliminado: false },
    select: { id: true },
  });

  const responsable = respExisting
    ? await prisma.clienteResponsable.update({
        where: { id: respExisting.id },
        data: {
          nombre: "Contacto Demo",
          telefono: "+56 9 3333 4444",
          cargo: "Compras",
          area: "Operaciones",
          es_principal: true,
          eliminado: false,
          eliminado_en: null,
        },
      })
    : await prisma.clienteResponsable.create({
        data: {
          cliente_id: cliente.id,
          nombre: "Contacto Demo",
          correo: respCorreo,
          telefono: "+56 9 3333 4444",
          cargo: "Compras",
          area: "Operaciones",
          es_principal: true,
        },
      });

  // Cuenta bancaria (lista)
  const cuentaExisting = await prisma.clienteCuentaBancaria.findFirst({
    where: { cliente_id: cliente.id, numero: "12345678", eliminado: false },
    select: { id: true },
  });

  const cuenta = cuentaExisting
    ? await prisma.clienteCuentaBancaria.update({
        where: { id: cuentaExisting.id },
        data: {
          banco: "Banco de Chile",
          tipo_cuenta: "Cuenta Corriente",
          titular: "Cliente Demo",
          rut_titular: "11.111.111-1",
          correo_pago: "pagos@demo.com",
          eliminado: false,
          eliminado_en: null,
        },
      })
    : await prisma.clienteCuentaBancaria.create({
        data: {
          cliente_id: cliente.id,
          banco: "Banco de Chile",
          tipo_cuenta: "Cuenta Corriente",
          numero: "12345678",
          titular: "Cliente Demo",
          rut_titular: "11.111.111-1",
          correo_pago: "pagos@demo.com",
        },
      });

  // set cuenta principal (si aún no está)
  if (!cliente.cuenta_principal_id || cliente.cuenta_principal_id !== cuenta.id) {
    await prisma.cliente.update({
      where: { id: cliente.id },
      data: { cuenta_principal_id: cuenta.id },
    });
  }

  return { cliente, responsable, cuenta };
}

async function upsertProveedorDemo({ empresaId }) {
  const correo = "proveedor@demo.com";

  const existing = await prisma.proveedor.findFirst({
    where: { empresa_id: empresaId, correo, eliminado: false },
    select: { id: true },
  });

  if (existing) {
    return prisma.proveedor.update({
      where: { id: existing.id },
      data: {
        nombre: "Proveedor Demo",
        rut: "22.222.222-2",
        telefono: "+56 9 4444 5555",
        notas: "Proveedor de prueba para desarrollo",
        eliminado: false,
        eliminado_en: null,
      },
    });
  }

  return prisma.proveedor.create({
    data: {
      empresa_id: empresaId,
      nombre: "Proveedor Demo",
      rut: "22.222.222-2",
      correo,
      telefono: "+56 9 4444 5555",
      notas: "Proveedor de prueba para desarrollo",
    },
  });
}

/* =========================
   Catálogos (por empresa)
========================= */

async function upsertUnidadItems({ empresaId }) {
  const unidades = ["Hora", "Unidad", "Servicio", "Viaje", "Día"];

  const map = {};
  for (const nombre of unidades) {
    const existing = await prisma.unidadItem.findFirst({
      where: { empresa_id: empresaId, nombre, eliminado: false },
      select: { id: true },
    });

    const row = existing
      ? await prisma.unidadItem.update({
          where: { id: existing.id },
          data: { eliminado: false, eliminado_en: null },
        })
      : await prisma.unidadItem.create({
          data: { empresa_id: empresaId, nombre },
        });

    map[nombre] = row.id;
  }
  return map; // { "Hora": id, ... }
}

async function upsertTipoItems({ empresaId, unidadIds }) {
  // OJO: codigo debe ser único por empresa (cuando eliminado=false)
  const tipos = [
    { nombre: "HH", codigo: "HH", porcentajeUtilidad: 410, unidad: "Hora" },
    { nombre: "Material", codigo: "MATERIAL", porcentajeUtilidad: 30, unidad: "Unidad" },
    { nombre: "Logística", codigo: "LOGISTICA", porcentajeUtilidad: 20, unidad: "Servicio" },
    { nombre: "Transporte", codigo: "TRANSPORTE", porcentajeUtilidad: 10, unidad: "Viaje" },
    { nombre: "Alimentación", codigo: "ALIMENTACION", porcentajeUtilidad: 10, unidad: "Día" },
    { nombre: "Estadía", codigo: "ESTADIA", porcentajeUtilidad: 10, unidad: "Día" },
  ];

  for (const t of tipos) {
    const existing = await prisma.tipoItem.findFirst({
      where: { empresa_id: empresaId, codigo: t.codigo, eliminado: false },
      select: { id: true },
    });

    const unidadItemId = unidadIds?.[t.unidad] ?? null;

    if (existing) {
      await prisma.tipoItem.update({
        where: { id: existing.id },
        data: {
          nombre: t.nombre,
          porcentajeUtilidad: t.porcentajeUtilidad,
          unidadItemId,
          eliminado: false,
          eliminado_en: null,
        },
      });
    } else {
      await prisma.tipoItem.create({
        data: {
          empresa_id: empresaId,
          nombre: t.nombre,
          codigo: t.codigo,
          porcentajeUtilidad: t.porcentajeUtilidad,
          unidadItemId,
        },
      });
    }
  }
}

async function upsertTipoDias({ empresaId }) {
  // valor: tu sistema lo usa como extra/recargo (según tu lógica actual)
  const tipos = [
    { nombre: "Normal", valor: 0 },
    { nombre: "Feriado", valor: 200000 },
    { nombre: "Urgencia", valor: 400000 },
  ];

  for (const t of tipos) {
    const existing = await prisma.tipoDia.findFirst({
      where: { empresa_id: empresaId, nombre: t.nombre, eliminado: false },
      select: { id: true },
    });

    if (existing) {
      await prisma.tipoDia.update({
        where: { id: existing.id },
        data: { valor: t.valor, eliminado: false, eliminado_en: null },
      });
    } else {
      await prisma.tipoDia.create({
        data: { empresa_id: empresaId, nombre: t.nombre, valor: t.valor },
      });
    }
  }
}

async function upsertCIFDefault({ empresaId }) {
  const valor = 120000;
  const nota = "CIF Default";

  const existing = await prisma.cIF.findFirst({
    where: { empresa_id: empresaId, anio: null, mes: null, nota },
    select: { id: true },
  });

  if (existing) {
    return prisma.cIF.update({
      where: { id: existing.id },
      data: { valor },
    });
  }

  return prisma.cIF.create({
    data: { empresa_id: empresaId, valor, nota, anio: null, mes: null },
  });
}

/* =========================
   Main
========================= */

async function main() {
  console.log("🌱 Seed...");

  if (DO_RESET) await resetAll();

  const empresa = await upsertEmpresa();

  // roles
  const rolSuper = await upsertRol({
    nombre: "SUPERADMIN",
    codigo: "SUPERADMIN",
    descripcion: "Acceso total (multi-módulo)",
    orden: 1,
  });
  const rolAdmin = await upsertRol({
    nombre: "ADMIN",
    codigo: "ADMIN",
    descripcion: "Administrador",
    orden: 2,
  });
  const rolUser = await upsertRol({
    nombre: "USER",
    codigo: "USER",
    descripcion: "Usuario estándar",
    orden: 3,
  });

  // usuario principal + empleado
  const adminCorreo = "admin@blueinge.com";
  const { usuario: usuarioAdmin, empleado: empleadoAdmin } =
    await upsertUsuarioConEmpleado({
      empresaId: empresa.id,
      rolId: rolSuper.id, // ✅ por tu comentario de superadmin
      correo: adminCorreo,
      nombre: "Administrador",
      password: PASSWORD_DEFAULT,
      empleado: {
        rut: "18.888.888-8",
        cargo: "Gerencia / Admin",
        telefono: "+56 9 1111 0000",
      },
    });

  // catálogos por empresa
  const unidadIds = await upsertUnidadItems({ empresaId: empresa.id });
  await upsertTipoItems({ empresaId: empresa.id, unidadIds });
  await upsertTipoDias({ empresaId: empresa.id });
  const cifDefault = await upsertCIFDefault({ empresaId: empresa.id });

  // demo data mínimo útil
  const { cliente, responsable, cuenta } = await upsertClienteDemo({
    empresaId: empresa.id,
  });
  const proveedor = await upsertProveedorDemo({ empresaId: empresa.id });

  console.log("✅ Seed listo.");
  console.log("====================================");
  console.log("🏢 Empresa:", empresa.nombre, "|", empresa.id);
  console.log("🔐 Usuario Admin:", adminCorreo);
  console.log("🔑 Clave:", PASSWORD_DEFAULT);
  console.log("👷 Empleado Admin:", empleadoAdmin.id);
  console.log("👤 Roles:", {
    SUPERADMIN: rolSuper.id,
    ADMIN: rolAdmin.id,
    USER: rolUser.id,
  });
  console.log("💰 CIF Default:", cifDefault.id);
  console.log("🤝 Cliente Demo:", cliente.id, "| Responsable:", responsable.id, "| Cuenta:", cuenta.id);
  console.log("🏭 Proveedor Demo:", proveedor.id);
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