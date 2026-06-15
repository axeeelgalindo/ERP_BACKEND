import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Helper para sacar los N primeros items de un arreglo
const takeFirst = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);

export const getDashboardData = async (request, reply) => {
  try {
    const { scope, query } = request;
    const empresa_id = scope?.empresaId;
    const periodo = query?.periodo || 'mensual'; // 'semanal', 'mensual', 'anual'

    if (!empresa_id) {
      return reply.badRequest("No se encontró empresa_id en el scope.");
    }

    // Usar la fecha de referencia si viene en query, de lo contrario la actual
    const now = query?.refDate ? new Date(query.refDate) : new Date();
    
    let periodStart = new Date(now);
    let periodEnd = new Date(now);

    if (periodo === 'semanal') {
      periodStart.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1)); // Lunes
      periodStart.setHours(0, 0, 0, 0);
      periodEnd = new Date(periodStart);
      periodEnd.setDate(periodStart.getDate() + 6);
      periodEnd.setHours(23, 59, 59, 999);
    } else if (periodo === 'anual') {
      periodStart = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      periodEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    } else {
      // mensual por defecto
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    // ============================================
    // QUERIES A LA BASE DE DATOS
    // ============================================

    const baseWhere = { empresa_id, eliminado: false };

    // 1. Ventas (Filtro directo por empresa_id)
    const ventas = await prisma.venta.findMany({
      where: {
        empresa_id: String(empresa_id),
        eliminado: false
      },
      include: {
        detalles: {
          include: {
            compras: { include: { compra: true } }
          }
        },
        ordenVenta: {
          include: { cliente: true }
        }
      }
    });

    // 2. Compras (Compra SÍ tiene empresa_id directo en BD)
    const compras = await prisma.compra.findMany({
      where: {
        eliminado: false,
        empresa_id: empresa_id
      },
      include: { proveedor: true } // Para la tabla de últimas compras
    });

    // 3. Proyectos
    const proyectos = await prisma.proyecto.findMany({
      where: baseWhere,
      include: {
        tareas: { where: { eliminado: false } }
      }
    });

    const reqYear = new Date().getFullYear();
    const startYear = proyectos.reduce((min, p) => {
      if (!p.creada_en && !p.createdAt) return min;
      const py = new Date(p.creada_en || p.createdAt).getFullYear();
      return isNaN(py) ? min : Math.min(min, py);
    }, reqYear);
    const availableYears = Array.from({ length: reqYear - startYear + 1 }, (_, i) => startYear + i);

    // 4. Cotizaciones (including pagos for exact cash-flow dates)
    const cotizaciones = await prisma.cotizacion.findMany({
      where: baseWhere,
      include: { cliente: true, glosas: true, pagos: true }
    });

    // 5. Clientes (para la tabla de últimos clientes)
    const clientes = await prisma.cliente.findMany({
      where: baseWhere,
      orderBy: { creado_en: 'desc' },
      take: 6
    });

    // ============================================
    // KPIs CALCULADOS
    // ============================================

    // ============================================
    // HELPERS DE FILTRADO (REALES)
    // ============================================
    const isThisPeriod = (dStr) => {
      if (!dStr) return false;
      const d = new Date(dStr);
      return d >= periodStart && d <= periodEnd;
    };

    // --- BREAKDOWN ARRAYS ---
    const b_facturadoMes = [];
    const b_ventasMes = [];
    const b_cotizadoMes = [];
    const b_comprasSemana = [];
    const b_devengadoSemana = [];
    const b_ingresosMes = [];
    const b_egresosMes = [];

    // 1. Facturado Mes (Facturación Real = Ventas emitidas este mes)
    const facturadoMes = ventas.reduce((acc, v) => {
      // ✅ Considerar sólo ventas facturadas (con folio/tipo_doc) o Cotizaciones en FACTURADA/PAGADA
      const isFacturadaOC = v.ordenVenta && ['FACTURADA', 'PAGADA'].includes(v.ordenVenta.estado?.toUpperCase());
      const isImportedRCV = !!(v.folio || v.tipo_doc);
      if (!isFacturadaOC && !isImportedRCV) return acc;

      let totalVenta = v.total || 0; 
      if (!v.total && v.detalles) {
          totalVenta = v.detalles.reduce((sum, det) => sum + (Number(det.ventaTotal ?? det.total) || 0), 0)
      }
      const dateFactura = isFacturadaOC ? (v.ordenVenta.fecha_facturada || v.fecha) : v.fecha;
      if (isThisPeriod(dateFactura)) {
        b_facturadoMes.push({ 
          folio: v.folio || v.id, 
          cliente: v.ordenVenta?.cliente?.nombre || v.Cliente?.nombre || "N/A",
          total: totalVenta, 
          fecha: dateFactura 
        });
        return acc + Number(totalVenta);
      }
      return acc;
    }, 0);

    // 1a. Ventas Periodo (Cotizaciones que pasaron a OV este periodo)
    const ventasMes = cotizaciones.reduce((acc, c) => {
      if (isThisPeriod(c.fecha_ov)) {
        b_ventasMes.push({ 
          id: c.id, 
          cliente: c.cliente?.nombre || "N/A",
          asunto: c.asunto, 
          total: c.total, 
          fecha_ov: c.fecha_ov 
        });
        return acc + (Number(c.total) || 0);
      }
      return acc;
    }, 0);

    // 1b. Cotizado Periodo (Total de cotizaciones creadas este periodo)
    const cotizadoMes = cotizaciones.reduce((acc, c) => {
      if (isThisPeriod(c.creada_en)) {
        b_cotizadoMes.push({ 
          id: c.id, 
          cliente: c.cliente?.nombre || "N/A",
          asunto: c.asunto, 
          total: c.total, 
          creada_en: c.creada_en 
        });
        return acc + (Number(c.total) || 0);
      }
      return acc;
    }, 0);

    // 2. Compras Proyectadas Periodo (Nuevas Órdenes de Compra generadas este periodo)
    const comprasSemana = compras.reduce((acc, c) => {
      const dateC = c.fecha_docto || c.creada_en || c.fecha;
      if (isThisPeriod(dateC)) {
        b_comprasSemana.push({ numero: c.numero, total: c.total, fecha: dateC });
        return acc + (Number(c.total) || 0);
      }
      return acc;
    }, 0);

    // Helper real de ponderación de tareas (peso)
    function taskWeight(t) {
      const costo = Number(t.total_costo_plan ?? t.costo_plan ?? 0);
      if (Number.isFinite(costo) && costo > 0) return costo;
      const horas = Number(t.total_horas_plan ?? t.horas_plan ?? 0);
      if (Number.isFinite(horas) && horas > 0) return horas;
      const dias = Number(t.dias_plan ?? 0);
      if (Number.isFinite(dias) && dias > 0) return dias;
      return 1;
    }

    // 3. Generado Periodo (Devengado Incremental desde el inicio del periodo hasta el fin del periodo)
    const pastDate = new Date(periodStart);
    const endDate = new Date(periodEnd);

    const taskIdList = proyectos.flatMap(p => p.tareas.map(t => t.id));
    
    // Historial al INICIO del periodo
    const historialPastDate = await prisma.$queryRaw`
      SELECT DISTINCT ON (tarea_id) tarea_id, to_avance 
      FROM "TareaHistorial" 
      WHERE tarea_id = ANY(${taskIdList}) 
        AND occurred_at <= ${pastDate} 
        AND to_avance IS NOT NULL 
      ORDER BY tarea_id, occurred_at DESC
    `;
    const mapHistorialStart = new Map(historialPastDate.map(r => [r.tarea_id, Number(r.to_avance)]));

    const isPastPeriod = endDate < new Date();
    const isFuturePeriod = pastDate > new Date();

    let mapHistorialEnd = new Map();
    if (isPastPeriod) {
      const historialEndDate = await prisma.$queryRaw`
        SELECT DISTINCT ON (tarea_id) tarea_id, to_avance 
        FROM "TareaHistorial" 
        WHERE tarea_id = ANY(${taskIdList}) 
          AND occurred_at <= ${endDate} 
          AND to_avance IS NOT NULL 
        ORDER BY tarea_id, occurred_at DESC
      `;
      mapHistorialEnd = new Map(historialEndDate.map(r => [r.tarea_id, Number(r.to_avance)]));
    }

    const devengadoSemana = proyectos.reduce((accTotal, p) => {
      if (isFuturePeriod) return accTotal;

      // Filtrar proyectos creados despues del final de este periodo (eliminando "ruido" en el pasado)
      const dateProj = new Date(p.creada_en || p.createdAt);
      if (!isNaN(dateProj) && dateProj > endDate) return accTotal;

      const valor = Number(p.presupuesto) || 0;
      if (valor <= 0) return accTotal;

      let sumW = 0;
      let sumWA_Ahora = 0;
      let sumWA_Hace7 = 0;
      const tasksWithDelta = [];

      if (p.tareas && p.tareas.length > 0) {
        p.tareas.forEach(t => {
          const w = taskWeight(t);
          sumW += w;
          
          const valEnd = isPastPeriod ? (mapHistorialEnd.get(t.id) ?? 0) : (t.avance || 0);
          const aAhora = Math.max(0, Math.min(1, Number(valEnd) / 100));
          sumWA_Ahora += (w * aAhora);
          
          const aHace7_Val = mapHistorialStart.get(t.id) ?? 0;
          const aHace7 = Math.max(0, Math.min(1, aHace7_Val / 100));
          sumWA_Hace7 += (w * aHace7);

          if (aAhora > aHace7) {
            tasksWithDelta.push({
              nombre: t.nombre,
              avance_ahora: aAhora * 100,
              avance_hace7: aHace7 * 100,
              delta_pct: (aAhora - aHace7) * 100,
              contribucion_devengado: sumW > 0 ? (valor * (w * (aAhora - aHace7) / sumW)) : 0
            });
          }
        });
      }

      if (sumW > 0) {
        const devHoy = valor * (sumWA_Ahora / sumW);
        const devHace7 = valor * (sumWA_Hace7 / sumW);
        const delta = Math.max(0, devHoy - devHace7);
        if (delta > 0) {
          b_devengadoSemana.push({ 
            proyecto: p.nombre, 
            monto_incremental: delta, 
            devHoy, 
            devHace7,
            tareas_con_avance: tasksWithDelta 
          });
        }
        return accTotal + delta;
      }
      return accTotal;
    }, 0);

    // 4. Flujo Caja Periodo — Ingresos basados en pagos individuales (CotizacionPago)
    // Cada hito de pago registrado en una cotización se contabiliza según su propia fecha
    const ingresosPagadosMes = cotizaciones.reduce((acc, cot) => {
      if (!Array.isArray(cot.pagos) || cot.pagos.length === 0) return acc;
      let sumPeriodo = 0;
      for (const pago of cot.pagos) {
        if (isThisPeriod(pago.fecha)) {
          const monto = Number(pago.monto || 0);
          b_ingresosMes.push({
            concepto: `COT #${cot.numero} — Pago`,
            cliente: cot.cliente?.nombre || 'N/A',
            total: monto,
            fecha_pago: pago.fecha,
          });
          sumPeriodo += monto;
        }
      }
      return acc + sumPeriodo;
    }, 0);

    const egresosPagadosMes = compras.reduce((acc, c) => {
      const isPagada = c.estado === 'PAGADA' || c.estado === 'PAGADO';
      const dateOut = c.fecha_docto || c.actualizado_en;
      if (isPagada && isThisPeriod(dateOut)) {
         b_egresosMes.push({ concepto: `Compra ${c.numero}`, proveedor: c.proveedor?.nombre, total: c.total, fecha_pago: dateOut });
         return acc + (Number(c.total) || 0);
       }
      return acc;
    }, 0);

    const flujoCajaMes = ingresosPagadosMes - egresosPagadosMes;

    console.log("--- DESGLOSE KPIS ---");
    const logB = (title, data) => console.log(title, JSON.stringify(data, null, 2));
    
    logB("Ventas Mes (OV):", b_ventasMes);
    logB("Facturado Mes (Facturas):", b_facturadoMes);
    logB("Cotizado Mes:", b_cotizadoMes);
    logB("Compras Semana (Nuevas):", b_comprasSemana);
    logB("Devengado Semana (Incremental):", b_devengadoSemana);
    logB("Ingresos (Cash):", b_ingresosMes);
    logB("Egresos (Cash):", b_egresosMes);

    // ============================================
    // DATA PARA PIE CHARTS
    // ============================================

    // A. Trabajos Periodo
    const proyectosMes = proyectos.filter(p => {
      // Solo incluirlos en la torta si el periodo recubre su inicio, su fin, O si estamos en el presente (isThisPeriod) y está activo
      const overlapPlan = isThisPeriod(p.fecha_inicio_plan) || isThisPeriod(p.fecha_fin_plan);
      // Incluir "activos" solo si el periodo consultado es el Actual o abarca la fecha de hoy
      const includesHoy = periodStart <= new Date() && periodEnd >= new Date();
      const isActiveNow = p.estado?.toLowerCase().includes('curso') || p.estado?.toLowerCase() === 'activo';
      
      return overlapPlan || (includesHoy && isActiveNow);
    });
    
    const proyectosEnCurso = proyectosMes.filter(p => p.estado?.toLowerCase().includes('curso') || p.estado?.toLowerCase() === 'activo').length;
    const proyectosFinalizados = proyectosMes.filter(p => p.estado?.toLowerCase().includes('terminad') || p.estado?.toLowerCase().includes('finaliz')).length;
    const proyectosEspera = proyectosMes.length - (proyectosEnCurso + proyectosFinalizados);

    // Calcular avance promedio de los proyectos activos en este periodo
    let totalAvanceSum = 0;
    let proyectosConAvanceCount = 0;
    proyectosMes.forEach(p => {
      if (p.tareas && p.tareas.length > 0) {
        const avgTaskAvance = p.tareas.reduce((sum, t) => sum + (t.avance || 0), 0) / p.tareas.length;
        totalAvanceSum += avgTaskAvance;
      } else {
        totalAvanceSum += (p.avance || 0);
      }
      proyectosConAvanceCount++;
    });
    const averageProgress = proyectosConAvanceCount > 0 ? Math.round(totalAvanceSum / proyectosConAvanceCount) : 0;

    const pieTrabajos = [
      { id: 0, value: proyectosEnCurso, label: 'En Ejecución', color: '#3b82f6' },
      { id: 1, value: proyectosFinalizados, label: 'Finalizados', color: '#10b981' },
      { id: 2, value: proyectosEspera > 0 ? proyectosEspera : 0, label: 'Espera/Otros', color: '#f59e0b' },
    ];

    // B. Cotizaciones Periodo
    const cotizacionesMesData = cotizaciones.filter(c => isThisPeriod(c.creada_en));
    let cotAprobadas = 0; let cotRechazadas = 0; let cotEnviadas = 0;
    cotizacionesMesData.forEach(c => {
      const estado = (c.estado || '').toLowerCase();
      if (estado.includes('aprob') || estado.includes('ganad') || estado.includes('acept')) cotAprobadas++;
      else if (estado.includes('rechaz') || estado.includes('perdid')) cotRechazadas++;
      else cotEnviadas++;
    });

    const pieCotizaciones = [
      { id: 0, value: cotAprobadas, label: 'Aceptadas', color: '#10b981' },
      { id: 1, value: cotRechazadas, label: 'Rechazadas', color: '#ef4444' },
      { id: 2, value: cotEnviadas, label: 'Enviadas/Pdte', color: '#f59e0b' },
    ];

    // C. Flujo de Caja
    const pieFlujo = [
      { id: 0, value: ingresosPagadosMes, label: 'Entradas', color: '#10b981' },
      { id: 1, value: egresosPagadosMes, label: 'Salidas', color: '#ef4444' },
    ];

    // ============================================
    // DATA PARA GRAFICO BARRAS/LINEAS (6 Meses)
    // ============================================
    const monthsData = [];
    if (periodo === 'anual') {
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), i, 1);
        monthsData.push({
          date: d,
          label: d.toLocaleString('es-CL', { month: 'short' }).toUpperCase(),
          ventas: 0,
          cajaIn: 0,
          cajaOut: 0
        });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthsData.push({
          date: d,
          label: d.toLocaleString('es-CL', { month: 'short' }).toUpperCase(),
          ventas: 0,
          cajaIn: 0,
          cajaOut: 0
        });
      }
    }

    // Acumular Ventas (OVs generadas) a partir del total de cotizaciones aprobadas/enlazadas a OVs
    cotizaciones.forEach(c => {
      if (!c.fecha_ov) return;
      const dateV = new Date(c.fecha_ov);
      if (isNaN(dateV)) return;

      const mNode = monthsData.find(m => m.date.getMonth() === dateV.getMonth() && m.date.getFullYear() === dateV.getFullYear());
      if (mNode) {
        mNode.ventas += (Number(c.total) || 0);
      }
    });

    ventas.forEach(v => {
      // ✅ Considerar sólo ventas facturadas (con folio/tipo_doc) o Cotizaciones en FACTURADA/PAGADA
      const isFacturadaOC = v.ordenVenta && ['FACTURADA', 'PAGADA'].includes(v.ordenVenta.estado?.toUpperCase());
      const isImportedRCV = !!(v.folio || v.tipo_doc);
      if (!isFacturadaOC && !isImportedRCV) return;

      const dateV = isFacturadaOC && v.ordenVenta?.fecha_facturada
        ? new Date(v.ordenVenta.fecha_facturada)
        : new Date(v.fecha || v.createdAt);
      if(isNaN(dateV)) return;
      
      let totalV = v.total || (v.detalles ? v.detalles.reduce((sum, d)=> sum+(Number(d.ventaTotal ?? d.total)||0),0) : 0);
      const isPagada = v.ordenVenta?.estado === 'PAGADA' || (v.detalles && v.detalles.some(d => d.compras?.compra?.estado === 'PAGADA'));

      if (isPagada) {
        const datePago = isFacturadaOC && v.ordenVenta?.fecha_pagada
          ? new Date(v.ordenVenta.fecha_pagada)
          : dateV;
        const mNodePago = monthsData.find(m => m.date.getMonth() === datePago.getMonth() && m.date.getFullYear() === datePago.getFullYear());
        if (mNodePago) {
          mNodePago.cajaIn += totalV;
        }
      }
    });

    compras.forEach(c => {
      // Solo tomamos compras pagadas
      if (c.estado !== 'PAGADA' && c.estado !== 'PAGADO') return;
      const dateC = new Date(c.fecha_docto || c.fecha || c.createdAt || c.creada_en);
      if(isNaN(dateC)) return;
      
      const mNode = monthsData.find(m => m.date.getMonth() === dateC.getMonth() && m.date.getFullYear() === dateC.getFullYear());
      if (mNode) {
        mNode.cajaOut += (Number(c.total) || 0);
      }
    });

    const barChartDataset = monthsData.map(m => ({
      mes: m.label,
      ventas: m.ventas,
      flujoNeto: m.cajaIn - m.cajaOut
    }));

    // ============================================
    // LISTAS DE RESUMEN
    // ============================================

    // Transformamos la respuesta para que las listas matcheen las props del frontend
    const recents = {
      clientes: clientes.map(c => ({ id: c.id, nombre: c.nombre, rut: c.rut, correo: c.correo })),
      compras: compras.sort((a,b) => new Date(b.creado_en) - new Date(a.creado_en)).slice(0,6).map(c => ({
         numero: c.numero, proveedor: c.proveedor?.nombre || "N/A", total: c.total
      })),
      proyectos: proyectos.sort((a,b) => new Date(b.creada_en) - new Date(a.creada_en)).slice(0,6).map(p => ({
         id: p.id, nombre: p.nombre, estado: p.estado, createdAt: p.creada_en
      })),
      cotizaciones: cotizaciones.sort((a,b) => new Date(b.creada_en) - new Date(a.creada_en)).slice(0,6).map(c => ({
         id: c.id, titulo: c.asunto || `Cot #${c.numero}`, clienteNombre: c.cliente?.nombre, totalOtorgar: c.total
      }))
    };

    // ============================================
    // RESPONSE
    // ============================================

    const response = {
      success: true,
      kpis: {
        ventasMes,
        facturadoMes,
        cotizadoMes,
        comprasSemana,
        devengadoSemana,
        flujoCajaMes,
        ingresosMes: ingresosPagadosMes,
        averageProgress,
      },
      charts: {
        trabajosMes: pieTrabajos,
        cotizacionesMes: pieCotizaciones,
        flujoCaja: pieFlujo,
        evolucion6Meses: barChartDataset
      },
      recents,
      availableYears,
      flags: {
         proyectosMesActivo: proyectosMes.length > 0,
         cotizacionesMesDataActivo: cotizacionesMesData.length > 0
      }
    };

    console.log("--- DASHBOARD KPIs ---", response.kpis);

    return reply.send(response);

  } catch (error) {
    console.error("[getDashboardData] Error:", error);
    return reply.internalServerError("Error al obtener los datos del dashboard.");
  }
};
