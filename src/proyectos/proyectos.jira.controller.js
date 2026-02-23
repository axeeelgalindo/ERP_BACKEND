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
export async function importJiraCSV(request, reply) {
  const scope = resolveScope(request);
  const { id: proyectoId } = request.params;

  const overwrite = parseBool(request.query?.overwrite, true);
  const hoursPerDay = Number(request.query?.hoursPerDay) || 8;

  let rows = null;

  try {
    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const buffer = await part.toBuffer();
        const text = buffer.toString("utf8");
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
  // Normalizar filas según headers reales (tu CSV)
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
    .filter((x) => x.summary && x.key);

  // -------------------------
  // Indexar por key y agrupar hijos por Principal (parentKey)
  // -------------------------
  const byKey = new Map(); // key -> issue row
  const childrenByParent = new Map(); // parentKey -> [rows]

  for (const it of normalized) {
    byKey.set(it.key, it);

    if (it.parentKey) {
      if (!childrenByParent.has(it.parentKey))
        childrenByParent.set(it.parentKey, []);
      childrenByParent.get(it.parentKey).push(it);
    }
  }

  // Padres = (a) todos los que tienen hijos, (b) también los top-level sin parentKey
  const parentKeys = new Set();
  for (const pk of childrenByParent.keys()) parentKeys.add(pk);
  for (const it of normalized) {
    if (!it.parentKey) parentKeys.add(it.key);
  }

  const created = {
    tareasCreated: 0,
    tareasUpdated: 0,
    detallesCreated: 0,
    detallesUpdated: 0,
    asignados: 0,
    skippedDetalles: 0,
  };

  function estadoToAvance(estado) {
    return estado === "completa" ? 100 : 0;
  }

  function calcAvancePadreFromChildren(children) {
    if (!children.length) return null;
    const avances = children.map((c) =>
      normStatusToEstado(c.status) === "completa" ? 100 : 0,
    );
    const avg = Math.round(avances.reduce((s, a) => s + a, 0) / avances.length);
    return Math.max(0, Math.min(100, avg));
  }

  // -------------------------
  // Import por cada padre
  // -------------------------
  for (const pKey of parentKeys) {
    const parentRow = byKey.get(pKey) || null;
    const children = childrenByParent.get(pKey) || [];

    // Nombre del padre: "O2-2 Automatización ..." (key + summary)
    const parentNombre = parentRow
      ? `${parentRow.key} ${parentRow.summary}`.trim()
      : `JIRA ${pKey}`.trim();
    // Estado base desde Jira padre (si existe)
    let parentEstado = parentRow
      ? normStatusToEstado(parentRow.status)
      : "pendiente";

    // ✅ Rollup desde subtareas (si hay)
    if (children.length > 0) {
      const estadosHijos = children.map((c) => normStatusToEstado(c.status));

      const allCompletas = estadosHijos.every((e) => e === "completa");
      const anyEnProgreso = estadosHijos.some((e) => e === "en_progreso");
      const allPendientes = estadosHijos.every((e) => e === "pendiente");

      if (allCompletas) parentEstado = "completa";
      else if (anyEnProgreso) parentEstado = "en_progreso";
      else if (allPendientes) parentEstado = "pendiente";
      else parentEstado = "en_progreso"; // mixto (pendiente+completa)
    }
    
    let parentAvance = estadoToAvance(parentEstado);
    const avg = calcAvancePadreFromChildren(children);
    if (avg != null) parentAvance = avg;

    // Responsable padre
    let responsablePadreId = null;
    if (parentRow?.assignee) {
      responsablePadreId = pickBestEmpleadoId(
        parentRow.assignee,
        empleadosMiembros,
      );
      if (responsablePadreId) created.asignados++;
    }

    // Fechas padre: prioriza las del padre, si no, min/max de hijos, si no, hoy
    const starts = [];
    const dues = [];

    if (parentRow?.startDate) starts.push(parentRow.startDate);
    if (parentRow?.dueDate) dues.push(parentRow.dueDate);

    for (const ch of children) {
      if (ch.startDate) starts.push(ch.startDate);
      if (ch.dueDate) dues.push(ch.dueDate);
    }

    let padreInicio = starts.length
      ? new Date(Math.min(...starts.map((d) => d.getTime())))
      : null;
    let padreFin = dues.length
      ? new Date(Math.max(...dues.map((d) => d.getTime())))
      : null;

    const hoy = new Date();
    if (!padreInicio) padreInicio = hoy;
    if (!padreFin) padreFin = padreInicio;

    const padreDiasPlan = daysBetweenInclusive(padreInicio, padreFin);

    // Upsert por unique (proyecto_id, jira_key)
    // Prisma suele generar: { proyecto_id_jira_key: { proyecto_id, jira_key } }
    const tareaWhere = {
      proyecto_id_jira_key: { proyecto_id: proyectoId, jira_key: pKey },
    };

    let tarea = null;

    const existing = await prisma.tarea
      .findUnique({ where: tareaWhere })
      .catch(() => null);

    if (!existing) {
      tarea = await prisma.tarea.create({
        data: {
          proyecto_id: proyectoId,
          nombre: parentNombre,
          descripcion: null,
          estado: parentEstado,
          avance: parentAvance,
          responsable_id: responsablePadreId,
          fecha_inicio_plan: padreInicio,
          fecha_fin_plan: padreFin,
          dias_plan: padreDiasPlan,
          source: "JIRA",
          jira_key: pKey,
          jira_tipo: parentRow?.issueType || null,
          jira_estado: parentRow?.status || null,
          jira_sprint: parentRow?.sprint || null,
          jira_issue_color: parentRow?.issueColor || null,
        },
      });
      created.tareasCreated++;
    } else {
      tarea = existing;

      if (overwrite) {
        await prisma.tarea.update({
          where: { id: tarea.id },
          data: {
            nombre: parentNombre, // ✅ evita que te quede “Automatización...” sin key
            estado: parentEstado, // ✅ respeta “Finalizada”
            avance: parentAvance,
            responsable_id: responsablePadreId || tarea.responsable_id || null,
            fecha_inicio_plan: padreInicio,
            fecha_fin_plan: padreFin,
            dias_plan: padreDiasPlan,
            source: "JIRA",
            jira_key: pKey,
            jira_tipo: parentRow?.issueType || tarea.jira_tipo || null,
            jira_estado: parentRow?.status || tarea.jira_estado || null,
            jira_sprint: parentRow?.sprint || tarea.jira_sprint || null,
            jira_issue_color:
              parentRow?.issueColor || tarea.jira_issue_color || null,
          },
        });
        created.tareasUpdated++;
        tarea = await prisma.tarea.findUnique({ where: { id: tarea.id } });
      }
    }

    // -------------------------
    // Hijos => TareaDetalle
    // -------------------------
    for (const ch of children) {
      const detalleEstado = normStatusToEstado(ch.status);
      const detalleAvance = estadoToAvance(detalleEstado);

      const responsableDetalleId = ch.assignee
        ? pickBestEmpleadoId(ch.assignee, empleadosMiembros)
        : null;
      if (responsableDetalleId) created.asignados++;

      const ini = ch.startDate || tarea.fecha_inicio_plan || new Date();
      const fin = ch.dueDate || tarea.fecha_fin_plan || ini;
      const diasPlan = daysBetweenInclusive(ini, fin);

      // Mostrar subtarea con key también (más fiel a Jira)
      const titulo = `${ch.key} ${ch.summary}`.trim();

      // Si viene jira_key, úsalos como identity. Si no, cae a titulo.
      let existingDetalle = null;

      if (ch.key) {
        existingDetalle = await prisma.tareaDetalle
          .findFirst({
            where: { tarea_id: tarea.id, jira_key: ch.key, eliminado: false },
            select: { id: true },
          })
          .catch(() => null);
      }

      if (!existingDetalle) {
        existingDetalle = await prisma.tareaDetalle
          .findFirst({
            where: { tarea_id: tarea.id, titulo, eliminado: false },
            select: { id: true },
          })
          .catch(() => null);
      }

      if (existingDetalle) {
        if (overwrite) {
          await prisma.tareaDetalle.update({
            where: { id: existingDetalle.id },
            data: {
              titulo,
              descripcion: null,
              estado: detalleEstado,
              avance: detalleAvance,
              fecha_inicio_plan: ini,
              fecha_fin_plan: fin,
              dias_plan: diasPlan,
              responsable_id: responsableDetalleId,
              source: "JIRA",
              jira_key: ch.key || null,
              jira_tipo: ch.issueType || null,
              jira_estado: ch.status || null,
              jira_sprint: ch.sprint || null,
              jira_issue_color: ch.issueColor || null,
            },
          });
          created.detallesUpdated++;
        } else {
          created.skippedDetalles++;
        }
        continue;
      }

      await prisma.tareaDetalle.create({
        data: {
          tarea_id: tarea.id,
          titulo,
          descripcion: null,
          estado: detalleEstado,
          avance: detalleAvance,
          fecha_inicio_plan: ini,
          fecha_fin_plan: fin,
          dias_plan: diasPlan,
          responsable_id: responsableDetalleId,
          eliminado: false,
          source: "JIRA",
          jira_key: ch.key || null,
          jira_tipo: ch.issueType || null,
          jira_estado: ch.status || null,
          jira_sprint: ch.sprint || null,
          jira_issue_color: ch.issueColor || null,
        },
      });
      created.detallesCreated++;
    }
  }

  return reply.send({
    ok: true,
    message: "Import Jira OK",
    created,
    overwrite,
    hoursPerDay,
  });
}
