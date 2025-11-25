/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();

/* ===================== utils ===================== */
const hash = (txt) => createHash("sha256").update(String(txt)).digest("hex");
const round2 = (n) => Math.round(n * 100) / 100;
const daysBetween = (a, b) =>
  Math.max(1, Math.ceil((b - a) / (1000 * 60 * 60 * 24)));
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const toChilePhone = (i) =>
  `+56 9 ${String(1000 + (i % 9000)).padStart(4, "0")} ${String(
    1000 + ((i * 7) % 9000)
  ).padStart(4, "0")}`;

/* ===== helpers para upsert con claves compuestas (soft-delete aware) ===== */
const whereUsuario = (correo, eliminado = false) => ({
  correo_eliminado: { correo, eliminado },
});
const whereCliente = (correo, eliminado = false) => ({
  correo_eliminado: { correo, eliminado },
});
const whereProveedor = (correo, eliminado = false) => ({
  correo_eliminado: { correo, eliminado },
});
const whereProducto = (sku, eliminado = false) => ({
  sku_eliminado: { sku, eliminado },
});

/* ===================== parámetros de volumen ===================== */
const EMPRESAS = [
  { code: "BLUE", name: "Blueinge SpA", domain: "blueinge.com" },
  { code: "AQUA", name: "AquaChile Servicios", domain: "aquachile.cl" },
];

const PROYECTOS_POR_EMPRESA = 4;
const CLIENTES_POR_EMPRESA = 6;
const PROVEEDORES_POR_EMPRESA = 4;
const PRODUCTOS_POR_EMPRESA = 12;
const USUARIOS_EXTRA_POR_EMPRESA = 6; // además de admin + supervisor

/* ===================== catálogo base ===================== */
const PRODUCT_NAMES = [
  "Switch 24p Gigabit",
  "Switch 48p PoE",
  "Router AC1200",
  "Router AX1800",
  "Access Point WiFi 6",
  "Patch Panel 24p",
  "Bobina Cable Cat6 305m",
  "UPS 1500VA",
  "Rack 22U",
  "Cámara IP 4MP",
  "Licencia Firewall Std",
  "Mini PC Industrial",
];
const PRODUCT_SKU_PREFIX = [
  "SW24",
  "SW48",
  "RT12",
  "RT18",
  "AP6",
  "PP24",
  "C6-305",
  "UPS15",
  "RCK22",
  "IP4",
  "FWSTD",
  "MINIPC",
];
const TASK_NAMES = [
  "Levantamiento",
  "Diseño",
  "Adquisiciones",
  "Instalación",
  "Configuración",
  "Pruebas",
  "Capacitación",
  "Cierre",
];
const ESTADOS_TAREA = ["pendiente", "en_progreso", "completada"];
const ESTADOS_COT = ["borrador", "enviada", "aceptada", "rechazada"];
const ESTADOS_VTA = ["pendiente", "aprobada", "anulada"];
const ESTADOS_CMP = ["pendiente", "recibida", "anulada"];

/* ===================== main ===================== */
async function main() {
  console.log("🌱 Seed ERP masivo…");

  const MASTER_EMAIL = process.env.MASTER_EMAIL || "master@blueinge.cl";
  const MASTER_PASS = process.env.MASTER_PASS || "cambia_esta_clave";

  /* ===== Empresa MASTER (sistema) ===== */
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

  /* ===== Roles (incluye MASTER) ===== */
  const roles = await Promise.all([
    prisma.rolUsuario.upsert({
      where: { codigo: "MASTER" },
      update: {},
      create: {
        nombre: "Master",
        codigo: "MASTER",
        descripcion: "Superusuario global",
      },
    }),
    prisma.rolUsuario.upsert({
      where: { codigo: "ADMIN" },
      update: {},
      create: {
        nombre: "Administrador",
        codigo: "ADMIN",
        descripcion: "Acceso total",
      },
    }),
    prisma.rolUsuario.upsert({
      where: { codigo: "SUP" },
      update: {},
      create: {
        nombre: "Supervisor",
        codigo: "SUP",
        descripcion: "Gestión operativa",
      },
    }),
    prisma.rolUsuario.upsert({
      where: { codigo: "EMP" },
      update: {},
      create: {
        nombre: "Empleado",
        codigo: "EMP",
        descripcion: "Usuario estándar",
      },
    }),
  ]);
  const rolByCode = Object.fromEntries(roles.map((r) => [r.codigo, r]));

  /* ===== Usuario MASTER ===== */
  await prisma.usuario.upsert({
    where: whereUsuario(MASTER_EMAIL),
    update: {},
    create: {
      nombre: "Usuario Master",
      correo: MASTER_EMAIL,
      contrasena: hash(MASTER_PASS),
      empresa_id: empresaMaster.id,
      rol_id: rolByCode.MASTER.id,
    },
  });

  /* ===== Empresas demo ===== */
  const empresas = [];
  for (const e of EMPRESAS) {
    const row = await prisma.empresa.upsert({
      where: { id: `empresa_${e.code}` },
      update: {},
      create: {
        id: `empresa_${e.code}`,
        nombre: e.name,
        rut: `76.${Math.floor(Math.random() * 900) + 100}.000-${Math.floor(
          Math.random() * 9
        )}`,
        correo: `contacto@${e.domain}`,
        telefono: "+56 2 2345 6789",
      },
    });
    empresas.push({ ...e, id: row.id });
  }

  for (const emp of empresas) {
    console.log(`→ poblando ${emp.name}…`);

    /* ===== Usuarios (admin, supervisor, varios empleados) ===== */
    const admin = await prisma.usuario.upsert({
      where: whereUsuario(`admin@${emp.domain}`),
      update: {},
      create: {
        nombre: `Admin ${emp.code}`,
        correo: `admin@${emp.domain}`,
        contrasena: hash("admin123"),
        empresa_id: emp.id,
        rol_id: rolByCode.ADMIN.id,
      },
    });

    const sup = await prisma.usuario.upsert({
      where: whereUsuario(`supervisor@${emp.domain}`),
      update: {},
      create: {
        nombre: `Supervisor ${emp.code}`,
        correo: `supervisor@${emp.domain}`,
        contrasena: hash("super123"),
        empresa_id: emp.id,
        rol_id: rolByCode.SUP.id,
      },
    });

    const empleadosUsuarios = [];
    for (let i = 0; i < USUARIOS_EXTRA_POR_EMPRESA; i++) {
      const correo = `empleado${i + 1}@${emp.domain}`;
      const u = await prisma.usuario.upsert({
        where: whereUsuario(correo),
        update: {},
        create: {
          nombre: `Empleado ${i + 1} ${emp.code}`,
          correo,
          contrasena: hash("empleado123"),
          empresa_id: emp.id,
          rol_id: rolByCode.EMP.id,
        },
      });
      empleadosUsuarios.push(u);
    }

    /* Empleados (uno por usuario) */
    const empleados = [];
    const toEmpleado = async (u, cargo, sueldo) =>
      prisma.empleado.upsert({
        where: { usuario_id: u.id },
        update: {},
        create: {
          usuario_id: u.id,
          cargo,
          telefono: toChilePhone((Math.random() * 9999) | 0),
          sueldo_base: sueldo,
        },
      });

    const empAdmin = await toEmpleado(admin, "Gerente TI", 1_800_000);
    const empSup = await toEmpleado(sup, "Jefe Operaciones", 1_200_000);

    for (const [i, u] of empleadosUsuarios.entries()) {
      const eRow = await toEmpleado(
        u,
        `Técnico ${i + 1}`,
        700_000 + i * 30_000
      );
      empleados.push(eRow);
    }

    const empleadosAll = [empAdmin, empSup, ...empleados];

    /* ===== Clientes & Proveedores ===== */
    const clientes = [];
    for (let i = 1; i <= CLIENTES_POR_EMPRESA; i++) {
      const correo = `cliente${i}@${emp.code.toLowerCase()}.cl`;
      const c = await prisma.cliente.upsert({
        where: whereCliente(correo),
        update: {},
        create: {
          empresa_id: emp.id,
          nombre: `Cliente ${i} ${emp.code}`,
          rut: `76.${i}${i}${i}.00${i}-${(i % 9) + 1}`,
          correo,
          telefono: toChilePhone(i * 17),
          notas: i % 2 === 0 ? "Cliente corporativo" : "Cliente retail",
        },
      });
      clientes.push(c);
    }

    const proveedores = [];
    for (let i = 1; i <= PROVEEDORES_POR_EMPRESA; i++) {
      const correo = `proveedor${i}@${emp.code.toLowerCase()}.cl`;
      const p = await prisma.proveedor.upsert({
        where: whereProveedor(correo),
        update: {},
        create: {
          empresa_id: emp.id,
          nombre: `Proveedor ${i} ${emp.code}`,
          rut: `77.${i}${i}${i}.00${i}-${(i % 9) + 1}`,
          correo,
          telefono: toChilePhone(i * 23),
          notas: i % 2 === 0 ? "Entrega 72h" : "Entrega 48h",
        },
      });
      proveedores.push(p);
    }

    /* ===== Productos ===== */
    const productos = [];
    for (let i = 0; i < PRODUCTOS_POR_EMPRESA; i++) {
      const name = PRODUCT_NAMES[i % PRODUCT_NAMES.length];
      const sku = `${PRODUCT_SKU_PREFIX[i % PRODUCT_SKU_PREFIX.length]}-${
        emp.code
      }-${String(i + 1).padStart(3, "0")}`;
      const precio =
        29_990 + i * 15_000 + Math.floor(Math.random() * 9_000);
      const prod = await prisma.producto.upsert({
        where: whereProducto(sku),
        update: {},
        create: {
          empresa_id: emp.id,
          nombre: name,
          sku,
          precio,
          stock: 10 + Math.floor(Math.random() * 90),
        },
      });
      productos.push(prod);
    }

    /* ===== Proyectos + Miembros + Tareas ===== */
    const proyectos = [];
    for (let i = 1; i <= PROYECTOS_POR_EMPRESA; i++) {
      const prj = await prisma.proyecto.upsert({
        where: { id: `PRJ-${emp.code}-${i}` },
        update: {},
        create: {
          id: `PRJ-${emp.code}-${i}`,
          empresa_id: emp.id,
          nombre: `Proyecto ${i} ${emp.code}`,
          descripcion: `Implementación ${i} para ${emp.name}`,
          presupuesto: 3_000_000 + i * 750_000,
          estado: "activo",
        },
      });
      proyectos.push(prj);

      // miembros: admin + 2 técnicos
      await prisma.proyectoMiembro.upsert({
        where: {
          proyecto_id_empleado_id: {
            proyecto_id: prj.id,
            empleado_id: empAdmin.id,
          },
        },
        update: {},
        create: {
          proyecto_id: prj.id,
          empleado_id: empAdmin.id,
          rol: "Jefe de Proyecto",
        },
      });

      const t1 = empleadosAll[(i * 3) % empleadosAll.length];
      const t2 = empleadosAll[(i * 5) % empleadosAll.length];

      for (const t of [t1, t2]) {
        await prisma.proyectoMiembro.upsert({
          where: {
            proyecto_id_empleado_id: {
              proyecto_id: prj.id,
              empleado_id: t.id,
            },
          },
          update: {},
          create: {
            proyecto_id: prj.id,
            empleado_id: t.id,
            rol: "Técnico",
          },
        });
      }

      // tareas (8 básicas con dependencias encadenadas)
      const baseDay = new Date();
      baseDay.setHours(12, 0, 0, 0);
      let lastEnd = addDays(baseDay, 0);
      const tareasIds = [];

      for (let k = 0; k < TASK_NAMES.length; k++) {
        const start = addDays(lastEnd, 0);
        const dur = 1 + Math.floor(Math.random() * 4);
        const end = addDays(start, dur);
        const estado = pick(ESTADOS_TAREA);
        const avance =
          estado === "completada"
            ? 100
            : estado === "en_progreso"
            ? 30 + Math.floor(Math.random() * 60)
            : 0;
        const responsable = pick(empleadosAll).id;
        const es_hito = k === TASK_NAMES.length - 1;

        const tarea = await prisma.tarea.upsert({
          where: { id: `TASK-${emp.code}-${i}-${k + 1}` },
          update: {},
          create: {
            id: `TASK-${emp.code}-${i}-${k + 1}`,
            proyecto_id: prj.id,
            nombre: TASK_NAMES[k],
            descripcion: `${TASK_NAMES[k]} del proyecto ${prj.nombre}`,
            responsable_id: responsable,
            prioridad: (k % 3) + 1,
            estado,
            avance,
            es_hito,
            orden: k + 1,
            fecha_inicio_plan: start,
            fecha_fin_plan: end,
            dias_plan: daysBetween(start, end),
            fecha_inicio_real:
              Math.random() < 0.6 ? addDays(start, 0) : null,
            fecha_fin_real: Math.random() < 0.4 ? addDays(end, 0) : null,
            dias_reales: null,
          },
        });

        tareasIds.push(tarea.id);
        lastEnd = end;

        if (k > 0) {
          await prisma.tareaDependencia.upsert({
            where: {
              tarea_id_predecesora_id: {
                tarea_id: tarea.id,
                predecesora_id: tareasIds[k - 1],
              },
            },
            update: {},
            create: {
              tarea_id: tarea.id,
              predecesora_id: tareasIds[k - 1],
              tipo: "FS",
            },
          });
        }
      }
    }

    /* ===== Cotizaciones / Compras / Ventas por proyecto ===== */
    for (const prj of proyectos) {
      const cliente = pick(clientes);
      const proveedor = pick(proveedores);

      // Cotización con 2-4 items
      const qItems = [];
      const qCount = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < qCount; j++) {
        const prod = pick(productos);
        const cant = 1 + Math.floor(Math.random() * 5);
        qItems.push({
          producto_id: prod.id,
          cantidad: cant,
          precio_unit: prod.precio,
          total: round2(cant * prod.precio),
        });
      }

      const qTotal = round2(qItems.reduce((s, i) => s + i.total, 0));
      const qNum = `Q-${emp.code}-${
        prj.id.split("-").pop()
      }-${String(Math.floor(Math.random() * 900) + 100)}`;

      const cotizacion = await prisma.cotizacion.upsert({
        where: { numero: qNum },
        update: {},
        create: {
          empresa_id: emp.id,
          proyecto_id: prj.id,
          cliente_id: cliente.id,
          numero: qNum,
          estado: pick(ESTADOS_COT),
          total: qTotal,
          items: { create: qItems },
        },
      });

      // Compra con 1-3 items
      const cItems = [];
      const cCount = 1 + Math.floor(Math.random() * 3);
      for (let j = 0; j < cCount; j++) {
        const prod = pick(productos);
        const cant = 1 + Math.floor(Math.random() * 4);
        const pu = round2(
          prod.precio * (0.7 + Math.random() * 0.4) // 70–110%
        );
        cItems.push({
          producto_id: prod.id,
          cantidad: cant,
          precio_unit: pu,
          total: round2(cant * pu),
        });
      }

      const cTotal = round2(cItems.reduce((s, i) => s + i.total, 0));
      const cNum = `C-${emp.code}-${
        prj.id.split("-").pop()
      }-${String(Math.floor(Math.random() * 900) + 100)}`;

      await prisma.compra.upsert({
        where: { numero: cNum },
        update: {},
        create: {
          empresa_id: emp.id,
          proyecto_id: prj.id,
          proveedor_id: proveedor.id,
          numero: cNum,
          estado: pick(ESTADOS_CMP),
          total: cTotal,
          items: { create: cItems },
        },
      });

      // Venta con 1-4 items
      const vItems = [];
      const vCount = 1 + Math.floor(Math.random() * 4);
      for (let j = 0; j < vCount; j++) {
        const prod = pick(productos);
        const cant = 1 + Math.floor(Math.random() * 6);
        const pu = prod.precio; // precio de lista
        vItems.push({
          producto_id: prod.id,
          cantidad: cant,
          precio_unit: pu,
          total: round2(cant * pu),
        });
      }

      const vTotal = round2(vItems.reduce((s, i) => s + i.total, 0));
      const vNum = `V-${emp.code}-${
        prj.id.split("-").pop()
      }-${String(Math.floor(Math.random() * 900) + 100)}`;

      await prisma.venta.upsert({
        where: { numero: vNum },
        update: {},
        create: {
          empresa_id: emp.id,
          proyecto_id: prj.id,
          cliente_id: cliente.id,
          numero: vNum,
          estado: pick(ESTADOS_VTA),
          total: vTotal,
          cotizacion_id: cotizacion.id, // relación con la cotización
          items: { create: vItems },
        },
      });
    }

    /* ===== Rendiciones ===== */
    for (let r = 0; r < 3; r++) {
      const empleado = pick([empSup, ...empleados]);
      const prj = pick(proyectos);
      const hoy = new Date();

      const items = [
        {
          linea: 1,
          fecha: hoy,
          descripcion: "Combustible",
          monto: 30_000 + Math.floor(Math.random() * 20_000),
          categoria: "Transporte",
        },
        {
          linea: 2,
          fecha: hoy,
          descripcion: "Peajes",
          monto: 5_000 + Math.floor(Math.random() * 10_000),
          categoria: "Transporte",
        },
      ];

      const total = items.reduce((s, it) => s + it.monto, 0);

      await prisma.rendicion.create({
        data: {
          empleado_id: empleado.id,
          proyecto_id: prj.id,
          descripcion: `Gastos de terreno #${r + 1}`,
          monto_total: total,
          estado: pick(["pendiente", "aprobada", "rechazada"]),
          items: { create: items },
        },
      });
    }
  }

  console.log("✅ Seed completado");
}

/* ===================== run ===================== */
main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
