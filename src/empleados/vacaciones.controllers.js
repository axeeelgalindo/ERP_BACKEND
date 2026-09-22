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
  const tasaMensual = String(sede || "PMC").toUpperCase() === "PUQ" ? 1.75 : 1.25;

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
 * Obtiene el resumen de vacaciones y el historial de un empleado
 */
export async function getEmpleadoVacaciones(request, reply) {
  const { id } = request.params;

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

  // 🔄 Auto-sync: Registrar en EmpleadoVacacion los días marcados como VACACIONES desde Asistencia que no estén cubiertos
  const asistenciasVacaciones = await prisma.asistencia.findMany({
    where: {
      empleado_id: id,
      estado: "VACACIONES",
    },
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

  const devengo = calcularDevengoVacaciones(empleado.fecha_ingreso, empleado.sede);
  
  // Sumar días de vacaciones confirmadas
  const diasTomados = empleado.vacaciones
    .filter((v) => v.estado !== "CANCELADO")
    .reduce((acc, v) => acc + (Number(v.dias) || 0), 0);

  const saldoDisponible = Math.round((devengo.dias_acumulados - diasTomados) * 100) / 100;

  return reply.send({
    empleado_id: empleado.id,
    nombre: empleado.usuario?.nombre || "Sin Nombre",
    rut: empleado.rut,
    cargo: empleado.cargo,
    sede: empleado.sede || "PMC",
    fecha_ingreso: empleado.fecha_ingreso,
    tasa_mensual: devengo.tasa_mensual,
    meses_trabajados: devengo.meses_trabajados,
    dias_acumulados: devengo.dias_acumulados,
    dias_tomados: Math.round(diasTomados * 100) / 100,
    saldo_disponible: saldoDisponible,
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
  });

  if (!empleado) {
    return reply.status(404).send({ error: "Empleado no encontrado" });
  }

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

  return reply.status(201).send(nueva);
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
  const { ano, mes, sede, empleado_id, q } = request.query || {};

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

  // Consolidar saldos y filtrar vacaciones si se pide por año/mes
  const resumenSaldos = [];
  const todasLasVacaciones = [];

  for (const emp of empleados) {
    const dev = calcularDevengoVacaciones(emp.fecha_ingreso, emp.sede);
    const tomados = emp.vacaciones
      .filter((v) => v.estado !== "CANCELADO")
      .reduce((acc, v) => acc + (Number(v.dias) || 0), 0);
    const saldo = Math.round((dev.dias_acumulados - tomados) * 100) / 100;

    resumenSaldos.push({
      empleado_id: emp.id,
      nombre: emp.usuario?.nombre || "Sin Nombre",
      rut: emp.rut || "-",
      cargo: emp.cargo || "-",
      sede: emp.sede || "PMC",
      fecha_ingreso: emp.fecha_ingreso,
      tasa_mensual: dev.tasa_mensual,
      meses_trabajados: dev.meses_trabajados,
      dias_acumulados: dev.dias_acumulados,
      dias_tomados: Math.round(tomados * 100) / 100,
      saldo_disponible: saldo,
      total_periodos: emp.vacaciones.length,
    });

    for (const vac of emp.vacaciones) {
      const dDesde = new Date(vac.desde);
      const vacAno = dDesde.getFullYear();
      const vacMes = dDesde.getMonth() + 1; // 1-12

      if (ano && Number(ano) !== vacAno) continue;
      if (mes && Number(mes) !== vacMes) continue;

      todasLasVacaciones.push({
        id: vac.id,
        empleado_id: emp.id,
        nombre: emp.usuario?.nombre || "Sin Nombre",
        rut: emp.rut || "-",
        cargo: emp.cargo || "-",
        sede: emp.sede || "PMC",
        desde: vac.desde,
        hasta: vac.hasta,
        dias: vac.dias,
        estado: vac.estado,
        detalle: vac.detalle,
        ano: vacAno,
        mes: vacMes,
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
