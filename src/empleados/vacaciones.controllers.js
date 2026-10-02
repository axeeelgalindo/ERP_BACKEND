import { PrismaClient } from "@prisma/client";
import { calcularDiasHabilesVacaciones } from "../utils/diasHabiles.js";

const prisma = new PrismaClient();

/**
 * Calcula los días de vacaciones acumulados desde la fecha de ingreso
 * @param {Date|string} fechaIngreso 
 * @param {string} sede "PMC" | "PUQ"
 * @param {Date} [fechaCorte=new Date()]
 */
export function calcularDevengoVacaciones(fechaIngreso, sede, fechaCorte = new Date()) {
  const tasaMensual = String(sede || "PMC").toUpperCase() === "PUQ" ? 1.67 : 1.25;

  if (!fechaIngreso) {
    return {
      meses_trabajados: 0,
      tasa_mensual: tasaMensual,
      dias_acumulados: 0,
    };
  }

  const ingreso = new Date(fechaIngreso);
  const corte = new Date(fechaCorte);

  if (isNaN(ingreso.getTime()) || ingreso > corte) {
    return {
      meses_trabajados: 0,
      tasa_mensual: tasaMensual,
      dias_acumulados: 0,
    };
  }

  let years = corte.getFullYear() - ingreso.getFullYear();
  let months = corte.getMonth() - ingreso.getMonth();
  let days = corte.getDate() - ingreso.getDate();

  if (days < 0) {
    months -= 1;
    const prevMonthDays = new Date(corte.getFullYear(), corte.getMonth(), 0).getDate();
    days += prevMonthDays;
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const totalMesesCompletos = years * 12 + months;
  const fraccionMes = Math.min(1, Math.max(0, days / 30));
  const totalMeses = totalMesesCompletos + fraccionMes;

  const diasAcumulados = Math.round(totalMeses * tasaMensual * 100) / 100;

  return {
    meses_trabajados: Math.round(totalMeses * 10) / 10,
    tasa_mensual: tasaMensual,
    dias_acumulados: diasAcumulados,
  };
}

/**
 * Calcula el saldo de vacaciones considerando el saldo base sincronizado si existe,
 * devengos posteriores por sede (PMC 1.25 / PUQ 1.67) y vacaciones tomadas posteriores a la fecha base.
 */
export function calcularSaldoEmpleado(empleado, fechaCorteCalc = new Date()) {
  const tasaMensual = String(empleado?.sede || "PMC").toUpperCase() === "PUQ" ? 1.67 : 1.25;

  if (
    empleado?.saldo_vacaciones_base !== null &&
    empleado?.saldo_vacaciones_base !== undefined &&
    empleado?.fecha_base_vacaciones
  ) {
    const fechaBase = new Date(empleado.fecha_base_vacaciones);
    const baseDias = Number(empleado.saldo_vacaciones_base) || 0;

    // Devengo adicional posterior a la fecha base (meses completos cerrados transcurridos)
    let mesesPostBase = 0;
    if (fechaCorteCalc > fechaBase) {
      let diffMeses = (fechaCorteCalc.getFullYear() - fechaBase.getFullYear()) * 12 + (fechaCorteCalc.getMonth() - fechaBase.getMonth());
      const ultimoDiaMesCorte = new Date(fechaCorteCalc.getFullYear(), fechaCorteCalc.getMonth() + 1, 0).getDate();
      if (fechaCorteCalc.getDate() < ultimoDiaMesCorte) {
        diffMeses -= 1;
      }
      mesesPostBase = Math.max(0, diffMeses);
    }
    const devengoPostBase = Math.round(mesesPostBase * tasaMensual * 100) / 100;

    const diasAcumulados = Math.round((baseDias + devengoPostBase) * 100) / 100;

    // Vacaciones tomadas POSTERIORES a la fecha base (excluyendo canceladas)
    const vacacionesTomadas = (empleado.vacaciones || []).filter((v) => {
      if (v.estado === "CANCELADO") return false;
      const dDesde = new Date(v.desde);
      return dDesde > fechaBase && dDesde <= fechaCorteCalc;
    });

    const diasTomados = Math.round(
      vacacionesTomadas.reduce((acc, v) => acc + (Number(v.dias) || 0), 0) * 100
    ) / 100;

    const saldoDisponible = Math.round((diasAcumulados - diasTomados) * 100) / 100;

    const devAntiguedad = empleado.fecha_ingreso
      ? calcularDevengoVacaciones(empleado.fecha_ingreso, empleado.sede, fechaCorteCalc)
      : { meses_trabajados: 0 };

    return {
      tasa_mensual: tasaMensual,
      meses_trabajados: devAntiguedad.meses_trabajados,
      dias_acumulados: diasAcumulados,
      dias_tomados: diasTomados,
      saldo_disponible: saldoDisponible,
      saldo_vacaciones_base: baseDias,
      fecha_base_vacaciones: empleado.fecha_base_vacaciones,
    };
  }

  // Fallback si no tiene saldo base configurado
  const dev = calcularDevengoVacaciones(empleado?.fecha_ingreso, empleado?.sede, fechaCorteCalc);
  const tomados = (empleado?.vacaciones || [])
    .filter((v) => v.estado !== "CANCELADO" && new Date(v.desde) <= fechaCorteCalc)
    .reduce((acc, v) => acc + (Number(v.dias) || 0), 0);
  const saldo = Math.round((dev.dias_acumulados - tomados) * 100) / 100;

  return {
    tasa_mensual: dev.tasa_mensual,
    meses_trabajados: dev.meses_trabajados,
    dias_acumulados: dev.dias_acumulados,
    dias_tomados: Math.round(tomados * 100) / 100,
    saldo_disponible: saldo,
    saldo_vacaciones_base: null,
    fecha_base_vacaciones: null,
  };
}

/**
 * Obtiene el resumen de vacaciones y el historial de un empleado
 */
export async function getEmpleadoVacaciones(request, reply) {
  const { id } = request.params;
  const { ano, mes, hasta } = request.query || {};

  const empleado = await prisma.empleado.findUnique({
    where: { id },
    include: {
      usuario: { select: { id: true, nombre: true, correo: true, rol: true } },
      vacaciones: {
        orderBy: { desde: "desc" },
      },
    },
  });

  if (!empleado) {
    return reply.status(404).send({ error: "Empleado no encontrado" });
  }

  // 🔄 Auto-sync: Registrar en EmpleadoVacacion días de Asistencia con VACACIONES
  // Solo sincronizar asistencias POSTERIORES a fecha_base_vacaciones (para no duplicar días históricos ya consolidados en el saldo base)
  const whereAsis = {
    empleado_id: id,
    estado: "VACACIONES",
  };
  if (empleado.fecha_base_vacaciones) {
    whereAsis.fecha = { gt: empleado.fecha_base_vacaciones };
  }

  const asistenciasVacaciones = await prisma.asistencia.findMany({
    where: whereAsis,
  });

  for (const asis of asistenciasVacaciones) {
    const asisDateStr = asis.fecha.toISOString().split("T")[0];
    const yaCubierto = empleado.vacaciones.some((v) => {
      if (v.estado === "CANCELADO") return false;
      const dStr = v.desde.toISOString().split("T")[0];
      const hStr = v.hasta.toISOString().split("T")[0];
      return dStr <= asisDateStr && hStr >= asisDateStr;
    });

    if (!yaCubierto) {
      const nueva = await prisma.empleadoVacacion.create({
        data: {
          empleado_id: id,
          desde: asis.fecha,
          hasta: asis.fecha,
          dias: 1,
          estado: "CONFIRMADO",
          detalle: asis.observacion ? `Asistencia: ${asis.observacion}` : "Registrado desde Asistencia",
        },
      });
      empleado.vacaciones.push(nueva);
    }
  }

  // Mantener orden cronológico descendente
  empleado.vacaciones.sort((a, b) => new Date(b.desde) - new Date(a.desde));

  let fechaCorteCalc = new Date();
  if (hasta) {
    fechaCorteCalc = new Date(hasta + (hasta.includes("T") ? "" : "T23:59:59.999Z"));
  } else if (ano && mes) {
    fechaCorteCalc = new Date(Date.UTC(Number(ano), Number(mes), 0, 23, 59, 59, 999));
  }

  const calculo = calcularSaldoEmpleado(empleado, fechaCorteCalc);

  return reply.send({
    empleado_id: empleado.id,
    nombre: empleado.usuario?.nombre || "Sin Nombre",
    rut: empleado.rut,
    cargo: empleado.cargo,
    sede: empleado.sede || "PMC",
    fecha_ingreso: empleado.fecha_ingreso,
    tasa_mensual: calculo.tasa_mensual,
    meses_trabajados: calculo.meses_trabajados,
    dias_acumulados: calculo.dias_acumulados,
    dias_tomados: calculo.dias_tomados,
    saldo_disponible: calculo.saldo_disponible,
    saldo_vacaciones_base: calculo.saldo_vacaciones_base,
    fecha_base_vacaciones: calculo.fecha_base_vacaciones,
    vacaciones: empleado.vacaciones,
  });
}

/**
 * Registra un nuevo periodo de vacaciones para un empleado
 */
export async function createEmpleadoVacacion(request, reply) {
  const { id } = request.params;
  const { desde, hasta, dias, estado = "CONFIRMADO", detalle } = request.body || {};

  if (!desde || !hasta) {
    return reply.status(400).send({ error: "Debes especificar fecha de inicio y fin" });
  }

  let numDias = Number(dias);
  if (isNaN(numDias) || numDias <= 0) {
    const calc = calcularDiasHabilesVacaciones(desde, hasta);
    numDias = calc.diasHabiles;
  }

  if (isNaN(numDias) || numDias <= 0) {
    return reply.status(400).send({ error: "El rango seleccionado no contiene días hábiles válidos" });
  }

  const empleado = await prisma.empleado.findUnique({
    where: { id },
    include: {
      usuario: { select: { id: true, nombre: true, correo: true } },
      vacaciones: {
        where: { estado: { not: "CANCELADO" } },
      },
    },
  });

  if (!empleado) {
    return reply.status(404).send({ error: "Empleado no encontrado" });
  }

  const saldoAnterior = calcularSaldoEmpleado(empleado).saldo_disponible;
  const saldoPendiente = Math.round((saldoAnterior - (estado === "CANCELADO" ? 0 : numDias)) * 100) / 100;

  const nueva = await prisma.empleadoVacacion.create({
    data: {
      empleado_id: id,
      desde: new Date(desde),
      hasta: new Date(hasta),
      dias: numDias,
      estado: estado || "CONFIRMADO",
      detalle: detalle ? String(detalle).trim() : null,
    },
  });

  return reply.status(201).send({
    ...nueva,
    saldo_anterior: saldoAnterior,
    saldo_pendiente: saldoPendiente,
    empleado: {
      id: empleado.id,
      nombre: empleado.usuario?.nombre || "Sin Nombre",
      rut: empleado.rut,
      cargo: empleado.cargo,
      sede: empleado.sede || "PMC",
      fecha_ingreso: empleado.fecha_ingreso,
    },
  });
}

/**
 * Actualiza un registro de vacaciones
 */
export async function updateEmpleadoVacacion(request, reply) {
  const { vacacionId } = request.params;
  const { desde, hasta, dias, estado, detalle } = request.body || {};

  const existing = await prisma.empleadoVacacion.findUnique({
    where: { id: vacacionId },
  });

  if (!existing) {
    return reply.status(404).send({ error: "Registro de vacación no encontrado" });
  }

  const dataToUpdate = {};
  if (desde) dataToUpdate.desde = new Date(desde);
  if (hasta) dataToUpdate.hasta = new Date(hasta);
  if (dias !== undefined) dataToUpdate.dias = Number(dias);
  if (estado) dataToUpdate.estado = estado;
  if (detalle !== undefined) dataToUpdate.detalle = detalle ? String(detalle).trim() : null;

  const updated = await prisma.empleadoVacacion.update({
    where: { id: vacacionId },
    data: dataToUpdate,
  });

  return reply.send(updated);
}

/**
 * Elimina un registro de vacaciones
 */
export async function deleteEmpleadoVacacion(request, reply) {
  const { vacacionId } = request.params;

  const existing = await prisma.empleadoVacacion.findUnique({
    where: { id: vacacionId },
  });

  if (!existing) {
    return reply.status(404).send({ error: "Registro de vacación no encontrado" });
  }

  // Si fue registrado desde Asistencia, sincronizar la Asistencia de ese día a AUSENTE
  if (existing.detalle && existing.detalle.includes("Asistencia")) {
    await prisma.asistencia.updateMany({
      where: {
        empleado_id: existing.empleado_id,
        fecha: existing.desde,
        estado: "VACACIONES",
      },
      data: {
        estado: "AUSENTE",
      },
    });
  }

  await prisma.empleadoVacacion.delete({
    where: { id: vacacionId },
  });

  return reply.send({ ok: true, message: "Vacación eliminada correctamente" });
}

/**
 * Reporte general de vacaciones de toda la empresa
 */
export async function listGeneralVacaciones(request, reply) {
  const { ano, mes, desde, hasta, sede, empleado_id, q, estado } = request.query || {};

  const whereEmpleado = {
    eliminado: false,
    activo: true,
  };

  if (sede) {
    whereEmpleado.sede = sede;
  }

  if (empleado_id) {
    whereEmpleado.id = empleado_id;
  }

  if (q) {
    whereEmpleado.OR = [
      { rut: { contains: q, mode: "insensitive" } },
      { cargo: { contains: q, mode: "insensitive" } },
      { usuario: { nombre: { contains: q, mode: "insensitive" } } },
    ];
  }

  const empleados = await prisma.empleado.findMany({
    where: whereEmpleado,
    include: {
      usuario: { select: { id: true, nombre: true, correo: true } },
      vacaciones: {
        orderBy: { desde: "desc" },
      },
    },
    orderBy: {
      usuario: { nombre: "asc" },
    },
  });

  // Consolidar saldos y filtrar vacaciones si se pide por año/mes/rango
  let fechaCorteCalc = new Date();
  if (hasta) {
    fechaCorteCalc = new Date(hasta + (hasta.includes("T") ? "" : "T23:59:59.999Z"));
  } else if (ano && mes) {
    fechaCorteCalc = new Date(Date.UTC(Number(ano), Number(mes), 0, 23, 59, 59, 999));
  } else if (ano) {
    const currentYear = new Date().getFullYear();
    if (Number(ano) === currentYear) {
      fechaCorteCalc = new Date();
    } else {
      fechaCorteCalc = new Date(Date.UTC(Number(ano), 11, 31, 23, 59, 59, 999));
    }
  }

  const resumenSaldos = [];
  const todasLasVacaciones = [];

  for (const emp of empleados) {
    const calc = calcularSaldoEmpleado(emp, fechaCorteCalc);

    resumenSaldos.push({
      empleado_id: emp.id,
      nombre: emp.usuario?.nombre || "Sin Nombre",
      rut: emp.rut || "-",
      cargo: emp.cargo || "-",
      sede: emp.sede || "PMC",
      fecha_ingreso: emp.fecha_ingreso,
      tasa_mensual: calc.tasa_mensual,
      meses_trabajados: calc.meses_trabajados,
      dias_acumulados: calc.dias_acumulados,
      dias_tomados: calc.dias_tomados,
      saldo_disponible: calc.saldo_disponible,
      saldo_vacaciones_base: calc.saldo_vacaciones_base,
      fecha_base_vacaciones: calc.fecha_base_vacaciones,
      total_periodos: emp.vacaciones.length,
    });

    for (const vac of emp.vacaciones) {
      if (estado && vac.estado !== estado) continue;

      const dDesde = new Date(vac.desde);
      const dHasta = new Date(vac.hasta);
      const vacAno = dDesde.getFullYear();
      const vacMes = dDesde.getMonth() + 1; // 1-12

      // 1. Filtro por rango personalizado desde / hasta
      if (desde) {
        const fDesde = new Date(desde + (desde.includes("T") ? "" : "T00:00:00.000Z"));
        if (dHasta < fDesde) continue;
      }
      if (hasta) {
        const fHasta = new Date(hasta + (hasta.includes("T") ? "" : "T23:59:59.999Z"));
        if (dDesde > fHasta) continue;
      }

      // 2. Si no hay rango explícito, verificar por año / mes
      if (!desde && !hasta) {
        if (ano && mes) {
          const anoNum = Number(ano);
          const mesNum = Number(mes);
          const startOfMonth = new Date(Date.UTC(anoNum, mesNum - 1, 1, 0, 0, 0));
          const endOfMonth = new Date(Date.UTC(anoNum, mesNum, 0, 23, 59, 59, 999));
          if (dHasta < startOfMonth || dDesde > endOfMonth) continue;
        } else if (ano) {
          const anoNum = Number(ano);
          const startOfYear = new Date(Date.UTC(anoNum, 0, 1, 0, 0, 0));
          const endOfYear = new Date(Date.UTC(anoNum, 11, 31, 23, 59, 59, 999));
          if (dHasta < startOfYear || dDesde > endOfYear) continue;
        } else if (mes) {
          if (vacMes !== Number(mes)) continue;
        }
      }

      todasLasVacaciones.push({
        id: vac.id,
        empleado_id: emp.id,
        nombre: emp.usuario?.nombre || "Sin Nombre",
        rut: emp.rut || "-",
        cargo: emp.cargo || "-",
        sede: emp.sede || "PMC",
        fecha_ingreso: emp.fecha_ingreso,
        desde: vac.desde,
        hasta: vac.hasta,
        dias: vac.dias,
        estado: vac.estado,
        detalle: vac.detalle,
        ano: vacAno,
        mes: vacMes,
        saldo_disponible: calc.saldo_disponible,
        dias_acumulados: calc.dias_acumulados,
        dias_tomados: calc.dias_tomados,
        creado_en: vac.creado_en,
      });
    }
  }

  // Ordenar lista de vacaciones por fecha 'desde' descendente
  todasLasVacaciones.sort((a, b) => new Date(b.desde) - new Date(a.desde));

  return reply.send({
    saldos: resumenSaldos,
    vacaciones: todasLasVacaciones,
  });
}
