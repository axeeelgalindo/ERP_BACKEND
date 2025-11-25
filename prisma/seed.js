/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");
const crypto = require("node:crypto");
const prisma = new PrismaClient();

/* ===== utils ===== */
const hash = (txt) => crypto.createHash("sha256").update(String(txt)).digest("hex");
const round2 = (n) => Math.round(n * 100) / 100;
const daysBetween = (a, b) => Math.max(1, Math.ceil((b - a) / (1000 * 60 * 60 * 24)));

async function main() {
  console.log("🌱 Seed ERP…");

  const MASTER_EMAIL = process.env.MASTER_EMAIL || "master@blueinge.cl";
  const MASTER_PASS  = process.env.MASTER_PASS  || "cambia_esta_clave";

  /* ========== Empresa MASTER (sistema) ========== */
  const empresaMaster = await prisma.empresa.upsert({
    where: { id: "empresa_master_global" },
    update: {},
    create: {
      id: "empresa_master_global",
      nombre: "Sistema (MASTER)",
      correo: "no-reply@sistema.local",
      activa: true,
    },
  });

  /* ========== Empresa demo ========== */
  const empresa = await prisma.empresa.upsert({
    where: { id: "empresa_unica_demo" },
    update: {},
    create: {
      id: "empresa_unica_demo",
      nombre: "Blueinge SpA",
      rut: "77.123.456-7",
      correo: "contacto@blueinge.cl",
      telefono: "+56 9 1234 5678",
    },
  });

  /* ========== Roles (incluye MASTER) ========== */
  const roles = await Promise.all([
    prisma.rolUsuario.upsert({
      where: { codigo: "MASTER" },
      update: {},
      create: { nombre: "Master", codigo: "MASTER", descripcion: "Superusuario global" },
    }),
    prisma.rolUsuario.upsert({
      where: { codigo: "ADMIN" },
      update: {},
      create: { nombre: "Administrador", codigo: "ADMIN", descripcion: "Acceso total" },
    }),
    prisma.rolUsuario.upsert({
      where: { codigo: "SUP" },
      update: {},
      create: { nombre: "Supervisor", codigo: "SUP", descripcion: "Gestión operativa" },
    }),
    prisma.rolUsuario.upsert({
      where: { codigo: "EMP" },
      update: {},
      create: { nombre: "Empleado", codigo: "EMP", descripcion: "Usuario estándar" },
    }),
  ]);
  const rolByCode = Object.fromEntries(roles.map((r) => [r.codigo, r]));

  /* ========== Usuario MASTER ========== */
  await prisma.usuario.upsert({
    where: { correo: MASTER_EMAIL },
    update: {},
    create: {
      nombre: "Usuario Master",
      correo: MASTER_EMAIL,
      contrasena: hash(MASTER_PASS),
      empresa_id: empresaMaster.id,
      rol_id: rolByCode.MASTER.id,
    },
  });

  /* ========== Usuarios & Empleados demo ========== */
  const admin = await prisma.usuario.upsert({
    where: { correo: "admin@blueinge.cl" },
    update: {},
    create: {
      nombre: "Admin Blueinge",
      correo: "admin@blueinge.cl",
      contrasena: hash("admin123"),
      empresa_id: empresa.id,
      rol_id: rolByCode.ADMIN.id,
    },
  });

  const sup = await prisma.usuario.upsert({
    where: { correo: "supervisor@blueinge.cl" },
    update: {},
    create: {
      nombre: "Sofía Supervisor",
      correo: "supervisor@blueinge.cl",
      contrasena: hash("super123"),
      empresa_id: empresa.id,
      rol_id: rolByCode.SUP.id,
    },
  });

  const emp = await prisma.usuario.upsert({
    where: { correo: "empleado@blueinge.cl" },
    update: {},
    create: {
      nombre: "Eduardo Empleado",
      correo: "empleado@blueinge.cl",
      contrasena: hash("empleado123"),
      empresa_id: empresa.id,
      rol_id: rolByCode.EMP.id,
    },
  });

  const empAdmin = await prisma.empleado.upsert({
    where: { usuario_id: admin.id },
    update: {},
    create: {
      usuario_id: admin.id,
      cargo: "Gerente TI",
      telefono: "+56 9 1111 1111",
      sueldo_base: 1800000,
    },
  });

  const empSup = await prisma.empleado.upsert({
    where: { usuario_id: sup.id },
    update: {},
    create: {
      usuario_id: sup.id,
      cargo: "Jefe de Operaciones",
      telefono: "+56 9 2222 2222",
      sueldo_base: 1200000,
    },
  });

  const empStd = await prisma.empleado.upsert({
    where: { usuario_id: emp.id },
    update: {},
    create: {
      usuario_id: emp.id,
      cargo: "Técnico",
      telefono: "+56 9 3333 3333",
      sueldo_base: 800000,
    },
  });

  /* ========== Clientes & Proveedores ========== */
  const clienteA = await prisma.cliente.upsert({
    where: { correo: "compras@acme.cl" },
    update: {},
    create: {
      empresa_id: empresa.id,
      nombre: "ACME Ltda.",
      rut: "76.111.222-3",
      correo: "compras@acme.cl",
      telefono: "+56 2 2345 6789",
      notas: "Cliente corporativo",
    },
  });

  const provA = await prisma.proveedor.upsert({
    where: { correo: "ventas@dist-elec.cl" },
    update: {},
    create: {
      empresa_id: empresa.id,
      nombre: "Distribuidora Eléctrica",
      rut: "77.456.789-1",
      correo: "ventas@dist-elec.cl",
      telefono: "+56 2 2456 7890",
      notas: "Despachos en 48h",
    },
  });

  /* ========== Productos ========== */
  const productos = await Promise.all([
    prisma.producto.upsert({
      where: { sku: "SW-24P-GIGA" },
      update: {},
      create: {
        empresa_id: empresa.id,
        nombre: "Switch 24p Gigabit",
        sku: "SW-24P-GIGA",
        precio: 169990,
        stock: 10,
      },
    }),
    prisma.producto.upsert({
      where: { sku: "ROUT-AC1200" },
      update: {},
      create: {
        empresa_id: empresa.id,
        nombre: "Router AC1200 Dual Band",
        sku: "ROUT-AC1200",
        precio: 54990,
        stock: 40,
      },
    }),
  ]);
  const pBySku = Object.fromEntries(productos.map((p) => [p.sku, p]));

  /* ========== Proyecto demo ========== */
  const proyecto = await prisma.proyecto.upsert({
    where: { id: "proj_demo_1" },
    update: {},
    create: {
      id: "proj_demo_1",
      empresa_id: empresa.id,
      nombre: "Implementación Red Planta Osorno",
      descripcion: "Instalación backbone y distribución Cat6 + equipos core",
      presupuesto: 5500000,
      estado: "activo",
    },
  });

  await prisma.proyectoMiembro.upsert({
    where: { proyecto_id_empleado_id: { proyecto_id: proyecto.id, empleado_id: empAdmin.id } },
    update: {},
    create: { proyecto_id: proyecto.id, empleado_id: empAdmin.id, rol: "Jefe de Proyecto" },
  });
  await prisma.proyectoMiembro.upsert({
    where: { proyecto_id_empleado_id: { proyecto_id: proyecto.id, empleado_id: empStd.id } },
    update: {},
    create: { proyecto_id: proyecto.id, empleado_id: empStd.id, rol: "Técnico" },
  });

  /* ========== Tareas (planificación) ========== */
  const base = new Date(); base.setHours(12, 0, 0, 0);
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  const t1_ini = addDays(base, 0);
  const t1_fin = addDays(base, 3);
  const t2_ini = addDays(t1_fin, 0);
  const t2_fin = addDays(t2_ini, 4);
  const t3_ini = addDays(t2_fin, 0);
  const t3_fin = addDays(t3_ini, 2);

  await prisma.tarea.upsert({
    where: { id: "tarea_demo_1" },
    update: {},
    create: {
      id: "tarea_demo_1",
      proyecto_id: proyecto.id,
      nombre: "Levantamiento en terreno",
      descripcion: "Visita a planta, mapeo de puntos y rutas.",
      responsable_id: empStd.id,
      prioridad: 1,
      estado: "completada",
      avance: 100,
      es_hito: false,
      orden: 1,
      fecha_inicio_plan: t1_ini,
      fecha_fin_plan: t1_fin,
      dias_plan: daysBetween(t1_ini, t1_fin),
      fecha_inicio_real: addDays(t1_ini, 0),
      fecha_fin_real: addDays(t1_fin, 1),
      dias_reales: daysBetween(addDays(t1_ini, 0), addDays(t1_fin, 1)),
    },
  });

  await prisma.tarea.upsert({
    where: { id: "tarea_demo_2" },
    update: {},
    create: {
      id: "tarea_demo_2",
      proyecto_id: proyecto.id,
      nombre: "Diseño e ingeniería",
      descripcion: "Topología, especificación de materiales y equipos.",
      responsable_id: empAdmin.id,
      prioridad: 1,
      estado: "en_progreso",
      avance: 60,
      es_hito: false,
      orden: 2,
      fecha_inicio_plan: t2_ini,
      fecha_fin_plan: t2_fin,
      dias_plan: daysBetween(t2_ini, t2_fin),
      fecha_inicio_real: addDays(t2_ini, 0),
    },
  });

  await prisma.tarea.upsert({
    where: { id: "tarea_demo_3" },
    update: {},
    create: {
      id: "tarea_demo_3",
      proyecto_id: proyecto.id,
      nombre: "Aprobación del cliente",
      descripcion: "Validación del alcance y cronograma.",
      responsable_id: empAdmin.id,
      prioridad: 1,
      estado: "pendiente",
      avance: 0,
      es_hito: true,
      orden: 3,
      fecha_inicio_plan: t3_ini,
      fecha_fin_plan: t3_fin,
      dias_plan: daysBetween(t3_ini, t3_fin),
    },
  });

  await prisma.tareaDependencia.upsert({
    where: { tarea_id_predecesora_id: { tarea_id: "tarea_demo_2", predecesora_id: "tarea_demo_1" } },
    update: {},
    create: { tarea_id: "tarea_demo_2", predecesora_id: "tarea_demo_1", tipo: "FS" },
  });
  await prisma.tareaDependencia.upsert({
    where: { tarea_id_predecesora_id: { tarea_id: "tarea_demo_3", predecesora_id: "tarea_demo_2" } },
    update: {},
    create: { tarea_id: "tarea_demo_3", predecesora_id: "tarea_demo_2", tipo: "FS" },
  });

  /* ========== Cotización demo ========== */
  const qItems = [
    { prod: pBySku["SW-24P-GIGA"], cant: 2 },
    { prod: pBySku["ROUT-AC1200"], cant: 3 },
  ].map((x) => ({
    producto_id: x.prod.id,
    cantidad: x.cant,
    precio_unit: x.prod.precio,
    total: round2(x.cant * x.prod.precio),
  }));
  const qTotal = round2(qItems.reduce((s, i) => s + i.total, 0));
  await prisma.cotizacion.upsert({
    where: { numero: "Q-0001" },
    update: {},
    create: {
      empresa_id: empresa.id,
      proyecto_id: proyecto.id,
      cliente_id: clienteA.id,
      numero: "Q-0001",
      estado: "enviada",
      total: qTotal,
      items: { create: qItems },
    },
  });

  /* ========== Compra demo ========== */
  const cItems = [{ prod: pBySku["SW-24P-GIGA"], cant: 1 }].map((x) => ({
    producto_id: x.prod.id,
    cantidad: x.cant,
    precio_unit: x.prod.precio * 0.8,
    total: round2(x.cant * (x.prod.precio * 0.8)),
  }));
  const cTotal = round2(cItems.reduce((s, i) => s + i.total, 0));
  await prisma.compra.upsert({
    where: { numero: "C-0001" },
    update: {},
    create: {
      empresa_id: empresa.id,
      proyecto_id: proyecto.id,
      proveedor_id: provA.id,
      numero: "C-0001",
      estado: "recibida",
      total: cTotal,
      items: { create: cItems },
    },
  });

  /* ========== Rendición demo ========== */
  await prisma.rendicion.create({
    data: {
      empleado_id: empStd.id,
      proyecto_id: proyecto.id,
      descripcion: "Boletas viaje a terreno (combustible + peajes)",
      monto_total: 58230,
      estado: "aprobada",
      items: {
        create: [
          { linea: 1, fecha: new Date(), descripcion: "Combustible", monto: 42000, categoria: "Transporte" },
          { linea: 2, fecha: new Date(), descripcion: "Peajes", monto: 16230, categoria: "Transporte" },
        ],
      },
    },
  });

  console.log("✅ Seed completado");
}

/* ===== run ===== */
main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
