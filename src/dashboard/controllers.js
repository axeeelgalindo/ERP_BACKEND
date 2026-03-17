import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Helper para sacar los N primeros items de un arreglo
const takeFirst = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);

export const getDashboardData = async (request, reply) => {
  try {
    const { scope } = request;
    const empresa_id = scope?.empresaId;

    if (!empresa_id) {
      return reply.badRequest("No se encontró empresa_id en el scope.");
    }

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Rango de la semana actual (Lunes a Domingo)
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1)); // Lunes
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6); // Domingo
    endOfWeek.setHours(23, 59, 59, 999);

    // Rango del mes actual
    const startOfMonth = new Date(currentYear, currentMonth, 1);
    const endOfMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);

    // ============================================
    // QUERIES A LA BASE DE DATOS
    // ============================================

    const baseWhere = { empresa_id, eliminado: false };

    // 1. Ventas (Lógica original de listVentas para enlazar a la Empresa)
    const ventas = await prisma.venta.findMany({
      where: {
        AND: [{ eliminado: false }],
        OR: [
          { ordenVenta: { empresa_id: String(empresa_id), eliminado: false } },
          { detalles: { some: { hhEmpleado: { empresa_id: String(empresa_id) } } } },
          { detalles: { some: { compras: { compra: { empresa_id: String(empresa_id), eliminado: false } } } } },
          { AND: [{ ordenVentaId: null }, { detalles: { every: { hhEmpleadoId: null } } }, { detalles: { every: { compraId: null } } }] }
        ],
      },
      include: {
        detalles: {
          include: {
            compras: { include: { compra: true } }
          }
        },
        ordenVenta: true
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

    // 4. Cotizaciones
    const cotizaciones = await prisma.cotizacion.findMany({
      where: baseWhere,
      include: { cliente: true, glosas: true }
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

    // Función helper interna para fechas (MODIFICADO: Retorna siempre true para mostrar toda la data histórica)
    const isThisMonth = (dStr) => {
      return true;
    };

    const isThisWeek = (dStr) => {
      return true;
    };

    // 1. Ventas Mes
    const ventasMes = ventas.reduce((acc, v) => {
      // Nota: Asumo que en Venta existe Venta.total como en el frontend, 
      // o se calcula iterando detalles
      let totalVenta = v.total || 0; 
      if (!v.total && v.detalles) {
          totalVenta = v.detalles.reduce((sum, det) => sum + (Number(det.total) || 0), 0)
      }
      
      if (isThisMonth(v.fecha || v.createdAt)) return acc + Number(totalVenta);
      return acc;
    }, 0);

    // 2. Compras Proyectadas Semana
    const comprasSemana = compras.reduce((acc, c) => {
      if (isThisWeek(c.fecha || c.createdAt)) return acc + (Number(c.total) || 0);
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

    // 3. Devengado Semana (Proyectos)
    const devengadoSemana = proyectos.reduce((acc, p) => {
      const isActivo = p.estado && (p.estado.toLowerCase() === 'activo' || p.estado.toLowerCase() === 'en_progreso');
      if (isActivo) {
        const valor = Number(p.presupuesto) || 0;
        
        // Ponderación de Avance como el devengado individual de cada proyecto
        let sumW = 0;
        let sumWA = 0;
        if (p.tareas && p.tareas.length > 0) {
           p.tareas.forEach(t => {
             const w = taskWeight(t);
             const a100 = Number(t.avance || 0);
             const a01 = Math.max(0, Math.min(1, a100 / 100)); // Clamp 0..1
             sumW += w;
             sumWA += (w * a01);
           });
        }
        const avancePonderado01 = sumW > 0 ? sumWA / sumW : 0;
        
        // Por defecto o lógica original mostrábamos el devengado histórico "total" si no hay fechas, 
        // pero la regla era filtrar isThisWeek(). 
        // Para que de números, usamos avance histórico igual que hiciste al inicio.
        if (isThisWeek(p.actualizado_en || p.creada_en)) {
          return acc + (valor * avancePonderado01);
        }
      }
      return acc;
    }, 0);

    // 4. Flujo Caja Mes
    const ingresosPagadosMes = ventas.reduce((acc, v) => {
        let totalVenta = v.total || 0; 
        if (!v.total && v.detalles) {
            totalVenta = v.detalles.reduce((sum, det) => sum + (Number(det.ventaTotal ?? det.total) || 0), 0)
        }
      
      const isPagada = v.ordenVenta?.estado === 'PAGADA' || (v.detalles && v.detalles.some(d => d.compras?.compra?.estado === 'PAGADA'));
      if (isPagada && isThisMonth(v.fecha || v.createdAt)) {
         return acc + totalVenta;
      }
      return acc;
    }, 0);

    const egresosPagadosMes = compras.reduce((acc, c) => {
      if ((c.estado === 'PAGADA' || c.estado === 'PAGADO') && isThisMonth(c.fecha || c.createdAt || c.creada_en)) {
         return acc + (Number(c.total) || 0);
       }
      return acc;
    }, 0);

    const flujoCajaMes = ingresosPagadosMes - egresosPagadosMes;

    // ============================================
    // DATA PARA PIE CHARTS
    // ============================================

    // A. Trabajos Mes
    const proyectosMes = proyectos.filter(p => isThisMonth(p.fecha_inicio_plan) || isThisMonth(p.fecha_fin_plan) || p.estado?.includes('curso') || p.estado === 'activo');
    const proyectosEnCurso = proyectosMes.filter(p => p.estado?.toLowerCase().includes('curso') || p.estado?.toLowerCase() === 'activo').length;
    const proyectosFinalizados = proyectosMes.filter(p => p.estado?.toLowerCase().includes('terminad') || p.estado?.toLowerCase().includes('finaliz')).length;
    const proyectosEspera = proyectosMes.length - (proyectosEnCurso + proyectosFinalizados);

    const pieTrabajos = [
      { id: 0, value: proyectosEnCurso, label: 'En Ejecución', color: '#3b82f6' },
      { id: 1, value: proyectosFinalizados, label: 'Finalizados', color: '#10b981' },
      { id: 2, value: proyectosEspera > 0 ? proyectosEspera : 0, label: 'Espera/Otros', color: '#f59e0b' },
    ];

    // B. Cotizaciones Mes
    const cotizacionesMesData = cotizaciones.filter(c => isThisMonth(c.creada_en));
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

    ventas.forEach(v => {
      const dateV = new Date(v.fecha || v.createdAt);
      if(isNaN(dateV)) return;
      
      const mNode = monthsData.find(m => m.date.getMonth() === dateV.getMonth() && m.date.getFullYear() === dateV.getFullYear());
      if (mNode) {
        let totalV = v.total || (v.detalles ? v.detalles.reduce((sum, d)=> sum+(Number(d.ventaTotal ?? d.total)||0),0) : 0);
        
        const isPagada = v.ordenVenta?.estado === 'PAGADA' || (v.detalles && v.detalles.some(d => d.compras?.compra?.estado === 'PAGADA'));

        mNode.ventas += totalV;
        if (isPagada) mNode.cajaIn += totalV;
      }
    });

    compras.forEach(c => {
      // Solo tomamos compras pagadas
      if (c.estado !== 'PAGADA' && c.estado !== 'PAGADO') return;
      const dateC = new Date(c.fecha || c.createdAt || c.creada_en);
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

    return reply.send({
      success: true,
      kpis: {
        ventasMes,
        comprasSemana,
        devengadoSemana,
        flujoCajaMes,
      },
      charts: {
        trabajosMes: pieTrabajos,
        cotizacionesMes: pieCotizaciones,
        flujoCaja: pieFlujo,
        evolucion6Meses: barChartDataset
      },
      recents,
      flags: {
         proyectosMesActivo: proyectosMes.length > 0,
         cotizacionesMesDataActivo: cotizacionesMesData.length > 0
      }
    });

  } catch (error) {
    console.error("[getDashboardData] Error:", error);
    return reply.internalServerError("Error al obtener los datos del dashboard.");
  }
};
