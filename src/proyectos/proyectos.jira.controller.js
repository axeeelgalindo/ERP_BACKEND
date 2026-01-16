// src/controllers/proyectos.jira.controller.js
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";

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
   Utils: query parsing + fechas
========================= */
function parseBool(v, def = true) {
  if (v === true || v === false) return v;
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y", "si"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return def;
}

function ensureDate(d) {
  const x = d instanceof Date ? d : d ? new Date(d) : null;
  return x && !Number.isNaN(x.getTime()) ? x : null;
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

function toISODateOrNull(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
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
   multipart/form-data con file
   query: ?hoursPerDay=8&overwrite=true
========================= */
export async function importJiraCSV(request, reply) {
  const scope = resolveScope(request);
  const { id: proyectoId } = request.params;

  // ✅ por si Fastify valida querystring y te llega string
  const overwrite = parseBool(request.query?.overwrite, true);
  const hoursPerDay = Number(request.query?.hoursPerDay) || 8; // (si después lo usas)

  // OJO: tu frontend envía FormData("file"), así que tu ruta backend
  // debe parsear el CSV y convertirlo a { rows: [...] } antes de llegar aquí,
  // o bien aquí debes parsear el archivo. Asumo que ya te llega rows.
  const { rows } = request.body || {};

  if (!Array.isArray(rows) || rows.length === 0) {
    return httpError(reply, 400, "No se recibieron filas (rows) del CSV");
  }

  // 1) Cargar proyecto + miembros (pool de responsables)
  const proyecto = await prisma.proyecto.findFirst({
    where: {
      id: proyectoId,
      eliminado: false,
      empresa: { eliminado: false },
      ...(scope.isMaster ? {} : { empresa_id: scope.empresaId }),
    },
    include: {
      miembros: {
        include: {
          empleado: { include: { usuario: true } },
        },
      },
    },
  });

  if (!proyecto) return httpError(reply, 404, "Proyecto no encontrado");

  const empleadosMiembros = (proyecto.miembros || [])
    .map((m) => m.empleado)
    .filter(Boolean);

  // 2) Normalizar filas Jira
  const normalized = rows
    .map((r) => {
      const summary = getCol(r, ["Summary", "Issue summary", "Resumen", "Título", "Title"]);
      const issueType = getCol(r, ["Issue Type", "Tipo", "Tipo de incidencia", "Type"]);
      const status = getCol(r, ["Status", "Estado"]);
      const assignee = getCol(r, ["Assignee", "Responsable", "Asignado a", "Asignado"]);
      const start = getCol(r, ["Start date", "Start", "Inicio", "Inicio plan", "Fecha inicio"]);
      const due = getCol(r, ["Due date", "Due", "Fin", "Fin plan", "Fecha fin"]);
      const epicName = getCol(r, ["Epic Name", "Epic", "Nombre épica", "Epic Summary"]);
      const parentKey = getCol(r, ["Parent", "Parent Key", "Parent key", "Parent issue"]);
      const key = getCol(r, ["Issue key", "Key", "Clave", "ID"]);

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

  // 3) Bucket: EPIC -> children
  const buckets = new Map(); // key -> { title, parentAssignee, children[] }

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
    const isEpic =
      typeNorm === "epic" || typeNorm.includes("epica") || typeNorm.includes("épica");

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

    // tarea suelta (sin epic/parent)
    ensureBucket(`TASK:${it.summary}`, it.summary);
  }

  // 4) Crear/actualizar tareas + detalles
  const created = { tareas: 0, detalles: 0, asignados: 0, skippedDetalles: 0 };

  for (const b of buckets.values()) {
    const parentTitle = b.title || "Sin título";

    // responsable del padre
    let responsablePadreId = null;
    if (b.parentAssignee) {
      responsablePadreId = pickBestEmpleadoId(b.parentAssignee, empleadosMiembros);
      if (responsablePadreId) created.asignados++;
    }

    // buscar tarea existente por (proyecto_id + nombre)
    let tarea = await prisma.tarea.findFirst({
      where: {
        proyecto_id: proyectoId,
        nombre: parentTitle,
        eliminado: false,
      },
    });

    // ✅ calcular fechas obligatorias del padre
    let padreInicio = null;
    let padreFin = null;

    if (Array.isArray(b.children) && b.children.length) {
      const starts = b.children.map((c) => ensureDate(c.startISO)).filter(Boolean);
      const dues = b.children.map((c) => ensureDate(c.dueISO)).filter(Boolean);

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

          // ✅ obligatorios en tu schema
          fecha_inicio_plan: padreInicio,
          fecha_fin_plan: padreFin,
          dias_plan: padreDiasPlan,

          source: "JIRA",
        },
      });
      created.tareas++;
    } else {
      // overwrite: si quieres que sobreescriba fechas del padre también
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
        // si ya existe, setea responsable solo si está vacío
        if (!tarea.responsable_id && responsablePadreId) {
          await prisma.tarea.update({
            where: { id: tarea.id },
            data: { responsable_id: responsablePadreId },
          });
          tarea = await prisma.tarea.findUnique({ where: { id: tarea.id } });
        }

        // si por algún motivo quedó sin fechas (viejo data), asegúralas
        if (!tarea?.fecha_inicio_plan || !tarea?.fecha_fin_plan) {
          await prisma.tarea.update({
            where: { id: tarea.id },
            data: {
              fecha_inicio_plan: tarea?.fecha_inicio_plan || padreInicio,
              fecha_fin_plan: tarea?.fecha_fin_plan || padreFin,
              dias_plan:
                tarea?.dias_plan ??
                daysBetweenInclusive(
                  tarea?.fecha_inicio_plan || padreInicio,
                  tarea?.fecha_fin_plan || padreFin
                ),
            },
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

        // fechas obligatorias en detalle
        const ini = ensureDate(ch.startISO) || tarea.fecha_inicio_plan || new Date();
        const fin = ensureDate(ch.dueISO) || tarea.fecha_fin_plan || ini;
        const diasPlan = daysBetweenInclusive(ini, fin);

        // evitar duplicado básico
        const exists = await prisma.tareaDetalle.findFirst({
          where: {
            tarea_id: tarea.id,
            titulo: ch.summary,
            eliminado: false,
          },
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
