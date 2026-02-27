// src/controllers/proyectos.jira.controller.js
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";
import csv from "csvtojson";

const prisma = new PrismaClient();

/* =========================
   Normalización y match de nombres
========================= */
function stripAccents(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normName(s) {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensOf(s) {
  const n = normName(s);
  if (!n) return [];
  return n.split(" ").filter(Boolean);
}

function scoreCandidate(importName, candidateFullName) {
  const a = tokensOf(importName);
  const b = tokensOf(candidateFullName);
  if (!a.length || !b.length) return 0;

  const setB = new Set(b);
  let hit = 0;
  for (const t of a) if (setB.has(t)) hit++;

  if (hit === 0) return 0;

  let score = hit / a.length;

  if (a[0] && b[0] && a[0] === b[0]) score += 0.25;
  if (hit === a.length) score += 0.25;
  if (b.length > a.length + 3) score -= 0.05;

  return score;
}

function pickBestEmpleadoId(importAssigneeName, empleadosMiembros) {
  const n = normName(importAssigneeName);
  if (!n) return null;

  let bestScore = 0;
  let bestId = null;

  for (const e of empleadosMiembros) {
    const candidato =
      e?.usuario?.nombre ||
      [e?.nombres, e?.apellido_paterno, e?.apellido_materno]
        .filter(Boolean)
        .join(" ")
        .trim();

    const sc = scoreCandidate(n, candidato);
    if (sc > bestScore) {
      bestScore = sc;
      bestId = e.id;
    }
  }

  return bestScore >= 0.55 ? bestId : null;
}

/* =========================
   Detectar delimitador (coma / punto y coma / tab)
========================= */
function detectDelimiter(firstLine) {
  const counts = {
    ",": (firstLine.match(/,/g) || []).length,
    ";": (firstLine.match(/;/g) || []).length,
    "\t": (firstLine.match(/\t/g) || []).length,
  };

  // elige el que más aparece en el header
  let best = ",";
  let bestCount = counts[","];
  for (const k of [";", "\t"]) {
    if (counts[k] > bestCount) {
      best = k;
      bestCount = counts[k];
    }
  }
  return best;
}

/* =========================
   Fechas Jira (robusto)
   soporta:
   - yyyy-mm-dd (ISO)
   - dd/mm/yyyy o dd-mm-yyyy
   - dd/mm/yyyy HH:mm (y similares)
========================= */
function parseJiraDateToDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  // ISO o yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // dd/mm/yyyy (con hora opcional)
  // ej: 01/12/2025 o 01/12/2025 10:30
  let m = s.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    const hh = m[4] != null ? Number(m[4]) : 0;
    const mi = m[5] != null ? Number(m[5]) : 0;
    const ss = m[6] != null ? Number(m[6]) : 0;

    const d = new Date(yyyy, mm - 1, dd, hh, mi, ss);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // último intento
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISODateOrNull(s) {
  const d = parseJiraDateToDate(s);
  return d ? d.toISOString() : null;
}

/* =========================
   Utils
========================= */
function parseBool(v, def = true) {
  if (v === true || v === false) return v;
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y", "si"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return def;
}

function daysBetweenInclusive(a, b) {
  const A = new Date(a);
  const B = new Date(b);
  A.setHours(0, 0, 0, 0);
  B.setHours(0, 0, 0, 0);
  const ms = B.getTime() - A.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, days);
}

/* =========================
   CSV columns flexibles (Jira export)
========================= */
function getCol(row, keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") return row[k];
  }
  return null;
}

function normStatusToEstado(s) {
  const v = normName(s);
  if (!v) return "pendiente";

  if (v.includes("final")) return "completa";
  if (v.includes("done")) return "completa";
  if (v.includes("complet")) return "completa";

  if (v.includes("curso")) return "en_progreso";
  if (v.includes("progress")) return "en_progreso";

  if (v.includes("to do")) return "pendiente";
  if (v.includes("hacer")) return "pendiente";
  if (v.includes("pend")) return "pendiente";

  return "pendiente";
}

/* =========================
   POST /proyectos/:id/jira/import
   ========================= */
/* =========================
   POST /proyectos/:id/jira/import
   Reglas nuevas:
   - Epic => epica
   - Historia => tarea
   - Tarea => tarea
   - Parent: usa "Principal" si viene; si no, cuelga del último Epic por orden.
========================= */
export async function importJiraCSV(request, reply) {
  const scope = resolveScope(request);
  const { id: proyectoId } = request.params;

  const overwrite = parseBool(request.query?.overwrite, true);

  let rows = null;

  try {
    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const buffer = await part.toBuffer();
        let text = buffer.toString("utf8");
        if (text.includes("Ã")) {
          text = buffer.toString("latin1"); // fallback típico Jira/Excel
        }
        const firstLine =
          text.split(/\r?\n/).find((l) => l.trim().length) || "";
        const delimiter = detectDelimiter(firstLine);

        rows = await csv({
          trim: true,
          ignoreEmpty: true,
          delimiter,
        }).fromString(text);

        break;
      }
    }
  } catch (err) {
    request.log.error({ err }, "Error leyendo/parsing CSV");
    return httpError(reply, 400, "No se pudo leer el archivo CSV");
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return httpError(reply, 400, "No se recibieron filas del CSV");
  }

  const proyecto = await prisma.proyecto.findFirst({
    where: {
      id: proyectoId,
      eliminado: false,
      empresa: { eliminado: false },
      ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }),
    },
    include: {
      miembros: {
        include: { empleado: { include: { usuario: true } } },
      },
    },
  });

  if (!proyecto) return httpError(reply, 404, "Proyecto no encontrado");

  const empleadosMiembros = (proyecto.miembros || [])
    .map((m) => m.empleado)
    .filter(Boolean);

  // -------------------------
  // Normalizar filas según headers reales (tu CSV Jira)
  // -------------------------
  const normalized = rows
    .map((r) => {
      const summary = getCol(r, [
        "Summary",
        "Issue summary",
        "Resumen",
        "Título",
        "Title",
      ]);

      const issueType = getCol(r, [
        "Issue Type",
        "Tipo",
        "Tipo de incidencia",
        "Tipo de Incidencia",
        "Type",
        "Tipo de Incidencia",
      ]);

      const status = getCol(r, ["Status", "Estado"]);

      const assignee = getCol(r, [
        "Assignee",
        "Persona asignada",
        "Responsable",
        "Asignado a",
        "Asignado",
      ]);

      const sprint = getCol(r, ["Sprint", "Sprints"]);

      const issueColor = getCol(r, ["Issue color", "Color", "Color de issue"]);

      const start = getCol(r, [
        "Fecha de inicio deducida",
        "Start date",
        "Start",
        "Inicio",
        "Inicio plan",
        "Fecha inicio",
      ]);

      const due = getCol(r, [
        "Fecha de vencimiento deducida",
        "Fecha de vencimiento",
        "Due date",
        "Due",
        "Fin",
        "Fin plan",
        "Fecha fin",
      ]);

      const parentKey = getCol(r, [
        "Principal",
        "Parent",
        "Parent Key",
        "Parent key",
        "Parent issue",
      ]);

      const key = getCol(r, [
        "Issue key",
        "Key",
        "Clave",
        "ID",
        "Clave de incidencia",
      ]);

      return {
        raw: r,
        key: key ? String(key).trim() : null,
        summary: summary ? String(summary).trim() : null,
        issueType: issueType ? String(issueType).trim() : null,
        status: status ? String(status).trim() : null,
        assignee: assignee ? String(assignee).trim() : null,
        sprint: sprint ? String(sprint).trim() : null,
        issueColor: issueColor ? String(issueColor).trim() : null,
        startDate: parseJiraDateToDate(start),
        dueDate: parseJiraDateToDate(due),
        parentKey: parentKey ? String(parentKey).trim() : null,
      };
    })
    .filter((x) => x.key && x.summary);

  // -------------------------
  // Helpers
  // -------------------------
  function isEpicType(issueType) {
    const t = normName(issueType);
    return t === "epic" || t.includes("epic") || t.includes("epica");
  }

  function estadoToAvance(estado) {
    return estado === "completa" ? 100 : 0;
  }

  function daysBetweenInclusive(a, b) {
    const A = new Date(a);
    const B = new Date(b);
    A.setHours(0, 0, 0, 0);
    B.setHours(0, 0, 0, 0);
    const ms = B.getTime() - A.getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(1, days);
  }

  // -------------------------
  // 1) Separar épicas y crear índice
  // -------------------------
  const epicRows = normalized.filter((r) => isEpicType(r.issueType));
  const byEpicKey = new Map(); // epicKey -> epicRow
  for (const er of epicRows) byEpicKey.set(er.key, er);

  const created = {
    epicasCreated: 0,
    epicasUpdated: 0,
    tareasCreated: 0,
    tareasUpdated: 0,
    asignados: 0,
    skippedTareas: 0,
    sinEpic: 0,
  };

  // -------------------------
  // 2) Upsert de EPICAS (solo Jira Epic)
  //    Estado/avance de épica se calculará luego con rollup.
  // -------------------------
  const epicIdByKey = new Map(); // epicKey -> epica.id

  for (const er of epicRows) {
    const epicaNombre = `${er.key} ${er.summary}`.trim();

    const responsableEpicaId = er.assignee
      ? pickBestEmpleadoId(er.assignee, empleadosMiembros)
      : null;
    if (responsableEpicaId) created.asignados++;

    // Fechas épica: usa las del epic si existen; si no, placeholders (las corregimos con rollup después)
    const hoy = new Date();
    const ini = er.startDate || hoy;
    const fin = er.dueDate || ini;
    const diasPlan = daysBetweenInclusive(ini, fin);

    const where = {
      proyecto_id_jira_key: { proyecto_id: proyectoId, jira_key: er.key },
    };

    const existing = await prisma.epica.findUnique({ where }).catch(() => null);

    if (!existing) {
      const ep = await prisma.epica.create({
        data: {
          proyecto_id: proyectoId,
          nombre: epicaNombre,
          descripcion: null,
          estado: normStatusToEstado(er.status),
          avance: estadoToAvance(normStatusToEstado(er.status)),

          fecha_inicio_plan: ini,
          fecha_fin_plan: fin,
          dias_plan: diasPlan,

          source: "JIRA",
          jira_key: er.key,
          jira_estado: er.status || null,
          jira_sprint: er.sprint || null,
          jira_issue_color: er.issueColor || null,
        },
      });
      epicIdByKey.set(er.key, ep.id);
      created.epicasCreated++;
    } else {
      epicIdByKey.set(er.key, existing.id);

      if (overwrite) {
        await prisma.epica.update({
          where: { id: existing.id },
          data: {
            nombre: epicaNombre,
            estado: normStatusToEstado(er.status),
            avance: estadoToAvance(normStatusToEstado(er.status)),

            fecha_inicio_plan: ini,
            fecha_fin_plan: fin,
            dias_plan: diasPlan,

            source: "JIRA",
            jira_key: er.key,
            jira_estado: er.status || existing.jira_estado || null,
            jira_sprint: er.sprint || existing.jira_sprint || null,
            jira_issue_color:
              er.issueColor || existing.jira_issue_color || null,
          },
        });
        created.epicasUpdated++;
      }
    }
  }

  // -------------------------
  // 3) Crear TAREAS desde Historia/Tarea
  //    Parent epic:
  //      - si trae parentKey => ese
  //      - si no => último Epic visto por orden en el CSV
  // -------------------------
  let currentEpicKey = null;

  // Guardamos tareas por épica para luego hacer rollup de estado/fechas
  const tareasPorEpica = new Map(); // epicKey -> array de tareas (normalized row)

  for (const row of normalized) {
    const epicRow = isEpicType(row.issueType);

    if (epicRow) {
      currentEpicKey = row.key;
      continue; // ya lo procesamos como epica arriba
    }

    // Historia/Tarea => tarea
    const epicKey = row.parentKey || currentEpicKey || null;

    if (!epicKey) {
      created.sinEpic++;
      continue;
    }

    // si el CSV trae parentKey pero no existe épica (raro), intentamos igual:
    if (!epicIdByKey.has(epicKey)) {
      // puedes decidir crear una épica "fantasma", pero por ahora lo contamos y saltamos
      created.sinEpic++;
      continue;
    }

    if (!tareasPorEpica.has(epicKey)) tareasPorEpica.set(epicKey, []);
    tareasPorEpica.get(epicKey).push(row);

    const tareaNombre = `${row.key} ${row.summary}`.trim();
    const tareaEstado = normStatusToEstado(row.status);
    const tareaAvance = estadoToAvance(tareaEstado);

    const responsableTareaId = row.assignee
      ? pickBestEmpleadoId(row.assignee, empleadosMiembros)
      : null;
    if (responsableTareaId) created.asignados++;

    const ini = row.startDate || new Date();
    const fin = row.dueDate || ini;
    const diasPlan = daysBetweenInclusive(ini, fin);

    const where = {
      proyecto_id_jira_key: { proyecto_id: proyectoId, jira_key: row.key },
    };

    const existing = await prisma.tarea.findUnique({ where }).catch(() => null);

    if (!existing) {
      await prisma.tarea.create({
        data: {
          proyecto_id: proyectoId,
          epica_id: epicIdByKey.get(epicKey), // 👈 si tu FK se llama distinto, cambia aquí
          nombre: tareaNombre,
          descripcion: null,
          estado: tareaEstado,
          avance: tareaAvance,
          responsable_id: responsableTareaId,
          fecha_inicio_plan: ini,
          fecha_fin_plan: fin,
          dias_plan: diasPlan,
          source: "JIRA",
          jira_key: row.key,
          jira_tipo: row.issueType || null,
          jira_estado: row.status || null,
          jira_sprint: row.sprint || null,
          jira_issue_color: row.issueColor || null,
        },
      });
      created.tareasCreated++;
    } else {
      if (overwrite) {
        await prisma.tarea.update({
          where: { id: existing.id },
          data: {
            epica_id: epicIdByKey.get(epicKey), // 👈 y aquí
            nombre: tareaNombre,
            estado: tareaEstado,
            avance: tareaAvance,
            responsable_id:
              responsableTareaId || existing.responsable_id || null,
            fecha_inicio_plan: ini,
            fecha_fin_plan: fin,
            dias_plan: diasPlan,
            source: "JIRA",
            jira_key: row.key,
            jira_tipo: row.issueType || existing.jira_tipo || null,
            jira_estado: row.status || existing.jira_estado || null,
            jira_sprint: row.sprint || existing.jira_sprint || null,
            jira_issue_color:
              row.issueColor || existing.jira_issue_color || null,
          },
        });
        created.tareasUpdated++;
      } else {
        created.skippedTareas++;
      }
    }
  }

  // -------------------------
  // 4) Rollup épica desde sus tareas:
  //    - estado: todas completas => completa; alguna en progreso => en_progreso; si no => pendiente
  //    - fechas: min inicio / max fin
  //    - avance: promedio de avances (0/100)
  // -------------------------
  for (const [epicKey, tareas] of tareasPorEpica.entries()) {
    if (!tareas.length) continue;

    const epicaId = epicIdByKey.get(epicKey);
    if (!epicaId) continue;

    const estados = tareas.map((t) => normStatusToEstado(t.status));
    const avances = estados.map((e) => (e === "completa" ? 100 : 0));

    const allCompletas = estados.every((e) => e === "completa");
    const anyEnProgreso = estados.some((e) => e === "en_progreso");
    const allPendientes = estados.every((e) => e === "pendiente");

    let estadoRollup = "pendiente";
    if (allCompletas) estadoRollup = "completa";
    else if (anyEnProgreso) estadoRollup = "en_progreso";
    else if (allPendientes) estadoRollup = "pendiente";
    else estadoRollup = "en_progreso";

    const avgAvance = Math.round(
      avances.reduce((s, a) => s + a, 0) / Math.max(1, avances.length),
    );

    const starts = tareas.map((t) => t.startDate).filter(Boolean);
    const dues = tareas.map((t) => t.dueDate).filter(Boolean);

    const ini = starts.length
      ? new Date(Math.min(...starts.map((d) => d.getTime())))
      : null;

    const fin = dues.length
      ? new Date(Math.max(...dues.map((d) => d.getTime())))
      : ini;

    if (overwrite && (ini || fin)) {
      const i = ini || new Date();
      const f = fin || i;
      const diasPlan = daysBetweenInclusive(i, f);

      await prisma.epica.update({
        where: { id: epicaId },
        data: {
          estado: estadoRollup,
          avance: Math.max(0, Math.min(100, avgAvance)),
          fecha_inicio_plan: i,
          fecha_fin_plan: f,
          dias_plan: diasPlan,
        },
      });
    } else if (overwrite) {
      await prisma.epica.update({
        where: { id: epicaId },
        data: {
          estado: estadoRollup,
          avance: Math.max(0, Math.min(100, avgAvance)),
        },
      });
    }
  }

  return reply.send({
    ok: true,
    message: "Import Jira OK (Epic->Epica, Historia/Tarea->Tarea)",
    created,
    overwrite,
  });
}
