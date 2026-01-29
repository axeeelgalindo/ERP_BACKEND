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
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
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

        const firstLine = text.split(/\r?\n/).find((l) => l.trim().length) || "";
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

  // DEBUG útil (déjalo un rato): confirma headers y 1ra fecha
  // request.log.info({ keys: Object.keys(rows[0] || {}) }, "CSV headers detectados");
  // request.log.info({ sample: rows[0] }, "CSV first row sample");

  const proyecto = await prisma.proyecto.findFirst({
    where: {
      id: proyectoId,
      eliminado: false,
      empresa: { eliminado: false },
      ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }),
    },
    include: {
      miembros: { include: { empleado: { include: { usuario: true } } } },
    },
  });

  if (!proyecto) return httpError(reply, 404, "Proyecto no encontrado");

  const empleadosMiembros = (proyecto.miembros || [])
    .map((m) => m.empleado)
    .filter(Boolean);

  // ✅ AQUÍ ESTÁ LA CLAVE: soporte a tus headers reales
  const normalized = rows
    .map((r) => {
      const summary = getCol(r, ["Summary", "Issue summary", "Resumen", "Título", "Title"]);
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

      // start: prioriza deducida si viene (tu CSV la trae)
      const start = getCol(r, [
        "Fecha de inicio deducida",
        "Start date",
        "Start",
        "Inicio",
        "Inicio plan",
        "Fecha inicio",
      ]);

      // due: tus columnas se llaman "Fecha de vencimiento"
      const due = getCol(r, [
        "Fecha de vencimiento deducida",
        "Fecha de vencimiento",
        "Due date",
        "Due",
        "Fin",
        "Fin plan",
        "Fecha fin",
      ]);

      const epicName = getCol(r, ["Epic Name", "Epic", "Nombre épica", "Epic Summary"]);
      const parentKey = getCol(r, [
        "Parent",
        "Parent Key",
        "Parent key",
        "Parent issue",
        "Principal",
      ]);

      const key = getCol(r, ["Issue key", "Key", "Clave", "ID", "Clave de incidencia"]);

      return {
        raw: r,
        key: key ? String(key).trim() : null,
        summary: summary ? String(summary).trim() : null,
        issueType: issueType ? String(issueType).trim() : null,
        status: status ? String(status).trim() : null,
        assignee: assignee ? String(assignee).trim() : null,
        startISO: toISODateOrNull(start),
        dueISO: toISODateOrNull(due),
        epicName: epicName ? String(epicName).trim() : null,
        parentKey: parentKey ? String(parentKey).trim() : null,
      };
    })
    .filter((x) => x.summary);

  const buckets = new Map();

  function ensureBucket(bucketKey, title) {
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, { title: title || null, parentAssignee: null, children: [] });
    } else {
      const b = buckets.get(bucketKey);
      if (!b.title && title) b.title = title;
    }
    return buckets.get(bucketKey);
  }

  for (const it of normalized) {
    const typeNorm = normName(it.issueType);
    const isEpic = typeNorm === "epic" || typeNorm.includes("epica") || typeNorm.includes("épica");

    if (isEpic) {
      const b = ensureBucket(`EPIC:${it.summary}`, it.summary);
      if (!b.parentAssignee && it.assignee) b.parentAssignee = it.assignee;
      continue;
    }

    if (it.epicName) {
      const b = ensureBucket(`EPIC:${it.epicName}`, it.epicName);
      b.children.push(it);
      continue;
    }

    if (it.parentKey) {
      const b = ensureBucket(`PARENT:${it.parentKey}`, `JIRA ${it.parentKey}`);
      b.children.push(it);
      continue;
    }

    ensureBucket(`TASK:${it.summary}`, it.summary);
  }

  const created = { tareas: 0, detalles: 0, asignados: 0, skippedDetalles: 0 };

  for (const b of buckets.values()) {
    const parentTitle = b.title || "Sin título";

    let responsablePadreId = null;
    if (b.parentAssignee) {
      responsablePadreId = pickBestEmpleadoId(b.parentAssignee, empleadosMiembros);
      if (responsablePadreId) created.asignados++;
    }

    let tarea = await prisma.tarea.findFirst({
      where: { proyecto_id: proyectoId, nombre: parentTitle, eliminado: false },
    });

    // ✅ fechas del padre: usa start/due reales
    let padreInicio = null;
    let padreFin = null;

    if (Array.isArray(b.children) && b.children.length) {
      const starts = b.children.map((c) => parseJiraDateToDate(c.startISO)).filter(Boolean);
      const dues = b.children.map((c) => parseJiraDateToDate(c.dueISO)).filter(Boolean);

      if (starts.length) padreInicio = new Date(Math.min(...starts.map((d) => d.getTime())));
      if (dues.length) padreFin = new Date(Math.max(...dues.map((d) => d.getTime())));
    }

    const hoy = new Date();
    if (!padreInicio) padreInicio = hoy;
    if (!padreFin) padreFin = padreInicio;

    const padreDiasPlan = daysBetweenInclusive(padreInicio, padreFin);

    if (!tarea) {
      tarea = await prisma.tarea.create({
        data: {
          proyecto_id: proyectoId,
          nombre: parentTitle,
          descripcion: null,
          estado: "pendiente",
          avance: 0,
          responsable_id: responsablePadreId,
          fecha_inicio_plan: padreInicio,
          fecha_fin_plan: padreFin,
          dias_plan: padreDiasPlan,
          source: "JIRA",
        },
      });
      created.tareas++;
    } else {
      if (overwrite) {
        await prisma.tarea.update({
          where: { id: tarea.id },
          data: {
            responsable_id: tarea.responsable_id || responsablePadreId || null,
            fecha_inicio_plan: padreInicio,
            fecha_fin_plan: padreFin,
            dias_plan: padreDiasPlan,
            source: tarea.source || "JIRA",
          },
        });
        tarea = await prisma.tarea.findUnique({ where: { id: tarea.id } });
      } else {
        if (!tarea.responsable_id && responsablePadreId) {
          await prisma.tarea.update({
            where: { id: tarea.id },
            data: { responsable_id: responsablePadreId },
          });
          tarea = await prisma.tarea.findUnique({ where: { id: tarea.id } });
        }
      }
    }

    // hijos => TareaDetalle
    if (Array.isArray(b.children) && b.children.length) {
      for (const ch of b.children) {
        const responsableDetalleId = ch.assignee
          ? pickBestEmpleadoId(ch.assignee, empleadosMiembros)
          : null;
        if (responsableDetalleId) created.asignados++;

        const ini = parseJiraDateToDate(ch.startISO) || tarea.fecha_inicio_plan || new Date();
        const fin = parseJiraDateToDate(ch.dueISO) || tarea.fecha_fin_plan || ini;

        const diasPlan = daysBetweenInclusive(ini, fin);

        const exists = await prisma.tareaDetalle.findFirst({
          where: { tarea_id: tarea.id, titulo: ch.summary, eliminado: false },
          select: { id: true },
        });

        if (exists) {
          if (overwrite) {
            await prisma.tareaDetalle.update({
              where: { id: exists.id },
              data: {
                descripcion: null,
                estado: normStatusToEstado(ch.status),
                fecha_inicio_plan: ini,
                fecha_fin_plan: fin,
                dias_plan: diasPlan,
                responsable_id: responsableDetalleId,
                source: "JIRA",
                jira_key: ch.key || null,
                jira_tipo: ch.issueType || null,
                jira_estado: ch.status || null,
              },
            });
          } else {
            created.skippedDetalles++;
          }
          continue;
        }

        await prisma.tareaDetalle.create({
          data: {
            tarea_id: tarea.id,
            titulo: ch.summary,
            descripcion: null,
            estado: normStatusToEstado(ch.status),
            avance: 0,
            fecha_inicio_plan: ini,
            fecha_fin_plan: fin,
            dias_plan: diasPlan,
            responsable_id: responsableDetalleId,
            eliminado: false,
            source: "JIRA",
            jira_key: ch.key || null,
            jira_tipo: ch.issueType || null,
            jira_estado: ch.status || null,
          },
        });

        created.detalles++;
      }
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
