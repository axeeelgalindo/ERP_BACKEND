// prisma/seed.js
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🧨 Reiniciando base de datos ERP…");

  // =========================
  // BORRAR TODO (orden FK)
  // =========================
  await prisma.auditLog.deleteMany();
  await prisma.rendicionItem.deleteMany();
  await prisma.rendicion.deleteMany();

  await prisma.compraItem.deleteMany();
  await prisma.compra.deleteMany();

  await prisma.ventaItem.deleteMany();
  await prisma.venta.deleteMany();

  await prisma.cotizacionItem.deleteMany();
  await prisma.cotizacion.deleteMany();

  await prisma.tareaDependencia.deleteMany();
  await prisma.tareaDetalle.deleteMany();
  await prisma.tarea.deleteMany();
  await prisma.proyectoMiembro.deleteMany();
  await prisma.proyecto.deleteMany();

  await prisma.producto.deleteMany();
  await prisma.proveedor.deleteMany();
  await prisma.cliente.deleteMany();

  // Remuneraciones / HH
  await prisma.empleadoRemuneracionConcepto.deleteMany();
  await prisma.empleadoRemuneracion.deleteMany();
  await prisma.remuneracionPeriodo.deleteMany();
  await prisma.hHConfig.deleteMany();

  await prisma.empleado.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.rolUsuario.deleteMany();
  await prisma.empresa.deleteMany();

  console.log("✅ Datos anteriores eliminados.");

  // =========================
  // EMPRESA
  // =========================
  const empresa = await prisma.empresa.create({
    data: {
      nombre: "Blueinge SpA",
      rut: "77.777.777-7",
      correo: "contacto@blueinge.com",
      telefono: "+56 9 1234 5678",
      activa: true,
    },
  });

  console.log("🏢 Empresa creada:", empresa.nombre);

  // =========================
  // ROLES
  // =========================
  const [rolMaster, rolAdmin, rolVentas, rolRRHH, rolBasico] =
    await Promise.all([
      prisma.rolUsuario.create({
        data: {
          nombre: "Master",
          codigo: "MASTER",
          descripcion: "Acceso completo al sistema",
          orden: 1,
        },
      }),
      prisma.rolUsuario.create({
        data: {
          nombre: "Administrador",
          codigo: "ADMIN",
          descripcion: "Gestión general de la empresa",
          orden: 2,
        },
      }),
      prisma.rolUsuario.create({
        data: {
          nombre: "Ventas",
          codigo: "VENTAS",
          descripcion: "Gestión de cotizaciones y ventas",
          orden: 3,
        },
      }),
      prisma.rolUsuario.create({
        data: {
          nombre: "RRHH",
          codigo: "RRHH",
          descripcion: "Gestión de empleados y remuneraciones",
          orden: 4,
        },
      }),
      prisma.rolUsuario.create({
        data: {
          nombre: "Usuario",
          codigo: "USER",
          descripcion: "Usuario estándar",
          orden: 5,
        },
      }),
    ]);

  console.log("👤 Roles creados.");

  // =========================
  // USUARIOS (LOGIN)
  // =========================
  const passwordAdmin = "Admin123*";
  const passwordVentas = "Ventas123*";
  const passwordRRHH = "RRHH123*";

  const saltRounds = 10;

  const [
    adminHash,
    ventasHash,
    rrhhHash,
    usuarioHash,
  ] = await Promise.all([
    bcrypt.hash(passwordAdmin, saltRounds),
    bcrypt.hash(passwordVentas, saltRounds),
    bcrypt.hash(passwordRRHH, saltRounds),
    bcrypt.hash("Usuario123*", saltRounds),
  ]);

  const [userMaster, userVenta1, userRRHH, userConsultor] =
    await Promise.all([
      prisma.usuario.create({
        data: {
          empresa_id: empresa.id,
          rol_id: rolMaster.id,
          nombre: "Axel Delgado",
          correo: "admin@blueinge.com",
          contrasena: adminHash,
        },
      }),
      prisma.usuario.create({
        data: {
          empresa_id: empresa.id,
          rol_id: rolVentas.id,
          nombre: "Camila Fuentes",
          correo: "camila.ventas@blueinge.com",
          contrasena: ventasHash,
        },
      }),
      prisma.usuario.create({
        data: {
          empresa_id: empresa.id,
          rol_id: rolRRHH.id,
          nombre: "Javier Muñoz",
          correo: "javier.rrhh@blueinge.com",
          contrasena: rrhhHash,
        },
      }),
      prisma.usuario.create({
        data: {
          empresa_id: empresa.id,
          rol_id: rolBasico.id,
          nombre: "Daniela Rojas",
          correo: "daniela@blueinge.com",
          contrasena: usuarioHash,
        },
      }),
    ]);

  console.log("🙋 Usuarios creados.");

  // =========================
  // EMPLEADOS
  // =========================
  const [empAxel, empCamila, empJavier, empDaniela] = await Promise.all([
    prisma.empleado.create({
      data: {
        usuario_id: userMaster.id,
        rut: "19.345.678-5",
        cargo: "Director de Proyectos",
        telefono: "+56 9 5555 1111",
        fecha_ingreso: new Date("2022-01-10"),
        sueldo_base: 1800000,
        activo: true,
      },
    }),
    prisma.empleado.create({
      data: {
        usuario_id: userVenta1.id,
        rut: "18.234.567-4",
        cargo: "Ejecutiva de Ventas",
        telefono: "+56 9 5555 2222",
        fecha_ingreso: new Date("2023-03-01"),
        sueldo_base: 1200000,
        activo: true,
      },
    }),
    prisma.empleado.create({
      data: {
        usuario_id: userRRHH.id,
        rut: "17.123.456-3",
        cargo: "Encargado de RRHH",
        telefono: "+56 9 5555 3333",
        fecha_ingreso: new Date("2021-09-15"),
        sueldo_base: 1300000,
        activo: true,
      },
    }),
    prisma.empleado.create({
      data: {
        usuario_id: userConsultor.id,
        rut: "16.987.654-2",
        cargo: "Consultora TI",
        telefono: "+56 9 5555 4444",
        fecha_ingreso: new Date("2024-02-01"),
        sueldo_base: 1100000,
        activo: true,
      },
    }),
  ]);

  console.log("👷 Empleados creados.");

  // =========================
  // CLIENTES
  // =========================
  const [clienteAqua, clienteExelsior] = await Promise.all([
    prisma.cliente.create({
      data: {
        empresa_id: empresa.id,
        nombre: "AquaChile S.A.",
        rut: "80.123.456-7",
        correo: "contacto@aquachile.cl",
        telefono: "+56 65 222 0000",
        notas: "Cliente estratégico del rubro acuícola.",
      },
    }),
    prisma.cliente.create({
      data: {
        empresa_id: empresa.id,
        nombre: "Exelsior Foods Ltda.",
        rut: "76.987.654-1",
        correo: "compras@exelsiorfoods.cl",
        telefono: "+56 2 2345 6789",
        notas: "Plantas de proceso en la zona sur.",
      },
    }),
  ]);

  console.log("🤝 Clientes creados.");

  // =========================
  // PROVEEDORES
  // =========================
  const [provSonda, provAzure] = await Promise.all([
    prisma.proveedor.create({
      data: {
        empresa_id: empresa.id,
        nombre: "Sonda S.A.",
        rut: "89.654.321-0",
        correo: "ventas@sonda.com",
        telefono: "+56 2 2700 0000",
        notas: "Servicios de infraestructura y soporte.",
      },
    }),
    prisma.proveedor.create({
      data: {
        empresa_id: empresa.id,
        nombre: "Microsoft Azure Chile",
        rut: "59.123.456-1",
        correo: "chile@azure.com",
        telefono: "+56 2 2400 0000",
        notas: "Servicios cloud para proyectos Blueinge.",
      },
    }),
  ]);

  console.log("📦 Proveedores creados.");

  // =========================
  // PRODUCTOS
  // =========================
  const [prodHorasCons, prodMonitoreo, prodLicencias] = await Promise.all([
    prisma.producto.create({
      data: {
        empresa_id: empresa.id,
        nombre: "Horas de consultoría TI",
        sku: "SERV-HH-TI",
        precio: 65000,
        stock: 0,
      },
    }),
    prisma.producto.create({
      data: {
        empresa_id: empresa.id,
        nombre: "Sistema de monitoreo Exelsior",
        sku: "SW-MON-EXE",
        precio: 12000000,
        stock: 0,
      },
    }),
    prisma.producto.create({
      data: {
        empresa_id: empresa.id,
        nombre: "Licencias Azure / Año",
        sku: "LIC-AZURE",
        precio: 4500000,
        stock: 0,
      },
    }),
  ]);

  console.log("🧱 Productos creados.");

  // =========================
  // PROYECTOS
  // =========================
  const [proyERP, proyExelsior, proyAqua] = await Promise.all([
    prisma.proyecto.create({
      data: {
        empresa_id: empresa.id,
        nombre: "Implementación ERP Blueinge",
        descripcion:
          "Proyecto interno para consolidar módulos de ventas, compras, RRHH y proyectos.",
        presupuesto: 25000000,
        estado: "activo",
      },
    }),
    prisma.proyecto.create({
      data: {
        empresa_id: empresa.id,
        nombre: "Plataforma de monitoreo en tiempo real Exelsior",
        descripcion:
          "Sistema para seguimiento de producción y trazabilidad en plantas Exelsior.",
        presupuesto: 18000000,
        estado: "activo",
      },
    }),
    prisma.proyecto.create({
      data: {
        empresa_id: empresa.id,
        nombre: "Sistema de reportabilidad operacional AquaChile",
        descripcion:
          "Desarrollo de dashboards y KPI para operación productiva.",
        presupuesto: 22000000,
        estado: "activo",
      },
    }),
  ]);

  console.log("📂 Proyectos creados.");

  // =========================
  // MIEMBROS DE PROYECTO
  // =========================
  await Promise.all([
    // ERP
    prisma.proyectoMiembro.create({
      data: {
        proyecto_id: proyERP.id,
        empleado_id: empAxel.id,
        rol: "Líder de proyecto",
      },
    }),
    prisma.proyectoMiembro.create({
      data: {
        proyecto_id: proyERP.id,
        empleado_id: empCamila.id,
        rol: "Líder de ventas",
      },
    }),

    // Exelsior
    prisma.proyectoMiembro.create({
      data: {
        proyecto_id: proyExelsior.id,
        empleado_id: empAxel.id,
        rol: "PM",
      },
    }),
    prisma.proyectoMiembro.create({
      data: {
        proyecto_id: proyExelsior.id,
        empleado_id: empDaniela.id,
        rol: "Consultora",
      },
    }),

    // AquaChile
    prisma.proyectoMiembro.create({
      data: {
        proyecto_id: proyAqua.id,
        empleado_id: empAxel.id,
        rol: "Arquitecto de solución",
      },
    }),
    prisma.proyectoMiembro.create({
      data: {
        proyecto_id: proyAqua.id,
        empleado_id: empDaniela.id,
        rol: "Desarrolladora",
      },
    }),
  ]);

  console.log("👥 Miembros de proyectos creados.");

  // =========================
  // CONFIGURACIÓN HH + PERIODO DE REMUNERACIONES
  // =========================
  const hhConfig = await prisma.hHConfig.create({
    data: {
      empresa_id: empresa.id,
      nombre: "Configuración estándar Chile 2025",
      horas_dia: 8,
      dias_mes: 30,
      afp_porcentaje: 0.11,
      salud_porcentaje: 0.07,
      mutual_porcentaje: 0.01,
      otros_porcentaje: 0.02,
      margen_base_venta: 0.35,
      factor_normal: 1,
      factor_extra_50: 1.5,
      factor_extra_100: 2,
      factor_feriado: 2,
      activo: true,
    },
  });

  console.log("⏱️ Configuración HH creada:", hhConfig.nombre);

  const periodoSep = await prisma.remuneracionPeriodo.create({
    data: {
      empresa_id: empresa.id,
      anio: 2025,
      mes: 9,
      dias_mes: 30,
      horas_dia: 8,
      nombre: "Remuneraciones septiembre 2025",
    },
  });

  console.log("📆 Periodo de remuneraciones creado:", periodoSep.nombre);

  // Helper para crear remuneración emplead@ + conceptos
  const crearRemuEmpleado = async (empleado, dias_trabajados, sueldo_liquido) => {
    const horas_dia = 8;
    const horas_mes = dias_trabajados * horas_dia;

    const imponible = sueldo_liquido;
    const afp = imponible * (hhConfig.afp_porcentaje ?? 0);
    const salud = imponible * (hhConfig.salud_porcentaje ?? 0);
    const mutual = imponible * (hhConfig.mutual_porcentaje ?? 0);
    const otros = imponible * (hhConfig.otros_porcentaje ?? 0);
    const costo_empresa_mes = sueldo_liquido + afp + salud + mutual + otros;
    const valor_hora_costo = horas_mes > 0 ? costo_empresa_mes / horas_mes : 0;
    const margen = hhConfig.margen_base_venta ?? 0.35;
    const valor_hora_venta = valor_hora_costo * (1 + margen);

    const rem = await prisma.empleadoRemuneracion.create({
      data: {
        periodo_id: periodoSep.id,
        empleado_id: empleado.id,
        dias_trabajados,
        sueldo_liquido,
        horas_dia,
        horas_mes,
        imponible,
        afp,
        salud,
        mutual,
        otros_costos: otros,
        costo_empresa_mes,
        valor_hora_costo,
        valor_hora_venta,
      },
    });

    const conceptos = [
      { tipo: "normal", factor: hhConfig.factor_normal ?? 1 },
      { tipo: "extra_50", factor: hhConfig.factor_extra_50 ?? 1.5 },
      { tipo: "extra_100", factor: hhConfig.factor_extra_100 ?? 2 },
      { tipo: "feriado", factor: hhConfig.factor_feriado ?? 2 },
    ];

    for (const c of conceptos) {
      const factor = c.factor;
      await prisma.empleadoRemuneracionConcepto.create({
        data: {
          remuneracion_id: rem.id,
          tipo: c.tipo,
          factor_costo: factor,
          factor_venta: factor,
          valor_hora_costo: valor_hora_costo * factor,
          valor_hora_venta: valor_hora_venta * factor,
        },
      });
    }

    return rem;
  };

  await Promise.all([
    crearRemuEmpleado(empAxel, 30, 1800000),
    crearRemuEmpleado(empCamila, 30, 1200000),
    crearRemuEmpleado(empJavier, 30, 1300000),
    crearRemuEmpleado(empDaniela, 30, 1100000),
  ]);

  console.log("💸 Remuneraciones base creadas.");

  console.log("🌱 Seed ERP completado con éxito.");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
