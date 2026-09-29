import { PrismaClient } from '@prisma/client';
import { calcularSaldoEmpleado } from '../empleados/vacaciones.controllers.js';

const prisma = new PrismaClient();

/**
 * 📋 LISTADO OFICIAL EXTRAÍDO DE LAS IMÁGENES DEL EXCEL
 * - Imagen 1: Saldo disponible columna "agosto"
 * - Imagen 2: Sucursal (SUC), RUT y Nombre
 */
export const COLABORADORES_EXCEL_AGOSTO = [
  {
    orden: 1,
    suc: 'PUX',
    sede: 'PMC',
    rut: '13546949-1',
    rut_limpio: '135469491',
    nombre: 'Carreño Sandoval Janet Andrea',
    saldo_agosto: 45.29,
  },
  {
    orden: 2,
    suc: 'PUX',
    sede: 'PMC',
    rut: '20292476-K',
    rut_limpio: '20292476K',
    nombre: 'Contreras Marin Derbin Alexander',
    saldo_agosto: 22.50,
  },
  {
    orden: 3,
    suc: 'PUX',
    sede: 'PMC',
    rut: '19399868-2',
    rut_limpio: '193998682',
    nombre: 'Esteban Alejandro Barria',
    saldo_agosto: 14.25,
  },
  {
    orden: 4,
    suc: 'PUX',
    sede: 'PMC',
    rut: '19962629-9',
    rut_limpio: '199626299',
    nombre: 'Camila Nahuelcar',
    saldo_agosto: 1.25,
  },
  {
    orden: 5,
    suc: 'PUX',
    sede: 'PMC',
    rut: '21166343-k',
    rut_limpio: '21166343K',
    nombre: 'Axel Galindo',
    saldo_agosto: 11.50,
  },
  {
    orden: 6,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '21981450-k',
    rut_limpio: '21981450K',
    nombre: 'Nicolas Cifuentes',
    saldo_agosto: 7.40,
  },
  {
    orden: 7,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '16934832-4',
    rut_limpio: '169348324',
    nombre: 'Navarro Maldonado Luis Alfredo',
    saldo_agosto: 21.31,
  },
  {
    orden: 8,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '14229721-3',
    rut_limpio: '142297213',
    nombre: 'Catepillan Lavignanza Luis Mauricio',
    saldo_agosto: 16.64,
  },
  {
    orden: 9,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '13621155-2',
    rut_limpio: '136211552',
    nombre: 'Sanhueza Barrera Harry Cristian',
    saldo_agosto: 19.46,
  },
  {
    orden: 10,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '10015808-6',
    rut_limpio: '100158086',
    nombre: 'Soto Concha Marco Aurelio',
    saldo_agosto: 25.03,
  },
  {
    orden: 11,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '10666073-5',
    rut_limpio: '106660735',
    nombre: 'Navarro Azpilcueta Gustavo Javier',
    saldo_agosto: 8.39,
  },
  {
    orden: 12,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '18208420-4',
    rut_limpio: '182084204',
    nombre: 'Aguayo Canales Jonathan Efrain',
    saldo_agosto: 60.20,
  },
  {
    orden: 13,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '15077676-7',
    rut_limpio: '150776767',
    nombre: 'Calvo Olivares Cristian Mauricio',
    saldo_agosto: 20.47,
  },
  {
    orden: 14,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '18550075-6',
    rut_limpio: '185500756',
    nombre: 'Mandujano Salas Marcelo Ignacio',
    saldo_agosto: 10.16,
  },
  {
    orden: 15,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '20180119-2',
    rut_limpio: '201801192',
    nombre: 'Oyaneder Ponce-Hille Eduardo Arturo',
    saldo_agosto: 18.89,
  },
  {
    orden: 16,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '15279416-9',
    rut_limpio: '152794169',
    nombre: 'Sanchez Sanchez Pamela De Lourdes',
    saldo_agosto: 0.58,
  },
  {
    orden: 17,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '20396564-8',
    rut_limpio: '203965648',
    nombre: 'Joshua Maripan',
    saldo_agosto: -1.94,
  },
  {
    orden: 18,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '1190065197', // 19.006.519-7
    rut_limpio: '190065197',
    nombre: 'Williams Natanahel Dias Morales',
    saldo_agosto: 4.02,
  },
  {
    orden: 19,
    suc: 'PUQ',
    sede: 'PUQ',
    rut: '17.720.329-7',
    rut_limpio: '177203297',
    nombre: 'Luis Jonathan Garcia Perez',
    saldo_agosto: 8.69,
  },
];

async function main() {
  console.log('========================================================================================');
  console.log('🔄 INICIANDO SINCRONIZACIÓN Y VALIDACIÓN EXACTA DE SALDOS DE VACACIONES A AGOSTO 2026');
  console.log('========================================================================================\n');

  // 1. Eliminar TODO el registro de vacaciones de todos para hacerlo cuadrar limpiamente
  console.log('🗑️  Paso 1: Eliminando registros históricos anteriores de vacaciones (EmpleadoVacacion)...');
  const deleteResult = await prisma.empleadoVacacion.deleteMany({});
  console.log(`   ✅ Eliminados ${deleteResult.count} registros de vacaciones previos.`);

  // 2. Obtener lista de empleados en base de datos
  const empleadosDB = await prisma.empleado.findMany({
    include: {
      usuario: true,
      vacaciones: true,
    },
  });

  const fechaBase = new Date('2026-08-31T23:59:59.000Z');
  let exitosos = 0;
  let fallidos = 0;

  console.log('\n📝 Paso 2: Actualizando sucursales y saldos base consolidados en cada colaborador...');
  for (const item of COLABORADORES_EXCEL_AGOSTO) {
    const empleado = empleadosDB.find((e) => {
      const cleanDB = (e.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
      const cleanItem = item.rut_limpio.toUpperCase();
      if (cleanDB && cleanItem) {
        if (cleanDB === cleanItem) return true;
        if (cleanDB.includes(cleanItem) || cleanItem.includes(cleanDB)) return true;
      }
    });

    if (!empleado) {
      console.error(`❌ Colaborador NO encontrado en BD: RUT ${item.rut} - ${item.nombre}`);
      fallidos++;
      continue;
    }

    // Actualizar empleado con sucursal (sede) y saldo base exacto del Excel
    await prisma.empleado.update({
      where: { id: empleado.id },
      data: {
        sede: item.sede,
        saldo_vacaciones_base: item.saldo_agosto,
        fecha_base_vacaciones: fechaBase,
      },
    });
  }

  // 3. Validación matemática de cada persona
  console.log('\n🔍 Paso 3: Validación matemática de saldos en el sistema:\n');
  console.log(
    '#'.padEnd(4) +
    'SUC'.padEnd(6) +
    'RUT'.padEnd(15) +
    'COLABORADOR'.padEnd(36) +
    'SEDE ERP'.padEnd(12) +
    'TASA'.padEnd(10) +
    'EXCEL'.padEnd(10) +
    'SISTEMA'.padEnd(10) +
    'ESTADO'
  );
  console.log('-'.repeat(108));

  // Volver a consultar la BD actualizada
  const empleadosActualizados = await prisma.empleado.findMany({
    include: {
      usuario: true,
      vacaciones: true,
    },
  });

  for (const item of COLABORADORES_EXCEL_AGOSTO) {
    const emp = empleadosActualizados.find((e) => {
      const cleanDB = (e.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
      const cleanItem = item.rut_limpio.toUpperCase();
      if (cleanDB && cleanItem) {
        if (cleanDB === cleanItem) return true;
        if (cleanDB.includes(cleanItem) || cleanItem.includes(cleanDB)) return true;
      }
    });

    if (!emp) {
      console.log(`${String(item.orden).padEnd(4)}${item.suc.padEnd(6)}${item.rut.padEnd(15)}${item.nombre.padEnd(36)} NO ENCONTRADO ❌`);
      fallidos++;
      continue;
    }

    // Calcular saldo actual usando la función oficial del backend
    const calc = calcularSaldoEmpleado(emp, new Date());
    const coincide = Math.abs(calc.saldo_disponible - item.saldo_agosto) < 0.001;

    if (coincide) {
      exitosos++;
    } else {
      fallidos++;
    }

    const tasaStr = `${calc.tasa_mensual} d/m`;
    const excelStr = `${item.saldo_agosto.toFixed(2)} d`;
    const sistStr = `${calc.saldo_disponible.toFixed(2)} d`;
    const estadoStr = coincide ? '✅ OK' : '❌ DISCREPANCIA';

    console.log(
      String(item.orden).padEnd(4) +
      item.suc.padEnd(6) +
      (emp.rut || item.rut).padEnd(15) +
      (emp.usuario?.nombre || item.nombre).slice(0, 34).padEnd(36) +
      (emp.sede || 'PMC').padEnd(12) +
      tasaStr.padEnd(10) +
      excelStr.padEnd(10) +
      sistStr.padEnd(10) +
      estadoStr
    );
  }

  console.log('\n========================================================================================');
  if (fallidos === 0) {
    console.log(`🎉 VALIDACIÓN 100% EXITOSA: Los ${exitosos} colaboradores cuadran EXACTAMENTE con el Excel.`);
  } else {
    console.log(`⚠️ VALIDACIÓN COMPLETADA: ${exitosos} exitosos, ${fallidos} fallidos.`);
  }
  console.log('========================================================================================\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
