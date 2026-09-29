import { PrismaClient } from '@prisma/client';
import { calcularDevengoVacaciones } from '../empleados/vacaciones.controllers.js';

const prisma = new PrismaClient();

export const EMPLEADOS_PLANILLA_AGOSTO_2026 = [
  {
    rut: '13.546.949-1',
    nombre: 'Carreño Sandoval, Janet Andrea',
    cargo: 'Control de Gestión',
    sede: 'PMC',
    fecha_ingreso: '2022-07-01',
    saldo_enero_2025: 20.58,
    saldo_agosto_2026: 45.29,
  },
  {
    rut: '20.292.476-K',
    nombre: 'Contreras Marin, Derbin Alexander',
    cargo: 'Ingeniero Informático',
    sede: 'PMC',
    fecha_ingreso: '2024-10-21',
    saldo_enero_2025: 1.25,
    saldo_agosto_2026: 22.50,
  },
  {
    rut: '19.399.868-2',
    nombre: 'Barria Orellana, Esteban Alejandro',
    cargo: 'Encargado de Gestión',
    sede: 'PMC',
    fecha_ingreso: '2025-03-10',
    saldo_enero_2025: 0.00,
    saldo_agosto_2026: 14.25,
  },
  {
    rut: '19.962.629-9',
    nombre: 'Nahuelcar Godoy, Camila Alejandra',
    cargo: 'Contadora',
    sede: 'PMC',
    fecha_ingreso: '2025-03-10',
    saldo_enero_2025: 0.00,
    saldo_agosto_2026: 1.25,
  },
  {
    rut: '21.166.343-K',
    nombre: 'Delgado Galindo, Axel Nicolas',
    cargo: 'Ingeniero Informático',
    sede: 'PMC',
    fecha_ingreso: '2025-06-09',
    saldo_enero_2025: 0.00,
    saldo_agosto_2026: 11.50,
  },
  {
    rut: '21.981.450-K',
    nombre: 'Cifuentes Soto, Nicolas Alejandro',
    cargo: 'Soldador y Ayudante de Taller',
    sede: 'PUQ',
    fecha_ingreso: '2025-01-11',
    saldo_enero_2025: 1.67,
    saldo_agosto_2026: 7.40,
  },
  {
    rut: '16.934.832-4',
    nombre: 'Navarro Maldonado, Luis Alfredo',
    cargo: 'Jefe en Terreno / Soldador',
    sede: 'PUQ',
    fecha_ingreso: '2020-05-04',
    saldo_enero_2025: 3.30,
    saldo_agosto_2026: 21.31,
  },
  {
    rut: '14.229.721-3',
    nombre: 'Catepillan Lavignanza, Luis Mauricio',
    cargo: 'Soldador',
    sede: 'PUQ',
    fecha_ingreso: '2020-07-10',
    saldo_enero_2025: 21.63,
    saldo_agosto_2026: 16.64,
  },
  {
    rut: '13.621.155-2',
    nombre: 'Sanhueza Barrera, Harry Cristian',
    cargo: 'Jefe de Máquinas / Técnico Terreno',
    sede: 'PUQ',
    fecha_ingreso: '2020-11-01',
    saldo_enero_2025: 26.45,
    saldo_agosto_2026: 19.46,
  },
  {
    rut: '10.015.808-6',
    nombre: 'Soto Concha, Marco Aurelio',
    cargo: 'Ayudante de Soldador',
    sede: 'PUQ',
    fecha_ingreso: '2020-11-07',
    saldo_enero_2025: 31.07,
    saldo_agosto_2026: 25.03,
  },
  {
    rut: '10.666.073-5',
    nombre: 'Navarro Azpilcueta, Gustavo Javier',
    cargo: 'Jefe de Taller / Tornero',
    sede: 'PUQ',
    fecha_ingreso: '2021-03-15',
    saldo_enero_2025: 36.03,
    saldo_agosto_2026: 8.39,
  },
  {
    rut: '18.208.420-4',
    nombre: 'Aguayo Canales, Jonathan Efrain',
    cargo: 'Jefe / Coordinador de Operaciones',
    sede: 'PUQ',
    fecha_ingreso: '2021-06-07',
    saldo_enero_2025: 35.47,
    saldo_agosto_2026: 60.20,
  },
  {
    rut: '15.077.676-7',
    nombre: 'Calvo Olivares, Cristian Mauricio',
    cargo: 'Soldador',
    sede: 'PUQ',
    fecha_ingreso: '2021-08-01',
    saldo_enero_2025: 7.46,
    saldo_agosto_2026: 20.47,
  },
  {
    rut: '18.550.075-6',
    nombre: 'Mandujano Salas, Marcelo Ignacio',
    cargo: 'Diseñador / Ayudante de Taller',
    sede: 'PUQ',
    fecha_ingreso: '2023-02-02',
    saldo_enero_2025: 18.13,
    saldo_agosto_2026: 10.16,
  },
  {
    rut: '20.180.119-2',
    nombre: 'Oyaneder Ponce-Hille, Eduardo Arturo',
    cargo: 'Técnico',
    sede: 'PUQ',
    fecha_ingreso: '2024-04-23',
    saldo_enero_2025: 13.92,
    saldo_agosto_2026: 18.89,
  },
  {
    rut: '15.279.416-9',
    nombre: 'Sanchez Sanchez, Pamela de Lourdes',
    cargo: 'Administrativo',
    sede: 'PUQ',
    fecha_ingreso: '2024-09-23',
    saldo_enero_2025: 5.57,
    saldo_agosto_2026: 0.58,
  },
  {
    rut: '20.396.564-8',
    nombre: 'Maripan Anabalon, Joshua Enrique',
    cargo: 'Técnico en Terreno',
    sede: 'PUQ',
    fecha_ingreso: '2025-01-20',
    saldo_enero_2025: 0.00,
    saldo_agosto_2026: -1.94,
  },
  {
    rut: '19.006.519-7',
    nombre: 'Dias Morales, Williams Natanahel',
    cargo: 'Tornero',
    sede: 'PUQ',
    fecha_ingreso: '2026-02-02',
    saldo_enero_2025: 0.00,
    saldo_agosto_2026: 4.02,
  },
  {
    rut: '17.720.329-7',
    nombre: 'Garcia Perez, Luis Jonathan',
    cargo: 'Técnico Eléctrico',
    sede: 'PUQ',
    fecha_ingreso: '2026-01-22',
    saldo_enero_2025: 0.00,
    saldo_agosto_2026: 8.69,
  },
];

async function main() {
  console.log('========================================================================');
  console.log('🔄 ACTUALIZACIÓN AUTOMÁTICA DE SALDOS DE VACACIONES A AGOSTO 2026');
  console.log('========================================================================\n');

  const fechaCorteAgosto = new Date('2026-08-31T23:59:59.000Z');
  let actualizados = 0;
  let errores = 0;

  // Cargar todos los empleados con sus vacaciones
  const empleadosDB = await prisma.empleado.findMany({
    include: {
      usuario: true,
      vacaciones: true,
    },
  });

  for (const empData of EMPLEADOS_PLANILLA_AGOSTO_2026) {
    try {
      const cleanTargetRut = empData.rut.replace(/[^0-9kK]/g, '').toUpperCase();
      const empleado = empleadosDB.find(
        (e) => (e.rut || '').replace(/[^0-9kK]/g, '').toUpperCase() === cleanTargetRut
      );

      if (!empleado) {
        console.error(`❌ No encontrado en base de datos: ${empData.rut} - ${empData.nombre}`);
        errores++;
        continue;
      }

      // 1. Actualizar Sede y Fecha de Ingreso en la ficha del empleado
      const fechaIngresoDate = new Date(`${empData.fecha_ingreso}T00:00:00.000Z`);
      await prisma.empleado.update({
        where: { id: empleado.id },
        data: {
          sede: empData.sede,
          fecha_ingreso: fechaIngresoDate,
          ...(empData.cargo ? { cargo: empData.cargo } : {}),
        },
      });

      // 2. Calcular devengo acumulado histórico a 31 de Agosto 2026
      const dev = calcularDevengoVacaciones(fechaIngresoDate, empData.sede, fechaCorteAgosto);

      // 3. Revisar vacaciones tomadas previamente antes de Agosto 31 (excluyendo ajustes)
      const vacacionesPrevias = empleado.vacaciones.filter((v) => {
        if (v.estado === 'CANCELADO' || v.estado === 'AJUSTE') return false;
        const dFin = new Date(v.hasta);
        return dFin <= fechaCorteAgosto;
      });

      const diasPrevios = vacacionesPrevias.reduce((acc, v) => acc + (Number(v.dias) || 0), 0);

      // 4. Calcular los días de AJUSTE requeridos para que el saldo neto a Agosto 2026 sea EXACTO
      // Saldo = Devengados - (DiasPrevios + Ajuste) => Ajuste = Devengados - SaldoPlanilla - DiasPrevios
      const diasAjuste = Math.round((dev.dias_acumulados - empData.saldo_agosto_2026 - diasPrevios) * 100) / 100;

      // 5. Buscar si ya existe un registro de AJUSTE histórico a Agosto 2026
      const ajusteExistente = empleado.vacaciones.find(
        (v) => v.estado === 'AJUSTE' && (v.detalle || '').includes('Agosto 2026')
      );

      if (ajusteExistente) {
        await prisma.empleadoVacacion.update({
          where: { id: ajusteExistente.id },
          data: {
            dias: diasAjuste,
            desde: new Date('2026-08-31T00:00:00.000Z'),
            hasta: new Date('2026-08-31T23:59:59.000Z'),
            detalle: 'Ajuste inicial histórico consolidado al 31 de Agosto 2026 según planilla oficial de RRHH',
          },
        });
      } else {
        await prisma.empleadoVacacion.create({
          data: {
            empleado_id: empleado.id,
            desde: new Date('2026-08-31T00:00:00.000Z'),
            hasta: new Date('2026-08-31T23:59:59.000Z'),
            dias: diasAjuste,
            estado: 'AJUSTE',
            detalle: 'Ajuste inicial histórico consolidado al 31 de Agosto 2026 según planilla oficial de RRHH',
          },
        });
      }

      // 6. Verificación matemática exacta
      const saldoFinal = Math.round((dev.dias_acumulados - diasPrevios - diasAjuste) * 100) / 100;
      const ok = Math.abs(saldoFinal - empData.saldo_agosto_2026) < 0.001;

      const sucursalTexto = empData.sede === 'PUQ' ? 'Punta Arenas (PUQ, 1.67 d/m)' : 'Puerto Montt (PMC, 1.25 d/m)';
      console.log(
        `${ok ? '✅' : '⚠️'} ${empData.rut.padEnd(13)} | ${empData.nombre.padEnd(35)} | ${sucursalTexto.padEnd(30)} | Ingreso: ${empData.fecha_ingreso} | Saldo Ago: ${String(saldoFinal.toFixed(2)).padStart(6)} (Planilla: ${empData.saldo_agosto_2026.toFixed(2)})`
      );

      actualizados++;
    } catch (err) {
      console.error(`❌ Error procesando ${empData.rut}:`, err);
      errores++;
    }
  }

  console.log('\n========================================================================');
  console.log(`🎉 PROCESO COMPLETADO: ${actualizados} empleados actualizados | ${errores} errores`);
  console.log('========================================================================');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
