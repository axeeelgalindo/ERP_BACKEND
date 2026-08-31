// src/controllers/compras/controllers.js
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";
import { parse } from "csv-parse/sync";

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";

import { analizarCotizacionConOllama } from "../modules/ia/ollama.service.js";
import { extraerTextoDeDocumento } from "../modules/documentos/document-parser.service.js";

const prisma = new PrismaClient();

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;

/* =========================
   Helpers
========================= */
function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string")
    return ["1", "true", "on", "yes"].includes(v.toLowerCase());
  return false;
}

function normalizeEstadoCompra(v) {
  if (!v) return undefined;
  const s = String(v).trim().toUpperCase();
  if (["ORDEN_COMPRA", "FACTURADA", "PAGADA"].includes(s)) return s;
  return undefined;
}

async function assertEntidadEmpresa(tx, tabla, id, empresaId) {
  if (!id) return;

  const map = {
    proyecto: () =>
      tx.proyecto.findFirst({
        where: { id, empresa_id: empresaId, eliminado: false },
        select: { id: true },
      }),
    proveedor: () =>
      tx.proveedor.findFirst({
        where: { id, empresa_id: empresaId, eliminado: false },
        select: { id: true },
      }),
    producto: () =>
      tx.producto.findFirst({
        where: { id, empresa_id: empresaId, eliminado: false },
        select: { id: true },
      }),
    cotizacion: () =>
      tx.cotizacion.findFirst({
        where: { id, empresa_id: empresaId, eliminado: false },
        select: { id: true },
      }),
    // ✅ tu costeo es Venta (si Venta tiene empresa_id, agrega filtro aquí)
    venta: () =>
      tx.venta.findFirst({
        where: { id },
        select: { id: true },
      }),
  };

  const q = map[tabla];
  if (!q) return;

  const ok = await q();
  if (!ok)
    throw Object.assign(new Error(`${tabla} no pertenece a tu empresa`), {
      statusCode: 403,
    });
}

function calcTotal(items = []) {
  return items.reduce((acc, it) => {
    const cantidad = Number(it.cantidad || 0);
    const precio = Number(it.precio_unit ?? it.precio_unitario ?? 0);
    return acc + cantidad * precio;
  }, 0);
}

function parseCLP(v) {
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const cleaned = s.replace(/\./g, "").replace(/,/g, "."); // por si viniera con coma
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseDateDMY(v) {
  // "01/12/2025"
  const s = String(v ?? "").trim();
  if (!s) return null;
  const [dd, mm, yyyy] = s.split("/");
  if (!dd || !mm || !yyyy) return null;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateTimeDMY(v) {
  // "01/12/2025 10:32:11"
  const s = String(v ?? "").trim();
  if (!s) return null;

  const [datePart, timePart] = s.split(" ");
  if (!datePart) return null;

  const [dd, mm, yyyy] = datePart.split("/");
  if (!dd || !mm || !yyyy) return null;

  let hh = 0,
    mi = 0,
    ss = 0;
  if (timePart) {
    const parts = timePart.split(":");
    hh = Number(parts[0] ?? 0);
    mi = Number(parts[1] ?? 0);
    ss = Number(parts[2] ?? 0);
  }

  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), hh, mi, ss);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIntOrNull(v) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function normRut(v) {
  return String(v ?? "").trim();
}

function normStr(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

/* =========================
   Vinculación Compra -> Costeo (Venta)
========================= */
/* Helper functions removed as the RCV import restriction was disabled */

async function attachVinculadoPct(empresa_id, compras) {
  const ids = compras.map((c) => c.id);
  if (!ids.length) return compras;

  const sums = await prisma.compraCosteo.groupBy({
    by: ["compra_id"],
    where: { empresa_id, compra_id: { in: ids } },
    _sum: { monto: true },
  });

  const map = new Map(
    sums.map((x) => [x.compra_id, Number(x._sum.monto || 0)])
  );

  return compras.map((c) => {
    const sum = map.get(c.id) || 0;
    const pct = c.total > 0 ? Math.min(1, sum / c.total) : 0;
    return { ...c, vinculadoMonto: sum, vinculadoPct: pct };
  });
}

/* =========================
   PDFs (facturas)
   Se guardan en: <proyecto>/uploads/facturas/<empresaId>/<archivo>.pdf
   Se sirven por: /api/uploads/* (fastify-static en server.js)
   URL guardada en DB: /uploads/facturas/<empresaId>/<archivo>.pdf
========================= */
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

function facturasDir(empresaId) {
  return path.join(UPLOADS_ROOT, "facturas", String(empresaId));
}

function facturasPublicPrefix(empresaId) {
  return `/uploads/facturas/${String(empresaId)}`;
}

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true });
}

function safeFileName(name) {
  const base = String(name || "factura.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.toLowerCase();
}

/* =========================
   IMPORT CSV (RCV)
========================= */
export async function importComprasCSV(request, reply) {
  const scope = resolveScope(request);

  const file = await request.file();
  if (!file)
    return httpError(
      reply,
      400,
      "Debes enviar un archivo CSV en form-data (file)"
    );

  const empresa_id = scope.empresaId;

  try {
    const buf = await file.toBuffer();
    const text = buf.toString("utf-8");

    const records = parse(text, {
      columns: true,
      delimiter: ";",
      skip_empty_lines: true,
      bom: true,
      relax_quotes: true,
      relax_column_count: true,
      trim: true,
    });

    if (!Array.isArray(records) || records.length === 0) {
      return httpError(reply, 400, "CSV vacío o formato inválido");
    }

    // Bloque de validación eliminado para permitir importación sin restricciones de vinculación

    let created = 0;
    let skipped = 0;
    const errors = [];

    const chunkSize = 50;

    for (let start = 0; start < records.length; start += chunkSize) {
      const chunk = records.slice(start, start + chunkSize);

      await prisma.$transaction(async (tx) => {
        for (let j = 0; j < chunk.length; j++) {
          const i = start + j;
          const row = chunk[j];

          try {
            const tipoDoc = toIntOrNull(row["Tipo Doc"]);
            const rutProv = normRut(row["RUT Proveedor"]);
            const razon = normStr(row["Razon Social"]);
            const folio = normStr(row["Folio"]);

            const fechaDocto = parseDateDMY(row["Fecha Docto"]);
            const fechaRecep = parseDateTimeDMY(row["Fecha Recepcion"]);

            const montoTotal = parseCLP(row["Monto Total"]);

            if (!rutProv || !folio || montoTotal <= 0) {
              throw new Error(
                `Fila inválida: rutProv=${rutProv || "-"} folio=${folio || "-"
                } montoTotal=${montoTotal}`
              );
            }

            // 1) proveedor por rut
            let prov = await tx.proveedor.findFirst({
              where: { empresa_id, eliminado: false, rut: rutProv },
              select: { id: true },
            });

            if (!prov) {
              prov = await tx.proveedor.create({
                data: {
                  empresa_id,
                  rut: rutProv,
                  nombre: razon || rutProv,
                },
                select: { id: true },
              });
            }
            // 2) dedupe: empresa + proveedor + tipo_doc + folio
            const exists = await tx.compra.findFirst({
              where: {
                empresa_id,
                proveedorId: prov.id,
                folio,
                tipo_doc: tipoDoc,
                eliminado: false,
              },
              select: { id: true },
            });

            if (exists) {
              skipped++;
              continue;
            }

            // 4) crear compra
            await tx.compra.create({
              data: {
                empresa_id,
                proveedorId: prov.id,

                estado: "FACTURADA",
                total: montoTotal,

                tipo_doc: tipoDoc,
                folio,
                rut_proveedor: rutProv,
                razon_social: razon,
                fecha_docto: fechaDocto,
                fecha_recepcion: fechaRecep,

                items: {
                  create: [
                    {
                      item: `RCV ${tipoDoc ?? ""} Folio ${folio}`.trim(),
                      cantidad: 1,
                      precio_unit: montoTotal,
                      total: montoTotal,
                      proveedor_id: prov.id,
                    },
                  ],
                },
              },
            });

            created++;
          } catch (e) {
            errors.push({
              row: i + 1,
              msg: e?.message || String(e),
            });
          }
        }
      });
    }

    return reply.send({
      ok: true,
      filename: file.filename,
      totalRows: records.length,
      created,
      skipped,
      errorsCount: errors.length,
      errors: errors.slice(0, 50),
    });
  } catch (e) {
    return reply.code(500).send({
      error: "Error importando CSV",
      detalle: e?.message || String(e),
    });
  }
}

/* ==========================================================
   CHECK RCV DOCUMENTS (Descarte de FAC ya cargadas y asignadas a COT)
   ========================================================== */
export async function checkRcvDocuments(request, reply) {
  const scope = resolveScope(request);
  const empresa_id = scope.empresaId;
  const { items } = request.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return httpError(reply, 400, "Debes enviar un listado de documentos para verificar");
  }

  // Pre-cargar folios para consultar compras existentes
  const folios = items
    .map((it) => String(it.folio || it["Folio"] || "").trim())
    .filter(Boolean);

  const existingCompras = await prisma.compra.findMany({
    where: {
      empresa_id,
      eliminado: false,
      folio: { in: folios },
    },
    select: {
      id: true,
      folio: true,
      tipo_doc: true,
      rut_proveedor: true,
      proveedorId: true,
      proyecto_id: true,
      cotizacionId: true,
      destino: true,
      centro_costo: true,
      proveedor: {
        select: {
          id: true,
          rut: true,
        },
      },
    },
  });

  const validItems = [];
  const discardedItems = [];

  for (let i = 0; i < items.length; i++) {
    const row = items[i];
    const tipoDoc = toIntOrNull(row.tipo_doc || row["Tipo Doc"]);
    const rutProv = normRut(row.rut_proveedor || row["RUT Proveedor"]);
    const cleanRut = rutProv.toLowerCase().replace(/[^0-9k]/g, "");
    const folio = normStr(row.folio || row["Folio"]);

    // Buscar coincidencia en las compras existentes
    const match = existingCompras.find((c) => {
      const matchFolio = String(c.folio || "").trim() === folio;
      const matchTipo =
        (c.tipo_doc == null && tipoDoc == null) ||
        Number(c.tipo_doc) === Number(tipoDoc);

      const dbRutComp = (c.rut_proveedor || "").toLowerCase().replace(/[^0-9k]/g, "");
      const dbRutProv = (c.proveedor?.rut || "").toLowerCase().replace(/[^0-9k]/g, "");

      const matchRut =
        (!cleanRut && !dbRutComp && !dbRutProv) ||
        (cleanRut && (dbRutComp === cleanRut || dbRutProv === cleanRut));

      return matchFolio && matchTipo && matchRut;
    });

    if (match) {
      // Criterio de descarte: Ya asignada a COT (proyecto_id o cotizacionId)
      const estaAsignadaCot = Boolean(
        match.proyecto_id ||
        match.cotizacionId ||
        (match.destino === "PROYECTO" && match.proyecto_id)
      );

      if (estaAsignadaCot) {
        discardedItems.push({
          ...row,
          compra_id: match.id,
          razon_descarte: "Ya registrada y asignada a COT",
        });
        continue;
      }

      // Si existe en BD pero NO está asignada a COT -> Mantener para permitir asignación masiva
      validItems.push({
        ...row,
        ya_cargada: true,
        compra_id: match.id,
        destino_actual: match.destino,
        centro_costo_actual: match.centro_costo,
      });
    } else {
      // Documento nuevo
      validItems.push({
        ...row,
        ya_cargada: false,
      });
    }
  }

  return reply.send({
    ok: true,
    totalCount: items.length,
    discardedCount: discardedItems.length,
    validCount: validItems.length,
    validItems,
    discardedItems,
  });
}

/* ==========================================================
   IMPORT RCV CLASIFICADO (Con Centro de Costo / Proyecto)
   ========================================================== */
export async function importComprasClassified(request, reply) {
  const scope = resolveScope(request);
  const empresa_id = scope.empresaId;
  const { items } = request.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return httpError(reply, 400, "Debes enviar un listado de documentos para importar");
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  const chunkSize = 50;

  for (let start = 0; start < items.length; start += chunkSize) {
    const chunk = items.slice(start, start + chunkSize);

    await prisma.$transaction(async (tx) => {
      for (let j = 0; j < chunk.length; j++) {
        const i = start + j;
        const row = chunk[j];

        try {
          const tipoDoc = toIntOrNull(row.tipo_doc || row["Tipo Doc"]);
          const rutProv = normRut(row.rut_proveedor || row["RUT Proveedor"]);
          const razon = normStr(row.razon_social || row["Razon Social"]);
          const folio = normStr(row.folio || row["Folio"]);

          let fechaDocto = row.fecha_docto ? new Date(row.fecha_docto) : null;
          if (!fechaDocto || isNaN(fechaDocto.getTime())) {
            fechaDocto = parseDateDMY(row["Fecha Docto"]) || null;
          }

          let fechaRecep = row.fecha_recepcion ? new Date(row.fecha_recepcion) : null;
          if (!fechaRecep || isNaN(fechaRecep.getTime())) {
            fechaRecep = parseDateTimeDMY(row["Fecha Recepcion"]) || null;
          }

          const montoTotal = Number(row.total || row.monto_total || parseCLP(row["Monto Total"]) || 0);

          if (!rutProv || !folio || montoTotal <= 0) {
            throw new Error(`Fila inválida: RUT=${rutProv || "-"} Folio=${folio || "-"} Monto=${montoTotal}`);
          }

          // 1) Proveedor
          let prov = await tx.proveedor.findFirst({
            where: { empresa_id, eliminado: false, rut: rutProv },
            select: { id: true },
          });

          if (!prov) {
            prov = await tx.proveedor.create({
              data: {
                empresa_id,
                rut: rutProv,
                nombre: razon || rutProv,
              },
              select: { id: true },
            });
          }

          // Normalización de destino y centro de costo
          let destino = "PROYECTO";
          if (["ADMINISTRACION", "TALLER", "SERVICIO", "PROYECTO"].includes(String(row.destino).toUpperCase())) {
            destino = String(row.destino).toUpperCase();
          }

          let centro_costo = null;
          if (["PMC", "PUQ"].includes(String(row.centro_costo).toUpperCase())) {
            centro_costo = String(row.centro_costo).toUpperCase();
          }

          let proyecto_id = null;
          if (destino === "PROYECTO" && row.proyecto_id) {
            proyecto_id = String(row.proyecto_id);
          }

          // 2) Deduplicación / Actualización si ya existe
          const exists = await tx.compra.findFirst({
            where: {
              empresa_id,
              proveedorId: prov.id,
              folio,
              tipo_doc: tipoDoc,
              eliminado: false,
            },
            select: { id: true },
          });

          if (exists) {
            // Actualizar asignación de la compra existente
            await tx.compra.update({
              where: { id: exists.id },
              data: {
                destino,
                centro_costo,
                sub_destino: row.sub_destino || null,
                proyecto_id,
              },
            });
            updated++;
            continue;
          }

          const subtotalCalc = Math.round(montoTotal / 1.19);
          const ivaCalc = Math.round(montoTotal - subtotalCalc);

          // 4) Crear compra
          await tx.compra.create({
            data: {
              empresa_id,
              proveedorId: prov.id,
              estado: "FACTURADA",
              total: montoTotal,
              subtotal: subtotalCalc,
              impuestos: ivaCalc,
              tipo_doc: tipoDoc,
              folio,
              rut_proveedor: rutProv,
              razon_social: razon,
              fecha_docto: fechaDocto,
              fecha_recepcion: fechaRecep,
              destino,
              centro_costo,
              sub_destino: row.sub_destino || null,
              proyecto_id,
              items: {
                create: [
                  {
                    item: `RCV ${tipoDoc ?? ""} Folio ${folio}`.trim(),
                    cantidad: 1,
                    precio_unit: montoTotal,
                    total: montoTotal,
                    proveedor_id: prov.id,
                  },
                ],
              },
            },
          });

          created++;
        } catch (e) {
          errors.push({
            row: i + 1,
            msg: e?.message || String(e),
          });
        }
      }
    });
  }

  return reply.send({
    ok: true,
    totalRows: items.length,
    created,
    updated,
    skipped,
    errorsCount: errors.length,
    errors: errors.slice(0, 50),
  });
}

/* =========================
   LIST
========================= */
export async function listCompras(request, reply) {
  const scope = resolveScope(request);

  const {
    q,
    estado,
    periodo, // ✅ NUEVO: YYYY-MM
    startDate,
    endDate,
    proveedorId,
    proyectoId,
    cotizacionId,
    includeDeleted,
    empresaId, // solo master
    page = DEFAULT_PAGE,
    pageSize = DEFAULT_SIZE,
  } = request.query || {};

  const empresa_id = scope.isMaster ? empresaId || scope.empresaId : scope.empresaId;

  const pageN = Math.max(1, toInt(page, DEFAULT_PAGE));
  const sizeN = Math.min(100, Math.max(1, toInt(pageSize, DEFAULT_SIZE)));

  const estadoNorm = normalizeEstadoCompra(estado);

  const where = {
    empresa_id,
    ...(estadoNorm ? { estado: estadoNorm } : {}),
    ...(proveedorId ? { proveedorId: String(proveedorId) } : {}),
    ...(proyectoId ? { proyecto_id: String(proyectoId) } : {}),
    ...(cotizacionId ? { cotizacionId: String(cotizacionId) } : {}),
    ...(toBool(request.query?.sinRendicion) ? { rendicion_id: null } : {}),
    ...(toBool(includeDeleted) ? {} : { eliminado: false }),
  };

  if (estado && estado.toUpperCase() === "PENDIENTE") {
    where.cotizacionId = null;
  } else if (estado && estado.toUpperCase() === "VINCULADO") {
    where.cotizacionId = { not: null };
  }

  // ✅ Filtro por Periodo (fecha_docto)
  if (startDate && endDate) {
    where.fecha_docto = {
      gte: new Date(startDate),
      lte: new Date(endDate),
    };
  } else if (periodo && /^\d{4}-\d{2}$/.test(periodo)) {
    const [year, month] = periodo.split("-").map(Number);
    const startDateVal = new Date(year, month - 1, 1);
    const endDateVal = new Date(year, month, 0, 23, 59, 59, 999);
    where.fecha_docto = {
      gte: startDateVal,
      lte: endDateVal,
    };
  }

  // ✅ Filtro por Búsqueda (q)
  if (q) {
    where.OR = [
      ...(Number.isFinite(Number(q)) ? [{ numero: Number(q) }] : []),
      { proveedor: { nombre: { contains: String(q), mode: "insensitive" } } },
      { proyecto: { nombre: { contains: String(q), mode: "insensitive" } } },
      { cotizacion: { asunto: { contains: String(q), mode: "insensitive" } } },
      { folio: { contains: String(q), mode: "insensitive" } },
      { razon_social: { contains: String(q), mode: "insensitive" } },
      { rut_proveedor: { contains: String(q), mode: "insensitive" } },
    ];
  }

  const [total, dataRaw] = await Promise.all([
    prisma.compra.count({ where }),
    prisma.compra.findMany({
      where,
      orderBy: [{ creada_en: "desc" }],
      skip: (pageN - 1) * sizeN,
      take: sizeN,
      include: {
        proveedor: { select: { id: true, nombre: true, rut: true } },
        proyecto: { select: { id: true, nombre: true } },
        cotizacion: { select: { id: true, numero: true, estado: true, asunto: true, es_suscripcion: true, cliente: { select: { id: true, nombre: true } } } },
        empresa: true,

        // ✅ NUEVO: para mostrar en tabla / modal
        rendicion: {
          select: {
            id: true,
            estado: true,
            monto_total: true,
            descripcion: true,
            destino: true,
            centro_costo: true,
            creado_en: true,
            empleado: { select: { id: true, rut: true, cargo: true } },
          },
        },

        items: {
          include: {
            producto: { select: { id: true, nombre: true, sku: true } },
            proveedor: { select: { id: true, nombre: true } },
          },
        },
      },
    }),
  ]);

  const data = await attachVinculadoPct(empresa_id, dataRaw);

  return reply.send({ total, page: pageN, pageSize: sizeN, data });
}

/* =========================
   LIST DISPONIBLES PARA VENTA
========================= */
export async function listComprasDisponiblesVenta(request, reply) {
  const scope = resolveScope(request);

  const compras = await prisma.compra.findMany({
    where: {
      empresa_id: scope.empresaId,
      eliminado: false,
      estado: { in: ["PAGADA", "FACTURADA"] },
      items: { some: {} },
      NOT: {
        items: {
          some: {
            detalleVentas: { some: {} },
          },
        },
      },
    },
    include: {
      items: true,
      proveedor: { select: { id: true, nombre: true } },
      proyecto: { select: { id: true, nombre: true } },
    },
    orderBy: { creada_en: "desc" },
  });

  return reply.send(compras);
}

/* =========================
   GET
========================= */
export async function getCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const where = scope.isMaster ? { id } : { id, empresa_id: scope.empresaId };

  const row = await prisma.compra.findFirst({
    where,
    include: {
      proveedor: true,
      proyecto: true,
      cotizacion: true,
      empresa: true,

      // ✅ NUEVO
      rendicion: {
        include: {
          items: true,
          empleado: { select: { id: true, rut: true, cargo: true } },
          proyecto: { select: { id: true, nombre: true } },
        },
      },

      items: { include: { producto: true, proveedor: true } },
      asignaciones_costeo: {
        include: {
          venta: { select: { id: true, numero: true, descripcion: true, fecha: true } },
        },
      },
    },
  });

  if (!row) return httpError(reply, 404, "Compra no encontrada");
  return reply.send(row);
}

/* =========================
   CREATE
========================= */
export async function createCompra(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};

  try {
    const empresa_id = scope.isMaster ? body.empresa_id || scope.empresaId : scope.empresaId;

    const estadoNorm = normalizeEstadoCompra(body.estado) || "ORDEN_COMPRA";

    // ✅ NUEVO
    let destino = String(body.destino || "PROYECTO").toUpperCase(); // PROYECTO | SERVICIO | ADMINISTRACION | TALLER
    let centro_costo = body.centro_costo ? String(body.centro_costo).toUpperCase() : null; // PMC | PUQ
    let proyecto_id = body.proyecto_id ?? null;
    let cotizacionId = body.cotizacionId ?? body.servicio_id ?? null;

    if (cotizacionId && destino !== "SERVICIO") {
      const cotizacion = await prisma.cotizacion.findUnique({
        where: { id: cotizacionId },
        select: { id: true, proyecto_id: true, empresa_id: true, es_suscripcion: true }
      });
      if (cotizacion && cotizacion.empresa_id === empresa_id) {
        if (cotizacion.es_suscripcion) {
          destino = "SERVICIO";
          centro_costo = null;
        } else if (cotizacion.proyecto_id) {
          destino = "PROYECTO";
          proyecto_id = cotizacion.proyecto_id;
          centro_costo = null;
        }
      }
    }

    const rendicion_id = body.rendicion_id ?? null;

    // normalizar items/total
    const items = Array.isArray(body.items) ? body.items : [];
    const total = body.total != null ? Number(body.total) : calcTotal(items);

    // ✅ VALIDACIONES (imputación)
    const isProyecto = destino === "PROYECTO";
    const isServicio = destino === "SERVICIO";
    const isAdminOTaller = destino === "ADMINISTRACION" || destino === "TALLER";

    if (!isProyecto && !isServicio && !isAdminOTaller) {
      return reply.code(400).send({ error: "destino inválido (PROYECTO | SERVICIO | ADMINISTRACION | TALLER)" });
    }

    if (isProyecto) {
      if (!proyecto_id) {
        return reply.code(400).send({ error: "proyecto_id es obligatorio cuando destino = PROYECTO" });
      }
      if (centro_costo) {
        return reply.code(400).send({ error: "centro_costo debe ser null cuando destino = PROYECTO" });
      }
    }

    if (isServicio) {
      if (!cotizacionId) {
        return reply.code(400).send({ error: "Debe seleccionar un servicio (cotizacionId) cuando destino = SERVICIO" });
      }
      if (centro_costo) {
        return reply.code(400).send({ error: "centro_costo debe ser null cuando destino = SERVICIO" });
      }
    }

    if (isAdminOTaller) {
      if (!centro_costo || (centro_costo !== "PMC" && centro_costo !== "PUQ")) {
        return reply.code(400).send({ error: "centro_costo inválido u obligatorio (PMC | PUQ) para ADMINISTRACION/TALLER" });
      }
      if (proyecto_id) {
        return reply.code(400).send({ error: "proyecto_id debe ser null cuando destino es ADMINISTRACION/TALLER" });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      // ✅ Antes validabas siempre proyecto; ahora depende del destino
      if (isProyecto && proyecto_id) await assertEntidadEmpresa(tx, "proyecto", proyecto_id, empresa_id);
      if (isServicio && proyecto_id) await assertEntidadEmpresa(tx, "proyecto", proyecto_id, empresa_id);

      await assertEntidadEmpresa(tx, "proveedor", body.proveedorId, empresa_id);
      if (cotizacionId) await assertEntidadEmpresa(tx, "cotizacion", cotizacionId, empresa_id);

      // Validar productos/proveedores de items
      for (const it of items) {
        if (it.producto_id) await assertEntidadEmpresa(tx, "producto", it.producto_id, empresa_id);
        if (it.proveedor_id) await assertEntidadEmpresa(tx, "proveedor", it.proveedor_id, empresa_id);
      }

      if (rendicion_id) {
        const r = await tx.rendicion.findFirst({
          where: { id: rendicion_id, eliminado: false, proyecto: { empresa_id, eliminado: false } },
          select: { id: true, proyecto_id: true, destino: true, centro_costo: true },
        });
        if (!r) {
          const err = new Error("Rendición no existe o no pertenece a la empresa");
          err.statusCode = 404;
          throw err;
        }

        // destino debe coincidir
        if (String(r.destino) !== destino) {
          const err = new Error("La rendición tiene un destino distinto a la compra");
          err.statusCode = 400;
          throw err;
        }
        // centro debe coincidir
        if ((r.centro_costo || null) !== (centro_costo || null)) {
          const err = new Error("La rendición tiene un centro_costo distinto a la compra");
          err.statusCode = 400;
          throw err;
        }
        // si es proyecto, proyecto_id debe coincidir
        if (destino === "PROYECTO" && r.proyecto_id !== proyecto_id) {
          const err = new Error("La compra debe usar el mismo proyecto_id de la rendición");
          err.statusCode = 400;
          throw err;
        }
      }

      return tx.compra.create({
        data: {
          empresa_id,

          // ✅ NUEVO
          destino,
          centro_costo: centro_costo ?? null,
          rendicion_id: rendicion_id ?? null,

          proyecto_id: isProyecto ? proyecto_id : (isServicio ? proyecto_id || null : null),

          proveedorId: body.proveedorId ?? null,
          cotizacionId: cotizacionId ?? null,

          estado: estadoNorm,
          total: Number(total || 0),

          tipo_doc: body.tipo_doc ?? null,
          folio: body.folio ?? null,
          rut_proveedor: body.rut_proveedor ?? null,
          razon_social: body.razon_social ?? null,
          fecha_docto: body.fecha_docto ? new Date(`${String(body.fecha_docto).slice(0, 10)}T12:00:00`) : null,
          fecha_recepcion: body.fecha_recepcion ? new Date(`${String(body.fecha_recepcion).slice(0, 10)}T12:00:00`) : null,

          factura_url: body.factura_url ?? null,
          factura_numero: body.factura_numero ?? null,
          factura_fecha: body.factura_fecha ? new Date(`${String(body.factura_fecha).slice(0, 10)}T12:00:00`) : null,
          factura_monto: body.factura_monto != null ? Number(body.factura_monto) : null,

          items: {
            create: items.map((it) => {
              const cantidad = Number(it.cantidad || 0);
              const precio_unit = Number(it.precio_unit ?? it.precio_unitario ?? 0);
              return {
                producto_id: it.producto_id ?? null,
                proveedor_id: it.proveedor_id ?? null,
                item: it.item ?? null,
                cantidad,
                precio_unit,
                total: cantidad * precio_unit,
                tipoItemId: it.tipoItemId ?? null,
              };
            }),
          },
        },
        include: {
          proveedor: { select: { id: true, nombre: true } },
          proyecto: { select: { id: true, nombre: true } },
          cotizacion: { select: { id: true, numero: true } },
          rendicion: { select: { id: true, destino: true, centro_costo: true, proyecto_id: true } },
          items: { include: { producto: true, proveedor: true, tipoItem: true } },
        },
      }); // cierra tx.compra.create
    }); // cierra transaction

    return reply.code(201).send(created);
  } catch (e) {
    if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
    return reply.code(500).send({ error: e.message || "Error interno" });
  }
}

/* =========================
   PATCH /compras/:id/asignar-rendicion
   Body: { rendicion_id: string | null }
========================= */
export async function asignarRendicionACompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params || {};
  const body = request.body || {};
  const rendicion_id = body.rendicion_id ? String(body.rendicion_id) : null;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // 1) validar compra (empresa)
      const compra = await tx.compra.findFirst({
        where: scope.isMaster ? { id } : { id, empresa_id: scope.empresaId },
        include: {
          proyecto: { select: { id: true, empresa_id: true } },
        },
      });
      if (!compra) {
        const err = new Error("Compra no encontrada");
        err.statusCode = 404;
        throw err;
      }

      // 2) si viene rendicion_id, validar que exista y sea compatible
      if (rendicion_id) {
        const rend = await tx.rendicion.findFirst({
          where: {
            id: rendicion_id,
            eliminado: false,
            empresa_id: compra.empresa_id, // misma empresa
          },
          select: {
            id: true,
            destino: true,
            centro_costo: true,
            proyecto_id: true,
            estado: true,
          },
        });
        if (!rend) {
          const err = new Error("Rendición no encontrada");
          err.statusCode = 404;
          throw err;
        }

        // ✅ Auto-alineación: Al vincular, la compra hereda el contexto de la rendición
        // para asegurar consistencia (destino, proyecto, centro de costo).
        await tx.compra.update({
          where: { id: compra.id },
          data: {
            destino: rend.destino,
            centro_costo: rend.centro_costo,
            ...(rend.proyecto_id
              ? { proyecto: { connect: { id: rend.proyecto_id } } }
              : compra.proyecto_id
                ? { proyecto: { disconnect: true } }
                : {}),
          },
        });
      }

      // 3) update compra
      const row = await tx.compra.update({
        where: { id: compra.id },
        data: {
          rendicion: rendicion_id ? { connect: { id: rendicion_id } } : { disconnect: true },
        },
        include: {
          rendicion: { select: { id: true, estado: true, monto_total: true, descripcion: true } },
        },
      });

      return row;
    });

    return reply.send({ ok: true, row: updated });
  } catch (e) {
    if (e.statusCode) {
      return reply.code(e.statusCode).send({ error: e.message });
    }
    return reply.code(500).send({ error: e.message || "Error interno del servidor" });
  }
}

/* =========================
   UPDATE (PUT /compras/:id)
   - Respeta destino/centro/proyecto igual que CREATE
   - Revalida rendicion_id si:
      a) se envía rendicion_id, o
      b) cambia destino/centro/proyecto y la compra ya tenía rendicion_id
========================= */
export async function updateCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const body = request.body || {};

  try {
    const exists = await prisma.compra.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!exists) return httpError(reply, 404, "Compra no encontrada");
    if (!scope.isMaster && exists.empresa_id !== scope.empresaId)
      return httpError(reply, 403, "Compra fuera de tu empresa");

    const empresa_id = exists.empresa_id;

    // ===== Normalizaciones / “next state”
    const estadoNorm = normalizeEstadoCompra(body.estado);

    let nextDestino =
      body.destino !== undefined
        ? String(body.destino || "PROYECTO").toUpperCase()
        : String(exists.destino || "PROYECTO").toUpperCase();

    let nextCentroCosto =
      body.centro_costo !== undefined
        ? body.centro_costo
          ? String(body.centro_costo).toUpperCase()
          : null
        : exists.centro_costo
          ? String(exists.centro_costo).toUpperCase()
          : null;

    let nextProyectoId =
      body.proyecto_id !== undefined ? body.proyecto_id || null : exists.proyecto_id || null;

    let nextCotizacionId =
      body.cotizacionId !== undefined
        ? body.cotizacionId || null
        : exists.cotizacionId || null;

    if (body.cotizacionId !== undefined && body.cotizacionId && nextDestino !== "SERVICIO") {
      const cotizacion = await prisma.cotizacion.findUnique({
        where: { id: body.cotizacionId },
        select: { id: true, proyecto_id: true, empresa_id: true, es_suscripcion: true }
      });
      if (cotizacion && cotizacion.empresa_id === empresa_id) {
        if (cotizacion.es_suscripcion) {
          nextDestino = "SERVICIO";
          nextCentroCosto = null;
        } else if (cotizacion.proyecto_id) {
          nextDestino = "PROYECTO";
          nextProyectoId = cotizacion.proyecto_id;
          nextCentroCosto = null;
        }
      }
    }

    // OJO: updateCompra (PUT) normalmente puede venir con rendicion_id o no.
    // Si no viene, NO lo tocamos.
    const wantsChangeRendicion = body.rendicion_id !== undefined;
    const nextRendicionId = wantsChangeRendicion
      ? body.rendicion_id
        ? String(body.rendicion_id)
        : null
      : exists.rendicion_id
        ? String(exists.rendicion_id)
        : null;

    // items
    const hasItems = Array.isArray(body.items);
    const nextItems = hasItems ? body.items : null;

    // ===== Validaciones imputación (idénticas a CREATE)
    const isProyecto = nextDestino === "PROYECTO";
    const isServicio = nextDestino === "SERVICIO";
    const isAdminOTaller = nextDestino === "ADMINISTRACION" || nextDestino === "TALLER";

    if (!isProyecto && !isServicio && !isAdminOTaller) {
      return reply
        .code(400)
        .send({ error: "destino inválido (PROYECTO | SERVICIO | ADMINISTRACION | TALLER)" });
    }

    if (isProyecto) {
      if (!nextProyectoId) {
        return reply
          .code(400)
          .send({ error: "proyecto_id es obligatorio cuando destino = PROYECTO" });
      }
      if (nextCentroCosto) {
        return reply
          .code(400)
          .send({ error: "centro_costo debe ser null cuando destino = PROYECTO" });
      }
    }

    if (isServicio) {
      if (!nextCotizacionId) {
        return reply
          .code(400)
          .send({ error: "Debe seleccionar un servicio (cotizacionId) cuando destino = SERVICIO" });
      }
      if (nextCentroCosto) {
        return reply
          .code(400)
          .send({ error: "centro_costo debe ser null cuando destino = SERVICIO" });
      }
    }

    if (isAdminOTaller) {
      if (!nextCentroCosto || (nextCentroCosto !== "PMC" && nextCentroCosto !== "PUQ")) {
        return reply.code(400).send({
          error:
            "centro_costo inválido u obligatorio (PMC | PUQ) para ADMINISTRACION/TALLER",
        });
      }
      if (nextProyectoId) {
        return reply
          .code(400)
          .send({ error: "proyecto_id debe ser null cuando destino es ADMINISTRACION/TALLER" });
      }
    }

    // ===== Transaction
    const updated = await prisma.$transaction(async (tx) => {
      // Validar entidades si cambiaron (y si aplican)
      if ((isProyecto || isServicio) && nextProyectoId && nextProyectoId !== exists.proyecto_id) {
        await assertEntidadEmpresa(tx, "proyecto", nextProyectoId, empresa_id);
      }

      if (body.proveedorId !== undefined && body.proveedorId && body.proveedorId !== exists.proveedorId) {
        await assertEntidadEmpresa(tx, "proveedor", body.proveedorId, empresa_id);
      }

      if (body.cotizacionId !== undefined && body.cotizacionId && body.cotizacionId !== exists.cotizacionId) {
        await assertEntidadEmpresa(tx, "cotizacion", body.cotizacionId, empresa_id);
      }

      // Validar productos/proveedores de items (si vienen)
      if (hasItems) {
        for (const it of nextItems) {
          if (it.producto_id) await assertEntidadEmpresa(tx, "producto", it.producto_id, empresa_id);
          if (it.proveedor_id) await assertEntidadEmpresa(tx, "proveedor", it.proveedor_id, empresa_id);
        }
      }

      // ===== Validación rendición: si se cambia rendicion_id o si hay rendición y cambió imputación
      const imputacionChanged =
        (body.destino !== undefined && String(exists.destino || "").toUpperCase() !== nextDestino) ||
        (body.centro_costo !== undefined &&
          (exists.centro_costo ? String(exists.centro_costo).toUpperCase() : null) !== nextCentroCosto) ||
        (body.proyecto_id !== undefined && (exists.proyecto_id || null) !== nextProyectoId);

      const mustRevalidateRendicion =
        // si viene rendicion_id en el body (cambio explícito)
        wantsChangeRendicion ||
        // o si cambió imputación y la compra ya tenía rendición
        (imputacionChanged && !!exists.rendicion_id);

      if (mustRevalidateRendicion && nextRendicionId) {
        const r = await tx.rendicion.findFirst({
          where: {
            id: nextRendicionId,
            eliminado: false,
            proyecto: {
              empresa_id,
              eliminado: false,
              empresa: { eliminado: false },
            },
          },
          select: { id: true, proyecto_id: true, destino: true, centro_costo: true },
        });
        if (!r) {
          const err = new Error("Rendición no existe o no pertenece a la empresa");
          err.statusCode = 404;
          throw err;
        }

        if (String(r.destino || "PROYECTO").toUpperCase() !== nextDestino) {
          const err = new Error("La rendición tiene un destino distinto a la compra");
          err.statusCode = 400;
          throw err;
        }

        const rCentro = r.centro_costo ? String(r.centro_costo).toUpperCase() : null;
        if ((rCentro || null) !== (nextCentroCosto || null)) {
          const err = new Error("La rendición tiene un centro_costo distinto a la compra");
          err.statusCode = 400;
          throw err;
        }

        if (nextDestino === "PROYECTO" && String(r.proyecto_id) !== String(nextProyectoId)) {
          const err = new Error("La compra debe usar el mismo proyecto_id de la rendición");
          err.statusCode = 400;
          throw err;
        }
      }

      // ===== Construir data update
      const data = {};

      // imputación (NUEVO)
      data.destino = nextDestino;
      data.centro_costo = (isProyecto || isServicio) ? null : nextCentroCosto;
      if (isProyecto) {
        if (nextProyectoId) {
          data.proyecto = { connect: { id: nextProyectoId } };
        } else if (exists.proyecto_id) {
          data.proyecto = { disconnect: true };
        }
      } else if (isServicio) {
        if (nextProyectoId) {
          data.proyecto = { connect: { id: nextProyectoId } };
        } else if (exists.proyecto_id) {
          data.proyecto = { disconnect: true };
        }
      } else if (exists.proyecto_id) {
        data.proyecto = { disconnect: true };
      }

      if (body.sub_destino !== undefined) data.sub_destino = body.sub_destino || null;
      if (body.proyecto_interno !== undefined) data.proyecto_interno = body.proyecto_interno || null;
      if (body.comentario_destino !== undefined) data.comentario_destino = body.comentario_destino || null;

      // rendición
      if (wantsChangeRendicion) {
        if (nextRendicionId) {
          data.rendicion = { connect: { id: nextRendicionId } };
        } else if (exists.rendicion_id) {
          data.rendicion = { disconnect: true };
        }
      }

      // proveedor
      if (body.proveedorId !== undefined) {
        if (body.proveedorId) {
          data.proveedor = { connect: { id: body.proveedorId } };
        } else if (exists.proveedorId) {
          data.proveedor = { disconnect: true };
        }
      }

      // cotización
      const targetCotId =
        body.cotizacionId !== undefined
          ? body.cotizacionId || null
          : isServicio && nextCotizacionId
            ? nextCotizacionId
            : undefined;

      if (targetCotId !== undefined) {
        if (targetCotId) {
          data.cotizacion = { connect: { id: targetCotId } };
        } else if (exists.cotizacionId) {
          data.cotizacion = { disconnect: true };
        }
      }

      if (estadoNorm) data.estado = estadoNorm;
      if (body.eliminado !== undefined) data.eliminado = Boolean(body.eliminado);

      if (body.tipo_doc !== undefined) data.tipo_doc = body.tipo_doc ?? null;
      if (body.folio !== undefined) data.folio = body.folio ?? null;
      if (body.rut_proveedor !== undefined) data.rut_proveedor = body.rut_proveedor ?? null;
      if (body.razon_social !== undefined) data.razon_social = body.razon_social ?? null;
      if (body.fecha_docto !== undefined)
        data.fecha_docto = body.fecha_docto ? new Date(`${String(body.fecha_docto).slice(0, 10)}T12:00:00`) : null;
      if (body.fecha_recepcion !== undefined)
        data.fecha_recepcion = body.fecha_recepcion ? new Date(`${String(body.fecha_recepcion).slice(0, 10)}T12:00:00`) : null;

      if (body.factura_url !== undefined) data.factura_url = body.factura_url ?? null;
      if (body.factura_numero !== undefined) data.factura_numero = body.factura_numero ?? null;
      if (body.factura_fecha !== undefined)
        data.factura_fecha = body.factura_fecha ? new Date(`${String(body.factura_fecha).slice(0, 10)}T12:00:00`) : null;
      if (body.factura_monto !== undefined)
        data.factura_monto = body.factura_monto != null ? Number(body.factura_monto) : null;

      // total + items
      if (hasItems) {
        const newTotal = body.total != null ? Number(body.total) : calcTotal(nextItems);
        data.total = Number(newTotal || 0);

        await tx.compraItem.deleteMany({ where: { compra_id: id } });

        if (nextItems.length) {
          await tx.compraItem.createMany({
            data: nextItems.map((it) => {
              const cantidad = Number(it.cantidad || 0);
              const precio_unit = Number(it.precio_unit ?? it.precio_unitario ?? 0);
              return {
                compra_id: id,
                producto_id: it.producto_id ?? null,
                proveedor_id: it.proveedor_id ?? null,
                item: it.item ?? null,
                cantidad,
                precio_unit,
                total: cantidad * precio_unit,
                tipoItemId: it.tipoItemId ?? null,
              };
            }),
          });
        }
      } else if (body.total != null) {
        data.total = Number(body.total || 0);
      }

      // Ejecutar update
      await tx.compra.update({ where: { id }, data });

      // devolver compra con includes (agrega rendicion)
      const row = await tx.compra.findUnique({
        where: { id },
        include: {
          proveedor: true,
          proyecto: true,
          cotizacion: true,
          rendicion: { select: { id: true, estado: true, monto_total: true, descripcion: true } },
          items: { include: { producto: true, proveedor: true, tipoItem: true } },
        },
      });

      return row;
    });

    const [withPct] = await attachVinculadoPct(empresa_id, [updated]);
    return reply.send(withPct);
  } catch (e) {
    if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
    return reply.code(500).send({ error: e.message || "Error interno" });
  }
}

/* =========================
   DELETE (físico)
========================= */
export async function deleteCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { force } = request.query || {};

  const where = scope.isMaster ? { id } : { id, empresa_id: scope.empresaId };

  const row = await prisma.compra.findFirst({
    where,
    select: { id: true, estado: true },
  });
  if (!row) return httpError(reply, 404, "Compra no encontrada");

  if (!toBool(force) && row.estado !== "ORDEN_COMPRA") {
    return httpError(
      reply,
      409,
      "Compra no está en ORDEN_COMPRA. Usa ?force=true para borrado definitivo."
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.compraCosteo.deleteMany({ where: { compra_id: id } });
    await tx.compraItem.deleteMany({ where: { compra_id: id } });
    await tx.compra.delete({ where: { id } });
  });

  return reply.send({ success: true });
}

/* =========================
   SOFT DELETE
========================= */
export async function disableCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const where = scope.isMaster ? { id } : { id, empresa_id: scope.empresaId };

  const row = await prisma.compra.findFirst({ where });
  if (!row) return httpError(reply, 404, "Compra no encontrada");
  if (row.eliminado) return httpError(reply, 409, "Compra ya está eliminada");

  const upd = await prisma.compra.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });

  return reply.send({ success: true, compra: upd });
}

/* =========================
   RESTORE
========================= */
export async function restoreCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const where = scope.isMaster ? { id } : { id, empresa_id: scope.empresaId };

  const row = await prisma.compra.findFirst({ where });
  if (!row) return httpError(reply, 404, "Compra no encontrada");
  if (!row.eliminado) return httpError(reply, 409, "Compra no está eliminada");

  const upd = await prisma.compra.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });

  return reply.send({ success: true, compra: upd });
}

/* =========================
   ✅ POST /compras/:id/factura
   multipart: file=<pdf>
========================= */
export async function uploadFacturaCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const compra = await prisma.compra.findUnique({ where: { id } });
  if (!compra) return httpError(reply, 404, "Compra no encontrada");
  if (!scope.isMaster && compra.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Compra fuera de tu empresa");

  const file = await request.file();
  if (!file) return httpError(reply, 400, "Debes enviar file (PDF) en form-data");

  const mimetype = String(file.mimetype || "").toLowerCase();
  if (mimetype !== "application/pdf") {
    return httpError(reply, 400, "El archivo debe ser un PDF (application/pdf)");
  }

  const empresa_id = compra.empresa_id;

  // guardar en uploads/facturas/<empresa_id>/
  const dir = facturasDir(empresa_id);
  await ensureDir(dir);

  const original = safeFileName(file.filename || "factura.pdf");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rnd = crypto.randomBytes(6).toString("hex");

  // siempre .pdf (no confiamos en original)
  const filename = `compra_${id}_${stamp}_${rnd}.pdf`;
  const fullpath = path.join(dir, filename);

  const buf = await file.toBuffer();
  const MAX = 15 * 1024 * 1024;
  if (buf.length > MAX) return httpError(reply, 400, "PDF supera 15MB");

  await fsp.writeFile(fullpath, buf);

  // ✅ guardar URL pública en DB (SIN /api)
  const factura_url = `${facturasPublicPrefix(empresa_id)}/${filename}`;

  const updated = await prisma.compra.update({
    where: { id },
    data: {
      factura_url,
      factura_fecha: new Date(),
      factura_numero: compra.folio ?? null,
      factura_monto: compra.total ?? null,
    },
    select: { id: true, factura_url: true },
  });

  return reply.send({ ok: true, ...updated });
}

/* =========================
   ✅ GET /compras/:id/costeos
========================= */
export async function getCompraCosteos(req, reply) {
  const scope = resolveScope(req);
  const compraId = String(req.params.id);

  const compra = await prisma.compra.findUnique({ where: { id: compraId } });
  if (!compra) return httpError(reply, 404, "Compra no encontrada");
  if (!scope.isMaster && compra.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Compra fuera de tu empresa");

  const empresa_id = compra.empresa_id;

  const rows = await prisma.compraCosteo.findMany({
    where: { empresa_id, compra_id: compraId },
    include: {
      venta: { select: { id: true, numero: true, descripcion: true, fecha: true } },
    },
    orderBy: { creado_en: "asc" },
  });

  return reply.send({ data: rows });
}

/* =========================
   ✅ PUT /compras/:id/costeos
   Acepta body en cualquiera de estas formas:
   - { items: [{ venta_id, monto }, ...] }
   - { data:  [{ venta_id, monto }, ...] }
   - [{ venta_id, monto }, ...]   (array directo)
   Y acepta ventaId / venta_id
========================= */
export async function setCompraCosteos(req, reply) {
  const scope = resolveScope(req);
  const compraId = String(req.params.id);

  const body = req.body ?? {};

  // 1) normalizar items desde múltiples formatos
  let items = [];
  if (Array.isArray(body)) items = body;
  else if (Array.isArray(body.items)) items = body.items;
  else if (Array.isArray(body.data)) items = body.data;
  else items = [];

  // helper para monto "80.000" o "80,000" o 80000
  const parseMonto = (v) => {
    if (typeof v === "number") return v;
    const s = String(v ?? "").trim();
    if (!s) return NaN;
    // quita separador miles y deja decimal estándar
    const cleaned = s.replace(/\./g, "").replace(/,/g, ".");
    return Number(cleaned);
  };

  // 2) validar compra y empresa
  const compra = await prisma.compra.findUnique({ where: { id: compraId } });
  if (!compra) return httpError(reply, 404, "Compra no encontrada");
  if (!scope.isMaster && compra.empresa_id !== scope.empresaId)
    return httpError(reply, 403, "Compra fuera de tu empresa");

  const empresa_id = compra.empresa_id;

  // 3) validar items (pero permite array vacío = desvincular todo)
  for (const it of items) {
    const venta_id = it?.venta_id ?? it?.ventaId ?? it?.venta?.id;
    const monto = parseMonto(it?.monto);

    if (!venta_id) return reply.badRequest("Falta venta_id (o ventaId) en items");
    if (!Number.isFinite(monto) || monto < 0) return reply.badRequest("Monto inválido");

    // opcional pero recomendado: validar que la venta exista
    // (si tu Venta tiene empresa_id, filtra por empresa_id también)
    const ventaOk = await prisma.venta.findFirst({
      where: { id: String(venta_id), empresa_id },
      select: { id: true },
    });
    if (!ventaOk) return reply.badRequest(`Venta no existe: ${venta_id}`);
  }

  // 4) guardar (borra y vuelve a crear)
  const inserted = await prisma.$transaction(async (tx) => {
    await tx.compraCosteo.deleteMany({
      where: { empresa_id, compra_id: compraId },
    });

    if (!items.length) return 0;

    // 4.1) Identificar proyecto_id de las ventas vinculadas
    // Tomamos la primera venta que tenga proyecto (vía Cotización)
    const ventasConProyecto = await tx.venta.findMany({
      where: { id: { in: items.map(it => String(it?.venta_id ?? it?.ventaId ?? it?.venta?.id)) } },
      include: { ordenVenta: { select: { proyecto_id: true } } }
    });

    const linkedProyectoId = ventasConProyecto.find(v => v.ordenVenta?.proyecto_id)?.ordenVenta?.proyecto_id;

    if (linkedProyectoId && (!compra.proyecto_id || compra.proyecto_id !== linkedProyectoId)) {
      await tx.compra.update({
        where: { id: compraId },
        data: {
          proyecto: { connect: { id: linkedProyectoId } },
          destino: "PROYECTO",
          centro_costo: null,
        }
      });
    }

    const res = await tx.compraCosteo.createMany({
      data: items.map((it) => ({
        empresa_id,
        compra_id: compraId,
        venta_id: String(it?.venta_id ?? it?.ventaId ?? it?.venta?.id),
        monto: Number(parseMonto(it.monto)),
      })),
    });

    return res.count;
  });

  // 5) devolver también el % para que tu UI actualice altiro
  const sum = await prisma.compraCosteo.aggregate({
    where: { empresa_id, compra_id: compraId },
    _sum: { monto: true },
  });

  const vinculadoMonto = Number(sum._sum.monto || 0);
  const vinculadoPct =
    compra.total > 0 ? Math.min(1, vinculadoMonto / Number(compra.total)) : 0;

  return reply.send({ ok: true, inserted, vinculadoMonto, vinculadoPct });
}

export async function listItemsCosteoDisponibles(request, reply) {
  const scope = resolveScope(request);
  const { cotizacionIds, currentCompraId } = request.query || {};

  try {
    const empresa_id = scope.empresaId;
    if (!cotizacionIds) {
      return reply.send([]);
    }

    const ids = String(cotizacionIds).split(",").filter(Boolean);
    if (ids.length === 0) {
      return reply.send([]);
    }

    let currentCompraItemIds = [];
    if (currentCompraId) {
      const items = await prisma.compraItem.findMany({
        where: { compra_id: currentCompraId },
        select: { id: true },
      });
      currentCompraItemIds = items.map((it) => it.id);
    }

    const items = await prisma.detalleVenta.findMany({
      where: {
        modo: "COMPRA",
        eliminado: false,
        venta: {
          ordenVentaId: { in: ids },
          eliminado: false,
          empresa_id: empresa_id,
        },
        OR: [
          { compraId: null },
          ...(currentCompraItemIds.length > 0 ? [{ compraId: { in: currentCompraItemIds } }] : []),
        ],
      },
      include: {
        venta: {
          select: {
            id: true,
            numero: true,
          },
        },
      },
    });

    return reply.send(items);
  } catch (error) {
    console.error("Error al listar items de costeo:", error);
    return reply.code(500).send({ error: error.message });
  }
}

export async function analizarCotizacionProveedor(request, reply) {
  const scope = resolveScope(request);
  
  if (!request.isMultipart()) {
    return reply.code(400).send({ error: "Debe enviar multipart/form-data" });
  }

  try {
    const file = await request.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!file) {
      return reply.code(400).send({ error: "No se encontró el archivo con nombre de campo 'file'" });
    }

    const fileBuffer = await file.toBuffer();
    if (file.file.truncated) {
      return reply.code(400).send({ error: "El archivo es demasiado grande (máximo 20MB)" });
    }

    const filename = file.filename;
    const mimetype = file.mimetype;

    // 1. Extraer texto del documento
    const text = await extraerTextoDeDocumento(fileBuffer, filename, mimetype);

    // 2. Analizar con Ollama
    const ollamaResult = await analizarCotizacionConOllama(text);

    // 3. Guardar el archivo en uploads para posterior confirmación
    const uniqueFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${filename.replace(/\s+/g, "_")}`;
    const uploadPath = path.join(process.cwd(), "uploads", uniqueFilename);
    await fsp.writeFile(uploadPath, fileBuffer);
    const fileUrl = `/api/uploads/${uniqueFilename}`;

    return reply.send({
      ...ollamaResult,
      archivoUrl: fileUrl,
      archivoNombre: filename,
    });
  } catch (error) {
    console.error("Error al analizar cotización:", error);
    return reply.code(500).send({
      error: "Error procesando cotización",
      detalle: error.message || "Error interno del servidor",
    });
  }
}

export async function createOrdenCompraProveedor(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};

  try {
    const empresa_id = scope.isMaster ? body.empresa_id || scope.empresaId : scope.empresaId;
    const {
      proveedorId,
      destino,
      centro_costo,
      proyecto_id,
      cotizacionId,
      tipo_doc,
      folio,
      fecha_docto,
      fecha_entrega_esperada,
      moneda,
      subtotal,
      descuento,
      impuestos,
      total,
      estado_oc,
      observaciones,
      terminos_condiciones,
      archivo_original,
      json_original_ollama,
      condicion_pago,
      condicion_entrega,
      items,
    } = body;

    if (!proveedorId) {
      return reply.code(400).send({ error: "El proveedorId es obligatorio" });
    }
    if (!destino) {
      return reply.code(400).send({ error: "El destino es obligatorio" });
    }

    const created = await prisma.$transaction(async (tx) => {
      if (proyecto_id) await assertEntidadEmpresa(tx, "proyecto", proyecto_id, empresa_id);
      await assertEntidadEmpresa(tx, "proveedor", proveedorId, empresa_id);
      if (cotizacionId) await assertEntidadEmpresa(tx, "cotizacion", cotizacionId, empresa_id);

      const compra = await tx.compra.create({
        data: {
          empresa_id,
          destino: destino || "PROYECTO",
          centro_costo: (destino === "PROYECTO" || destino === "SERVICIO") ? null : centro_costo,
          proyecto_id: destino === "PROYECTO" ? proyecto_id : (destino === "SERVICIO" ? proyecto_id || null : null),
          proveedorId: proveedorId || null,
          cotizacionId: cotizacionId || null,
          estado: "ORDEN_COMPRA", // default mapping
          estado_oc: estado_oc || "CONFIRMADA",
          total: Number(total || 0),
          subtotal: Number(subtotal || 0),
          descuento: Number(descuento || 0),
          impuestos: Number(impuestos || 0),
          tipo_doc: tipo_doc ? Number(tipo_doc) : 99,
          folio: folio ? String(folio) : null,
          fecha_docto: fecha_docto ? new Date(fecha_docto) : new Date(),
          fecha_entrega_esperada: fecha_entrega_esperada ? new Date(fecha_entrega_esperada) : null,
          moneda: moneda || "CLP",
          observaciones: observaciones || null,
          terminos_condiciones: terminos_condiciones || null,
          archivo_original: archivo_original || null,
          json_original_ollama: json_original_ollama || null,
          condicion_pago: condicion_pago || null,
          condicion_entrega: condicion_entrega || null,
        },
      });

      if (Array.isArray(items)) {
        for (const it of items) {
          const itemTotal = Number(it.totalLinea ?? (Number(it.cantidad || 0) * Number(it.precio_unit ?? it.precioUnitario ?? 0)));
          const compItem = await tx.compraItem.create({
            data: {
              compra_id: compra.id,
              item: it.item || it.descripcion || "—",
              cantidad: Number(it.cantidad || 1),
              precio_unit: Number(it.precio_unit ?? it.precioUnitario ?? 0),
              total: itemTotal,
              codigo: it.codigo ? String(it.codigo) : null,
              unidad: it.unidad || null,
              descuento: it.descuento ? Number(it.descuento) : null,
              impuesto: it.impuesto ? Number(it.impuesto) : null,
            },
          });

          if (it.detalleVentaId) {
            await tx.detalleVenta.update({
              where: { id: it.detalleVentaId },
              data: { compraId: compItem.id },
            });
          }
        }
      }

      return tx.compra.findUnique({
        where: { id: compra.id },
        include: {
          proveedor: { select: { id: true, nombre: true } },
          proyecto: { select: { id: true, nombre: true } },
          cotizacion: { select: { id: true, numero: true } },
          items: true,
        },
      });
    });

    return reply.code(201).send(created);
  } catch (error) {
    console.error("Error creando orden de compra desde proveedor:", error);
    return reply.code(error.statusCode || 500).send({ error: error.message });
  }
}
