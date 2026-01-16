import { PrismaClient } from "@prisma/client";
import { resolveScope } from "../lib/scope.js";
import { httpError } from "../lib/errors.js";
import { parse } from "csv-parse/sync";
const prisma = new PrismaClient();

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;

/* ===== Helpers ===== */
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
  if (!id) return; // si viene null/undefined, no valida (porque es opcional en algunos casos)

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
  };

  const q = map[tabla];
  if (!q) return;

  const ok = await q();
  if (!ok) throw Object.assign(new Error(`${tabla} no pertenece a tu empresa`), { statusCode: 403 });
}

function calcTotal(items = []) {
  return items.reduce((acc, it) => {
    const cantidad = Number(it.cantidad || 0);
    const precio = Number(it.precio_unit ?? it.precio_unitario ?? 0);
    return acc + cantidad * precio;
  }, 0);
}

function pickCompraSelect() {
  return {
    id: true,
    numero: true,
    empresa_id: true,
    proyecto_id: true,
    estado: true,
    total: true,
    creada_en: true,
    actualizado_en: true,
    eliminado: true,
    eliminado_en: true,
    cotizacionId: true,
    proveedorId: true,
  };
}

function parseCLP(v) {
  // soporta "", null
  const s = String(v ?? "").trim();
  if (!s) return 0;
  // RCV suele venir sin separadores. Igual limpiamos.
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

  let hh = 0, mi = 0, ss = 0;
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

export async function importComprasCSV(request, reply) {
  const scope = resolveScope(request);

  // multipart: file=<csv>
  const file = await request.file();
  if (!file) return httpError(reply, 400, "Debes enviar un archivo CSV en form-data (file)");

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
      relax_column_count: true, // el CSV suele traer ; al final
      trim: true,
    });

    if (!Array.isArray(records) || records.length === 0) {
      return httpError(reply, 400, "CSV vacío o formato inválido");
    }

    let created = 0;
    let skipped = 0;
    const errors = [];

    // Opcional: si quieres performance real, sube chunkSize a 200-500
    const chunkSize = 50;

    for (let start = 0; start < records.length; start += chunkSize) {
      const chunk = records.slice(start, start + chunkSize);

      await prisma.$transaction(async (tx) => {
        for (let j = 0; j < chunk.length; j++) {
          const i = start + j;
          const row = chunk[j];

          try {
            // ====== columnas reales del RCV ======
            const tipoDoc = toIntOrNull(row["Tipo Doc"]); // 33, 34, etc.
            const tipoCompra = normStr(row["Tipo Compra"]); // "Del Giro" u otros (no lo guardamos en el modelo actual)
            const rutProv = normRut(row["RUT Proveedor"]);
            const razon = normStr(row["Razon Social"]);
            const folio = normStr(row["Folio"]);

            const fechaDocto = parseDateDMY(row["Fecha Docto"]);
            const fechaRecep = parseDateTimeDMY(row["Fecha Recepcion"]);

            const montoTotal = parseCLP(row["Monto Total"]);

            // mínimos para crear
            if (!rutProv || !folio || montoTotal <= 0) {
              throw new Error(
                `Fila inválida: rutProv=${rutProv || "-"} folio=${folio || "-"} montoTotal=${montoTotal}`
              );
            }

            // 1) Proveedor: buscar por rut + empresa (si no existe, crearlo)
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

            // 2) Dedupe: evitar importar 2 veces el mismo doc
            //    (empresa + proveedor + tipo_doc + folio)
            const exists = await tx.compra.findFirst({
              where: {
                empresa_id,
                proveedorId: prov.id,
                folio: folio,
                tipo_doc: tipoDoc,
                eliminado: false,
              },
              select: { id: true },
            });

            if (exists) {
              skipped++;
              continue;
            }

            // 3) Crear compra + 1 item
            await tx.compra.create({
              data: {
                empresa_id,
                proveedorId: prov.id,

                // Import RCV: normalmente ya está facturada
                estado: "FACTURADA",
                total: montoTotal,

                // ===== campos de tu modelo =====
                tipo_doc: tipoDoc,
                folio: folio,
                rut_proveedor: rutProv,
                razon_social: razon,
                fecha_docto: fechaDocto,
                fecha_recepcion: fechaRecep,

                // Guardamos 1 item “resumen”
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



/* ===== LIST ===== */
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

  const empresa_id = scope.isMaster ? (empresaId || scope.empresaId) : scope.empresaId;

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
            // numero es Int, si q es numérico filtramos exacto
            ...(Number.isFinite(Number(q)) ? [{ numero: Number(q) }] : []),
            { proveedor: { nombre: { contains: String(q), mode: "insensitive" } } },
            { proyecto: { nombre: { contains: String(q), mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [total, data] = await Promise.all([
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
        items: {
          include: {
            producto: { select: { id: true, nombre: true, sku: true } },
            proveedor: { select: { id: true, nombre: true } },
          },
        },
      },
    }),
  ]);

  return reply.send({ total, page: pageN, pageSize: sizeN, data });
}

export async function listComprasDisponiblesVenta(request, reply) {
  const scope = resolveScope(request);

  const compras = await prisma.compra.findMany({
    where: {
      empresa_id: scope.empresaId,
      eliminado: false,
      estado: { in: ["PAGADA", "FACTURADA"] },

      // basta con que tenga items
      items: { some: {} },

      // opcional: que no esté usada en ventas
      NOT: {
        items: {
          some: {
            detalleVentas: {
              some: {},
            },
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

/* ===== GET ===== */
export async function getCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const where = scope.isMaster
    ? { id }
    : { id, empresa_id: scope.empresaId };

  const row = await prisma.compra.findFirst({
    where,
    include: {
      proveedor: true,
      proyecto: true,
      cotizacion: true,
      items: { include: { producto: true, proveedor: true } },
    },
  });

  if (!row) return httpError(reply, 404, "Compra no encontrada");
  return reply.send(row);
}

/* ===== CREATE =====
Body esperado:
{
  "proyecto_id": "...?" ,
  "proveedorId": "...?" ,
  "cotizacionId": "...?" ,
  "estado": "ORDEN_COMPRA" | "FACTURADA" | "PAGADA" ,
  "items": [
    { "producto_id": "...?", "proveedor_id": "...?", "item": "texto?", "cantidad": 2, "precio_unit": 1000 }
  ],
  "total": 123 // opcional, si no lo mandas lo calcula
  "empresa_id": "..." // solo master opcional
}
*/
export async function createCompra(request, reply) {
  const scope = resolveScope(request);
  const body = request.body || {};

  const empresa_id = scope.isMaster ? (body.empresa_id || scope.empresaId) : scope.empresaId;

  const estadoNorm = normalizeEstadoCompra(body.estado) || "ORDEN_COMPRA";

  const items = Array.isArray(body.items) ? body.items : [];
  const total = body.total != null ? Number(body.total) : calcTotal(items);

  // Validaciones tenant + integridad (todo en transaction)
  const created = await prisma.$transaction(async (tx) => {
    await assertEntidadEmpresa(tx, "proyecto", body.proyecto_id, empresa_id);
    await assertEntidadEmpresa(tx, "proveedor", body.proveedorId, empresa_id);
    await assertEntidadEmpresa(tx, "cotizacion", body.cotizacionId, empresa_id);

    // validar items (producto y/o proveedor si viene)
    for (const it of items) {
      if (it.producto_id) await assertEntidadEmpresa(tx, "producto", it.producto_id, empresa_id);
      if (it.proveedor_id) await assertEntidadEmpresa(tx, "proveedor", it.proveedor_id, empresa_id);
    }

    return tx.compra.create({
      data: {
        empresa_id,
        proyecto_id: body.proyecto_id ?? null,
        proveedorId: body.proveedorId ?? null,
        cotizacionId: body.cotizacionId ?? null,

        estado: estadoNorm,
        total: Number(total || 0),

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
            };
          }),
        },
      },
      include: {
        proveedor: { select: { id: true, nombre: true } },
        proyecto: { select: { id: true, nombre: true } },
        cotizacion: { select: { id: true, numero: true } },
        items: { include: { producto: true, proveedor: true } },
      },
    });
  });

  return reply.code(201).send(created);
}

/* ===== UPDATE =====
- Permite actualizar cabecera (proyecto, proveedor, cotizacion, estado, total)
- Si viene items => reemplazo completo (simple y consistente)
*/
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

  const estadoNorm = normalizeEstadoCompra(body.estado);

  const hasItems = Array.isArray(body.items);
  const nextItems = hasItems ? body.items : null;

  const updated = await prisma.$transaction(async (tx) => {
    // validar cambios de relaciones si vienen
    if (body.proyecto_id && body.proyecto_id !== exists.proyecto_id) {
      await assertEntidadEmpresa(tx, "proyecto", body.proyecto_id, empresa_id);
    }
    if (body.proveedorId && body.proveedorId !== exists.proveedorId) {
      await assertEntidadEmpresa(tx, "proveedor", body.proveedorId, empresa_id);
    }
    if (body.cotizacionId && body.cotizacionId !== exists.cotizacionId) {
      await assertEntidadEmpresa(tx, "cotizacion", body.cotizacionId, empresa_id);
    }

    // preparar data cabecera
    const data = {};

    if (body.proyecto_id !== undefined) data.proyecto_id = body.proyecto_id || null;
    if (body.proveedorId !== undefined) data.proveedorId = body.proveedorId || null;
    if (body.cotizacionId !== undefined) data.cotizacionId = body.cotizacionId || null;
    if (estadoNorm) data.estado = estadoNorm;
    if (body.eliminado !== undefined) data.eliminado = Boolean(body.eliminado); // por si quieres permitirlo (opcional)

    if (hasItems) {
      // validar items
      for (const it of nextItems) {
        if (it.producto_id) await assertEntidadEmpresa(tx, "producto", it.producto_id, empresa_id);
        if (it.proveedor_id) await assertEntidadEmpresa(tx, "proveedor", it.proveedor_id, empresa_id);
      }

      const newTotal = body.total != null ? Number(body.total) : calcTotal(nextItems);
      data.total = Number(newTotal || 0);

      // reemplazo completo items
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
            };
          }),
        });
      }
    } else if (body.total != null) {
      data.total = Number(body.total || 0);
    }

    await tx.compra.update({ where: { id }, data });

    return tx.compra.findUnique({
      where: { id },
      include: {
        proveedor: true,
        proyecto: true,
        cotizacion: true,
        items: { include: { producto: true, proveedor: true } },
      },
    });
  });

  return reply.send(updated);
}

/* ===== DELETE (físico) =====
Regla recomendada:
- si estado = ORDEN_COMPRA -> permite
- si no -> requiere ?force=true
*/
export async function deleteCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;
  const { force } = request.query || {};

  const where = scope.isMaster
    ? { id }
    : { id, empresa_id: scope.empresaId };

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
    await tx.compraItem.deleteMany({ where: { compra_id: id } });
    await tx.compra.delete({ where: { id } });
  });

  return reply.send({ success: true });
}

/* ===== SOFT DELETE ===== */
export async function disableCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const where = scope.isMaster
    ? { id }
    : { id, empresa_id: scope.empresaId };

  const row = await prisma.compra.findFirst({ where });
  if (!row) return httpError(reply, 404, "Compra no encontrada");
  if (row.eliminado) return httpError(reply, 409, "Compra ya está eliminada");

  const upd = await prisma.compra.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date() },
  });

  return reply.send({ success: true, compra: upd });
}

/* ===== RESTORE ===== */
export async function restoreCompra(request, reply) {
  const scope = resolveScope(request);
  const { id } = request.params;

  const where = scope.isMaster
    ? { id }
    : { id, empresa_id: scope.empresaId };

  const row = await prisma.compra.findFirst({ where });
  if (!row) return httpError(reply, 404, "Compra no encontrada");
  if (!row.eliminado) return httpError(reply, 409, "Compra no está eliminada");

  const upd = await prisma.compra.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null },
  });

  return reply.send({ success: true, compra: upd });
}
