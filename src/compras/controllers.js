// src/controllers/compras/controllers.js
import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";
import { parse } from "csv-parse/sync";

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";

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
function getPrevPeriod(year, month) {
  if (month === 1) return { y: year - 1, m: 12 };
  return { y: year, m: month - 1 };
}

async function countComprasNoVinculadas(tx, empresa_id, year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  const compras = await tx.compra.findMany({
    where: {
      empresa_id,
      eliminado: false,
      fecha_docto: { gte: start, lt: end },
      estado: { in: ["FACTURADA", "PAGADA"] },
    },
    select: { id: true, total: true },
  });

  if (!compras.length) return { total: 0, pendientes: 0, ids: [] };

  const ids = compras.map((c) => c.id);

  const sums = await tx.compraCosteo.groupBy({
    by: ["compra_id"],
    where: { empresa_id, compra_id: { in: ids } },
    _sum: { monto: true },
  });

  const map = new Map(
    sums.map((x) => [x.compra_id, Number(x._sum.monto || 0)])
  );

  const pendingIds = [];
  for (const c of compras) {
    const sum = map.get(c.id) || 0;
    const pct = c.total > 0 ? sum / c.total : 0;
    if (pct < 0.999999) pendingIds.push(c.id);
  }

  return {
    total: compras.length,
    pendientes: pendingIds.length,
    ids: pendingIds,
  };
}

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

    // ✅ bloquear import si mes anterior tiene compras no 100% vinculadas
    const firstRow = records.find((r) => r["Fecha Docto"]);
    const firstDate = parseDateDMY(firstRow?.["Fecha Docto"]);
    if (!firstDate) {
      return httpError(
        reply,
        400,
        "No se pudo detectar el periodo del CSV (Fecha Docto)"
      );
    }

    const csvYear = firstDate.getFullYear();
    const csvMonth = firstDate.getMonth() + 1;
    const prev = getPrevPeriod(csvYear, csvMonth);

    const check = await prisma.$transaction((tx) =>
      countComprasNoVinculadas(tx, empresa_id, prev.y, prev.m)
    );

    if (check.pendientes > 0) {
      return httpError(
        reply,
        409,
        `No puedes importar el RCV ${csvMonth}/${csvYear}: hay ${check.pendientes} compras del periodo ${prev.m}/${prev.y} sin 100% vincular a un costeo`
      );
    }

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
                `Fila inválida: rutProv=${rutProv || "-"} folio=${
                  folio || "-"
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

            // 3) crear compra
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

/* =========================
   LIST
========================= */
export async function listCompras(request, reply) {
  const scope = resolveScope(request);

  const {
    q,
    estado,
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
    ...(toBool(includeDeleted) ? {} : { eliminado: false }),
    ...(q
      ? {
          OR: [
            ...(Number.isFinite(Number(q)) ? [{ numero: Number(q) }] : []),
            { proveedor: { nombre: { contains: String(q), mode: "insensitive" } } },
            { proyecto: { nombre: { contains: String(q), mode: "insensitive" } } },
            { folio: { contains: String(q), mode: "insensitive" } },
            { razon_social: { contains: String(q), mode: "insensitive" } },
            { rut_proveedor: { contains: String(q), mode: "insensitive" } },
          ],
        }
      : {}),
  };

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
        cotizacion: { select: { id: true, numero: true, estado: true } },

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

  const empresa_id = scope.isMaster ? body.empresa_id || scope.empresaId : scope.empresaId;

  const estadoNorm = normalizeEstadoCompra(body.estado) || "ORDEN_COMPRA";

  // ✅ NUEVO
  const destino = String(body.destino || "PROYECTO").toUpperCase(); // PROYECTO | ADMINISTRACION | TALLER
  const centro_costo = body.centro_costo ? String(body.centro_costo).toUpperCase() : null; // PMC | PUQ
  const rendicion_id = body.rendicion_id ?? null;

  // normalizar items/total
  const items = Array.isArray(body.items) ? body.items : [];
  const total = body.total != null ? Number(body.total) : calcTotal(items);

  // ✅ VALIDACIONES (imputación)
  const isProyecto = destino === "PROYECTO";
  const isAdminOTaller = destino === "ADMINISTRACION" || destino === "TALLER";

  if (!isProyecto && !isAdminOTaller) {
    return reply.code(400).send({ error: "destino inválido (PROYECTO | ADMINISTRACION | TALLER)" });
  }

  if (isProyecto) {
    if (!body.proyecto_id) {
      return reply.code(400).send({ error: "proyecto_id es obligatorio cuando destino = PROYECTO" });
    }
    if (centro_costo) {
      return reply.code(400).send({ error: "centro_costo debe ser null cuando destino = PROYECTO" });
    }
  }

  if (isAdminOTaller) {
    if (!centro_costo || (centro_costo !== "PMC" && centro_costo !== "PUQ")) {
      return reply.code(400).send({ error: "centro_costo inválido u obligatorio (PMC | PUQ) para ADMINISTRACION/TALLER" });
    }
    if (body.proyecto_id) {
      return reply.code(400).send({ error: "proyecto_id debe ser null cuando destino es ADMINISTRACION/TALLER" });
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    // ✅ Antes validabas siempre proyecto; ahora depende del destino
    if (isProyecto) await assertEntidadEmpresa(tx, "proyecto", body.proyecto_id, empresa_id);

    await assertEntidadEmpresa(tx, "proveedor", body.proveedorId, empresa_id);
    await assertEntidadEmpresa(tx, "cotizacion", body.cotizacionId, empresa_id);

    // Validar productos/proveedores de items
    for (const it of items) {
      if (it.producto_id) await assertEntidadEmpresa(tx, "producto", it.producto_id, empresa_id);
      if (it.proveedor_id) await assertEntidadEmpresa(tx, "proveedor", it.proveedor_id, empresa_id);
    }

    // ✅ Si viene rendicion_id, validamos consistencia
    if (rendicion_id) {
      const r = await tx.rendicion.findFirst({
        where: { id: rendicion_id, eliminado: false, proyecto: { empresa_id, eliminado: false } },
        select: { id: true, proyecto_id: true, destino: true, centro_costo: true },
      });
      if (!r) throw httpError(404, "Rendición no existe o no pertenece a la empresa");

      // destino debe coincidir
      if (String(r.destino) !== destino) {
        throw httpError(400, "La rendición tiene un destino distinto a la compra");
      }
      // centro debe coincidir
      if ((r.centro_costo || null) !== (centro_costo || null)) {
        throw httpError(400, "La rendición tiene un centro_costo distinto a la compra");
      }
      // si es proyecto, proyecto_id debe coincidir
      if (destino === "PROYECTO" && r.proyecto_id !== body.proyecto_id) {
        throw httpError(400, "La compra debe usar el mismo proyecto_id de la rendición");
      }
    }

    return tx.compra.create({
      data: {
        empresa_id,

        // ✅ NUEVO
        destino,
        centro_costo: centro_costo ?? null,
        rendicion_id: rendicion_id ?? null,

        proyecto_id: isProyecto ? body.proyecto_id : null,

        proveedorId: body.proveedorId ?? null,
        cotizacionId: body.cotizacionId ?? null,

        estado: estadoNorm,
        total: Number(total || 0),

        tipo_doc: body.tipo_doc ?? null,
        folio: body.folio ?? null,
        rut_proveedor: body.rut_proveedor ?? null,
        razon_social: body.razon_social ?? null,
        fecha_docto: body.fecha_docto ? new Date(body.fecha_docto) : null,
        fecha_recepcion: body.fecha_recepcion ? new Date(body.fecha_recepcion) : null,

        factura_url: body.factura_url ?? null,
        factura_numero: body.factura_numero ?? null,
        factura_fecha: body.factura_fecha ? new Date(body.factura_fecha) : null,
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
    });
  });

  return reply.code(201).send(created);
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

  const updated = await prisma.$transaction(async (tx) => {
    // 1) validar compra (empresa)
    const compra = await tx.compra.findFirst({
      where: scope.isMaster ? { id } : { id, empresa_id: scope.empresaId },
      include: {
        proyecto: { select: { id: true, empresa_id: true } },
      },
    });
    if (!compra) return null;

    // 2) si viene rendicion_id, validar que exista y sea compatible
    if (rendicion_id) {
      const rend = await tx.rendicion.findFirst({
        where: {
          id: rendicion_id,
          eliminado: false,
          proyecto: {
            empresa_id: compra.empresa_id, // misma empresa
            eliminado: false,
            empresa: { eliminado: false },
          },
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
        return reply.code(404).send({ error: "Rendición no encontrada" });
      }

      // ✅ Compatibilidad básica (ajusta si quieres reglas más estrictas):
      // - Si compra es PROYECTO -> rendición debe ser PROYECTO y mismo proyecto_id
      // - Si compra es ADMIN/TALLER -> rendición mismo destino y mismo centro_costo
      const compraDestino = String(compra.destino || "PROYECTO").toUpperCase();
      const compraCentro = compra.centro_costo ? String(compra.centro_costo).toUpperCase() : null;
      const compraProyectoId = compra.proyecto_id || null;

      const rendDestino = String(rend.destino || "PROYECTO").toUpperCase();
      const rendCentro = rend.centro_costo ? String(rend.centro_costo).toUpperCase() : null;

      if (compraDestino === "PROYECTO") {
        if (rendDestino !== "PROYECTO") {
          return reply.code(400).send({ error: "Rendición incompatible: destino distinto (compra PROYECTO)" });
        }
        if (String(rend.proyecto_id) !== String(compraProyectoId)) {
          return reply.code(400).send({ error: "Rendición incompatible: proyecto distinto" });
        }
      } else {
        if (rendDestino !== compraDestino) {
          return reply.code(400).send({ error: "Rendición incompatible: destino distinto" });
        }
        if (!compraCentro || !rendCentro || rendCentro !== compraCentro) {
          return reply.code(400).send({ error: "Rendición incompatible: centro_costo distinto" });
        }
      }
    }

    // 3) update compra
    const row = await tx.compra.update({
      where: { id: compra.id },
      data: { rendicion_id },
      include: {
        rendicion: { select: { id: true, estado: true, monto_total: true, descripcion: true } },
      },
    });

    return row;
  });

  if (!updated) return httpError(reply, 404, "Compra no encontrada");
  return reply.send({ ok: true, row: updated });
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

  const nextDestino =
    body.destino !== undefined
      ? String(body.destino || "PROYECTO").toUpperCase()
      : String(exists.destino || "PROYECTO").toUpperCase();

  const nextCentroCosto =
    body.centro_costo !== undefined
      ? body.centro_costo
        ? String(body.centro_costo).toUpperCase()
        : null
      : exists.centro_costo
        ? String(exists.centro_costo).toUpperCase()
        : null;

  const nextProyectoId =
    body.proyecto_id !== undefined ? body.proyecto_id || null : exists.proyecto_id || null;

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
  const isAdminOTaller = nextDestino === "ADMINISTRACION" || nextDestino === "TALLER";

  if (!isProyecto && !isAdminOTaller) {
    return reply
      .code(400)
      .send({ error: "destino inválido (PROYECTO | ADMINISTRACION | TALLER)" });
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
    if (isProyecto && nextProyectoId && nextProyectoId !== exists.proyecto_id) {
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
      if (!r) throw httpError(404, "Rendición no existe o no pertenece a la empresa");

      if (String(r.destino || "PROYECTO").toUpperCase() !== nextDestino) {
        throw httpError(400, "La rendición tiene un destino distinto a la compra");
      }

      const rCentro = r.centro_costo ? String(r.centro_costo).toUpperCase() : null;
      if ((rCentro || null) !== (nextCentroCosto || null)) {
        throw httpError(400, "La rendición tiene un centro_costo distinto a la compra");
      }

      if (nextDestino === "PROYECTO" && String(r.proyecto_id) !== String(nextProyectoId)) {
        throw httpError(400, "La compra debe usar el mismo proyecto_id de la rendición");
      }
    }

    // ===== Construir data update
    const data = {};

    // imputación (NUEVO)
    data.destino = nextDestino;
    data.centro_costo = isProyecto ? null : nextCentroCosto;
    data.proyecto_id = isProyecto ? nextProyectoId : null;

    // rendición (solo si vino en body, o si cambió imputación y quieres forzar que se mantenga compatible)
    // Aquí lo dejamos: si NO vino rendicion_id, no lo tocamos.
    if (wantsChangeRendicion) data.rendicion_id = nextRendicionId;

    // resto campos existentes
    if (body.proveedorId !== undefined) data.proveedorId = body.proveedorId || null;
    if (body.cotizacionId !== undefined) data.cotizacionId = body.cotizacionId || null;
    if (estadoNorm) data.estado = estadoNorm;
    if (body.eliminado !== undefined) data.eliminado = Boolean(body.eliminado);

    if (body.tipo_doc !== undefined) data.tipo_doc = body.tipo_doc ?? null;
    if (body.folio !== undefined) data.folio = body.folio ?? null;
    if (body.rut_proveedor !== undefined) data.rut_proveedor = body.rut_proveedor ?? null;
    if (body.razon_social !== undefined) data.razon_social = body.razon_social ?? null;
    if (body.fecha_docto !== undefined)
      data.fecha_docto = body.fecha_docto ? new Date(body.fecha_docto) : null;
    if (body.fecha_recepcion !== undefined)
      data.fecha_recepcion = body.fecha_recepcion ? new Date(body.fecha_recepcion) : null;

    if (body.factura_url !== undefined) data.factura_url = body.factura_url ?? null;
    if (body.factura_numero !== undefined) data.factura_numero = body.factura_numero ?? null;
    if (body.factura_fecha !== undefined)
      data.factura_fecha = body.factura_fecha ? new Date(body.factura_fecha) : null;
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
      where: { id: String(venta_id) },
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
