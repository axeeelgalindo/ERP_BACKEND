// prisma/cleanDB.js
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Script para limpiar TODA la BD (hard delete).
 * - Borra hijo -> padre
 * - No revienta si hay tablas que no existen (P2021/P2022)
 */

function shouldIgnoreDeleteError(e) {
  return e?.code === "P2021" || e?.code === "P2022";
}

async function safeDeleteMany(delegateName) {
  const delegate = prisma[delegateName];
  if (!delegate?.deleteMany) return;

  try {
    await delegate.deleteMany();
    console.log(`🧹 deleteMany(${delegateName}) OK`);
  } catch (e) {
    if (shouldIgnoreDeleteError(e)) {
      console.log(
        `⚠️  Skip deleteMany(${delegateName}) -> ${e.code} (${e.meta?.table || "tabla/col no existe"})`
      );
      return;
    }
    throw e;
  }
}

async function main() {
  console.log("🧨 Limpieza total BD (hard delete) ...");

  // =============================
  // HIJO -> PADRE
  // =============================

  // Ventas
  await safeDeleteMany("detalleVenta");
  await safeDeleteMany("venta");

  // Compras
  await safeDeleteMany("compraItem");
  await safeDeleteMany("compra");

  // Cotizaciones
  await safeDeleteMany("cotizacionGlosa");
  await safeDeleteMany("cotizacion");

  // Rendiciones
  await safeDeleteMany("rendicionItem");
  await safeDeleteMany("rendicion");

  // Proyectos / tareas
  await safeDeleteMany("tareaDetalle");
  await safeDeleteMany("tareaDependencia");
  await safeDeleteMany("tarea");
  await safeDeleteMany("proyectoMiembro");
  await safeDeleteMany("proyecto");

  // HH
  await safeDeleteMany("hHEmpleado");

  // ✅ CIF (si ya existe)
  await safeDeleteMany("cIF");

  // Personas base
  await safeDeleteMany("empleado");
  await safeDeleteMany("usuario");
  await safeDeleteMany("rolUsuario");

  // Maestros
  await safeDeleteMany("producto");
  await safeDeleteMany("proveedor");
  await safeDeleteMany("cliente");

  // Catálogos
  await safeDeleteMany("tipoItem");
  await safeDeleteMany("tipoDia");
  await safeDeleteMany("unidadItem");

  await safeDeleteMany("aFPConfig");
  await safeDeleteMany("saludConfig");

  await safeDeleteMany("auditLog");
  await safeDeleteMany("empresa");

  console.log("✅ BD limpia.");
}

main()
  .catch((e) => {
    console.error("❌ Error limpiando BD:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
