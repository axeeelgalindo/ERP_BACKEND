// src/reportes/controllers.js
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";

const prisma = new PrismaClient();

function getWeekRange(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const day = d.getDay(); // 0 is Sunday, 1 is Monday...
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

export async function getReporteTareasCompletadas(request, reply) {
  try {
    const scope = resolveScope(request);
    const {
      fecha_inicio,
      fecha_fin,
      jefe_id,
      sede,
      destino,
      empleado_id,
    } = request.query || {};

    const empresaId = scope.empresaId;
    if (!empresaId) {
      return reply.badRequest("Falta empresaId en el contexto");
    }

    // 1. Determinar rango de fechas
    let start, end;
    if (fecha_inicio && fecha_fin) {
      start = new Date(`${String(fecha_inicio).slice(0, 10)}T00:00:00.000Z`);
      end = new Date(`${String(fecha_fin).slice(0, 10)}T23:59:59.999Z`);
    } else {
      const w = getWeekRange(fecha_inicio);
      start = w.start;
      end = w.end;
    }

    // Período anterior para comparación de tendencia (misma duración)
    const durationMs = end.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - durationMs - 1);
    const prevEnd = new Date(start.getTime() - 1);

    // 2. Obtener todos los empleados de la empresa con sus usuarios
    const empleadosRaw = await prisma.empleado.findMany({
      where: {
        eliminado: false,
        usuario: {
          empresa_id: empresaId,
          eliminado: false,
        },
      },
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            correo: true,
            rol: { select: { nombre: true, codigo: true } },
          },
        },
      },
      orderBy: { creado_en: "asc" },
    });

    // Mapeo rápido de empleados y relaciones de jefatura en memoria
    const empMap = new Map();
    empleadosRaw.forEach((e) => {
      empMap.set(e.id, {
        ...e,
        jefe: null,
        subordinados: [],
      });
    });

    empleadosRaw.forEach((e) => {
      if (e.jefe_id && empMap.has(e.jefe_id)) {
        const jefeEmp = empMap.get(e.jefe_id);
        jefeEmp.subordinados.push(e);
        empMap.get(e.id).jefe = jefeEmp;
      }
    });

    const empleados = Array.from(empMap.values());

    // 3. Obtener Tareas principales completadas en el rango
    const tareasWhere = {
      eliminado: false,
      OR: [
        {
          proyecto_id: null,
          empresa_id: empresaId,
        },
        {
          proyecto: {
            empresa_id: empresaId,
            eliminado: false,
          },
        },
      ],
      AND: [
        {
          OR: [
            { estado: "completada" },
            { avance: 100 },
          ],
        },
        {
          OR: [
            { completada_en: { gte: start, lte: end } },
            {
              AND: [
                { completada_en: null },
                { fecha_fin_real: { gte: start, lte: end } },
              ],
            },
          ],
        },
      ],
    };

    const tareasRows = await prisma.tarea.findMany({
      where: tareasWhere,
      include: {
        proyecto: { select: { id: true, nombre: true, estado: true } },
        epica: { select: { id: true, nombre: true } },
      },
      orderBy: { fecha_fin_real: "desc" },
    });

    // 4. Obtener Subtareas (detalles) completadas en el rango
    const detallesWhere = {
      eliminado: false,
      tarea: {
        eliminado: false,
        OR: [
          { proyecto_id: null, empresa_id: empresaId },
          { proyecto: { empresa_id: empresaId, eliminado: false } },
        ],
      },
      AND: [
        {
          OR: [
            { estado: "completada" },
            { avance: 100 },
          ],
        },
        {
          OR: [
            { completada_en: { gte: start, lte: end } },
            {
              AND: [
                { completada_en: null },
                { fecha_fin_real: { gte: start, lte: end } },
              ],
            },
          ],
        },
      ],
    };

    const detallesRows = await prisma.tareaDetalle.findMany({
      where: detallesWhere,
      include: {
        tarea: {
          include: {
            proyecto: { select: { id: true, nombre: true } },
            epica: { select: { id: true, nombre: true } },
          },
        },
      },
      orderBy: { fecha_fin_real: "desc" },
    });

    // 5. Normalizar todas las tareas completadas en un formato unificado
    let allCompleted = [];

    // Tareas principales
    tareasRows.forEach((t) => {
      const compId = t.completada_por_id || t.responsable_id || null;
      const respId = t.responsable_id || null;
      const compEmp = compId ? empMap.get(compId) : null;
      const respEmp = respId ? empMap.get(respId) : null;

      const jefeId = compEmp?.jefe_id || respEmp?.jefe_id || null;
      const jefeNom = compEmp?.jefe?.usuario?.nombre || respEmp?.jefe?.usuario?.nombre || "Sin Jefatura Asignada";

      let finalSede = (t.centro_costo || compEmp?.sede || "PMC").toUpperCase();
      if (!["PMC", "PUQ"].includes(finalSede)) finalSede = "PMC";

      const finalDestino = (t.destino || "PROYECTO").toUpperCase();

      const fPlan = t.fecha_fin_plan ? new Date(t.fecha_fin_plan) : null;
      const fReal = t.completada_en || t.fecha_fin_real ? new Date(t.completada_en || t.fecha_fin_real) : null;
      const aTiempo = fPlan && fReal ? fReal <= fPlan : true;

      allCompleted.push({
        id: t.id,
        tipo_item: "tarea",
        nombre: t.nombre,
        descripcion: t.descripcion,
        destino: finalDestino,
        sede: finalSede,
        proyecto_id: t.proyecto_id,
        proyecto_nombre: t.proyecto?.nombre || "—",
        epica_nombre: t.epica?.nombre || "—",
        responsable_id: respId,
        responsable_nombre: respEmp?.usuario?.nombre || "Sin asignar",
        completada_por_id: compId,
        completada_por_nombre: compEmp?.usuario?.nombre || respEmp?.usuario?.nombre || "No especificado",
        completada_por_cargo: compEmp?.cargo || respEmp?.cargo || "Personal",
        jefe_id: jefeId,
        jefe_nombre: jefeNom,
        fecha_inicio_plan: t.fecha_inicio_plan,
        fecha_fin_plan: t.fecha_fin_plan,
        fecha_inicio_real: t.fecha_inicio_real,
        fecha_fin_real: t.fecha_fin_real || t.completada_en,
        completada_en: t.completada_en || t.fecha_fin_real,
        dias_plan: t.dias_plan,
        dias_reales: t.dias_reales,
        a_tiempo: aTiempo,
        avance: t.avance,
      });
    });

    // Subtareas
    detallesRows.forEach((d) => {
      const compId = d.completada_por_id || d.responsable_id || null;
      const respId = d.responsable_id || null;
      const compEmp = compId ? empMap.get(compId) : null;
      const respEmp = respId ? empMap.get(respId) : null;

      const jefeId = compEmp?.jefe_id || respEmp?.jefe_id || null;
      const jefeNom = compEmp?.jefe?.usuario?.nombre || respEmp?.jefe?.usuario?.nombre || "Sin Jefatura Asignada";

      let finalSede = (d.tarea?.centro_costo || compEmp?.sede || "PMC").toUpperCase();
      if (!["PMC", "PUQ"].includes(finalSede)) finalSede = "PMC";

      const finalDestino = (d.tarea?.destino || "PROYECTO").toUpperCase();

      const fPlan = d.fecha_fin_plan ? new Date(d.fecha_fin_plan) : null;
      const fReal = d.completada_en || d.fecha_fin_real ? new Date(d.completada_en || d.fecha_fin_real) : null;
      const aTiempo = fPlan && fReal ? fReal <= fPlan : true;

      allCompleted.push({
        id: d.id,
        tipo_item: "subtarea",
        nombre: `${d.tarea?.nombre ? `${d.tarea.nombre} ➔ ` : ""}${d.titulo}`,
        descripcion: d.descripcion,
        destino: finalDestino,
        sede: finalSede,
        proyecto_id: d.tarea?.proyecto_id || null,
        proyecto_nombre: d.tarea?.proyecto?.nombre || "—",
        epica_nombre: d.tarea?.epica?.nombre || "—",
        responsable_id: respId,
        responsable_nombre: respEmp?.usuario?.nombre || "Sin asignar",
        completada_por_id: compId,
        completada_por_nombre: compEmp?.usuario?.nombre || respEmp?.usuario?.nombre || "No especificado",
        completada_por_cargo: compEmp?.cargo || respEmp?.cargo || "Personal",
        jefe_id: jefeId,
        jefe_nombre: jefeNom,
        fecha_inicio_plan: d.fecha_inicio_plan,
        fecha_fin_plan: d.fecha_fin_plan,
        fecha_inicio_real: d.fecha_inicio_real,
        fecha_fin_real: d.fecha_fin_real || d.completada_en,
        completada_en: d.completada_en || d.fecha_fin_real,
        dias_plan: d.dias_plan,
        dias_reales: d.dias_reales,
        a_tiempo: aTiempo,
        avance: d.avance,
      });
    });

    // 6. Aplicar Filtros solicitados
    if (jefe_id && jefe_id !== "TODOS") {
      allCompleted = allCompleted.filter((item) => item.jefe_id === jefe_id || item.completada_por_id === jefe_id);
    }

    if (sede && sede !== "TODAS") {
      allCompleted = allCompleted.filter((item) => item.sede === sede.toUpperCase());
    }

    if (destino && destino !== "TODOS") {
      allCompleted = allCompleted.filter((item) => item.destino === destino.toUpperCase());
    }

    if (empleado_id && empleado_id !== "TODOS") {
      allCompleted = allCompleted.filter((item) => item.completada_por_id === empleado_id);
    }

    // 7. Cálculos de KPIs y Agrupaciones
    const totalCompletadas = allCompleted.length;
    const aTiempoCount = allCompleted.filter((x) => x.a_tiempo).length;
    const porcentajeATiempo = totalCompletadas > 0 ? Math.round((aTiempoCount / totalCompletadas) * 100) : 100;

    // Conteo por Destino (PROYECTO, TALLER, ADMINISTRACION)
    const porDestino = {
      PROYECTO: allCompleted.filter((x) => x.destino === "PROYECTO").length,
      TALLER: allCompleted.filter((x) => x.destino === "TALLER").length,
      ADMINISTRACION: allCompleted.filter((x) => x.destino === "ADMINISTRACION" || x.destino === "ADMIN").length,
    };

    // Conteo por Sede (PMC, PUQ)
    const porSede = {
      PMC: allCompleted.filter((x) => x.sede === "PMC").length,
      PUQ: allCompleted.filter((x) => x.sede === "PUQ").length,
    };

    // Rendimiento por Persona (Tasa individual)
    const personasMap = new Map();
    allCompleted.forEach((item) => {
      const pId = item.completada_por_id || "sin_asignar";
      if (!personasMap.has(pId)) {
        personasMap.set(pId, {
          empleado_id: pId,
          nombre: item.completada_por_nombre,
          cargo: item.completada_por_cargo,
          jefe_nombre: item.jefe_nombre,
          sede: item.sede,
          total: 0,
          proyecto: 0,
          taller: 0,
          admin: 0,
          a_tiempo: 0,
          pmc: 0,
          puq: 0,
        });
      }
      const p = personasMap.get(pId);
      p.total += 1;
      if (item.destino === "PROYECTO") p.proyecto += 1;
      else if (item.destino === "TALLER") p.taller += 1;
      else p.admin += 1;

      if (item.sede === "PMC") p.pmc += 1;
      else p.puq += 1;

      if (item.a_tiempo) p.a_tiempo += 1;
    });

    const rendimientoPersonas = Array.from(personasMap.values()).sort((a, b) => b.total - a.total);

    // Rendimiento por Equipos / Jefaturas
    const equiposMap = new Map();
    allCompleted.forEach((item) => {
      const jId = item.jefe_id || "sin_jefe";
      if (!equiposMap.has(jId)) {
        equiposMap.set(jId, {
          jefe_id: jId,
          jefe_nombre: item.jefe_nombre,
          total: 0,
          proyecto: 0,
          taller: 0,
          admin: 0,
          pmc: 0,
          puq: 0,
          miembros_activos: new Set(),
        });
      }
      const eq = equiposMap.get(jId);
      eq.total += 1;
      if (item.destino === "PROYECTO") eq.proyecto += 1;
      else if (item.destino === "TALLER") eq.taller += 1;
      else eq.admin += 1;

      if (item.sede === "PMC") eq.pmc += 1;
      else eq.puq += 1;

      if (item.completada_por_id) eq.miembros_activos.add(item.completada_por_id);
    });

    const rendimientoEquipos = Array.from(equiposMap.values()).map((eq) => ({
      ...eq,
      miembros_activos_count: eq.miembros_activos.size,
      tasa_por_persona: eq.miembros_activos.size > 0 ? (eq.total / eq.miembros_activos.size).toFixed(1) : eq.total,
      miembros_activos: Array.from(eq.miembros_activos),
    })).sort((a, b) => b.total - a.total);

    // Tasa general por persona
    const totalPersonasActivas = rendimientoPersonas.length;
    const tasaPromedioPorPersona = totalPersonasActivas > 0
      ? (totalCompletadas / totalPersonasActivas).toFixed(1)
      : 0;

    // Distribución por Día de la Semana
    const diasSemana = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    const porDia = [0, 0, 0, 0, 0, 0, 0];
    allCompleted.forEach((item) => {
      if (item.completada_en) {
        const d = new Date(item.completada_en);
        const dayIdx = (d.getDay() + 6) % 7; // Convert 0=Sun to 6, 1=Mon to 0
        porDia[dayIdx] += 1;
      }
    });

    // Lista de jefaturas disponibles para selectores
    const jefaturasDisponibles = Array.from(
      new Set(
        empleados
          .filter((e) => (e.subordinados && e.subordinados.length > 0) || e.usuario?.nombre)
          .map((e) => ({
            id: e.id,
            nombre: e.usuario?.nombre || e.cargo || "Jefatura",
            cargo: e.cargo || "Jefe de Equipo",
            sede: e.sede || "PMC",
            subordinados_count: e.subordinados?.length || 0,
          }))
      )
    ).filter((j) => j.subordinados_count > 0 || j.nombre);

    return reply.send({
      ok: true,
      periodo: {
        fecha_inicio: start.toISOString().slice(0, 10),
        fecha_fin: end.toISOString().slice(0, 10),
      },
      kpis: {
        total_completadas: totalCompletadas,
        personas_activas: totalPersonasActivas,
        tasa_promedio_por_persona: Number(tasaPromedioPorPersona),
        porcentaje_a_tiempo: porcentajeATiempo,
      },
      distribucion: {
        por_destino: porDestino,
        por_sede: porSede,
        por_dia: diasSemana.map((dia, idx) => ({ dia, total: porDia[idx] })),
      },
      rendimiento_equipos: rendimientoEquipos,
      rendimiento_personas: rendimientoPersonas,
      jefaturas_disponibles: jefaturasDisponibles,
      tareas: allCompleted,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      ok: false,
      message: "Error al generar reporte de tareas completadas",
      error: error.message,
    });
  }
}
