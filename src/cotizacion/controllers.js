// src/modules/cotizaciones/controllers.js
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

/* =========================
   Helpers
========================= */
function getEmpresaId(request) {
  const empresaId = request.headers["x-empresa-id"];
  if (!empresaId) {
    const err = new Error("Falta empresa en el contexto");
    err.statusCode = 401;
    throw err;
  }
  return String(empresaId);
}

function calcTotalesFromVentas(ventas, ivaRate = 0.19) {
  const subtotal = ventas.reduce((acc, v) => {
    const totalVenta = (v.detalles || []).reduce(
      (s, d) => s + (Number(d.total ?? d.ventaTotal) || 0),
      0
    );
    return acc + totalVenta;
  }, 0);

  const iva = Math.round(subtotal * ivaRate);
  const total = subtotal + iva;

  return { subtotal, iva, total };
}

/* =========================
   GET /cotizaciones
========================= */
export const listCotizaciones = async (request, reply) => {
  try {
    const empresaId = getEmpresaId(request);
    const { estado } = request.query || {};

    const where = {
      empresa_id: empresaId,
      eliminado: false,
      ...(estado ? { estado } : {}),
    };

    const cotizaciones = await prisma.cotizacion.findMany({
      where,
      orderBy: { creada_en: "desc" },
      include: {
        cliente: true,
        proyecto: true,
        items: { include: { producto: true } }, // ✅ IMPORTANTE
        ventas: { include: { detalles: true } }, // opcional
      },
    });

    return reply.send(cotizaciones);
  } catch (e) {
    return reply.code(e.statusCode || 500).send({
      error: "Error al listar cotizaciones",
      detalle: e.message,
    });
  }
};

/* =========================
   GET /cotizaciones/:id
========================= */
export const getCotizacion = async (request, reply) => {
  try {
    const empresaId = getEmpresaId(request);
    const { id } = request.params;

    const cot = await prisma.cotizacion.findFirst({
      where: { id, empresa_id: empresaId, eliminado: false },
      include: {
        proyecto: true,
        cliente: true,
        items: { include: { producto: true } }, // ✅ IMPORTANTÍSIMO
        ventas: { include: { detalles: true } },
      },
    });

    if (!cot) return reply.code(404).send({ error: "Cotización no encontrada" });

    // si ya guardas subtotal/iva/total, no recalcules (pero lo dejo por si acaso)
    const subtotal = Number(cot.subtotal ?? 0) || 0;
    const iva = Number(cot.iva ?? 0) || 0;
    const total = Number(cot.total ?? 0) || 0;

    return reply.send({ ...cot, subtotal, iva, total });
  } catch (e) {
    return reply.code(e.statusCode || 500).send({
      error: "Error al obtener cotización",
      detalle: e.message,
    });
  }
};

/* =========================
   POST /cotizaciones/desde-ventas
   - Crea cotización desde ventas seleccionadas
   - Vincula ventas => cotizacion (ordenVentaId)
   - ✅ Genera CotizacionItem automáticamente desde VentaDetalle
   - ✅ Guarda cantidad (si viene)
   - ✅ Calcula subtotal/iva/total desde ventas
========================= */
export const createCotizacionFromVentas = async (request, reply) => {
  try {
    const empresaId = getEmpresaId(request);

    const {
      proyecto_id,
      cliente_id,
      descripcion,
      cantidad, // ✅ NUEVO (opcional)
      terminos_condiciones,
      acuerdo_pago,
      ventaIds = [],
      ivaRate = 0.19,
    } = request.body || {};

    // =========================
    // Validaciones base
    // =========================
    if (!proyecto_id) {
      return reply.code(400).send({ error: "proyecto_id es obligatorio" });
    }

    if (!Array.isArray(ventaIds) || ventaIds.length === 0) {
      return reply.code(400).send({ error: "Debes enviar ventaIds" });
    }

    // ✅ validar cantidad si viene
    const cantidadNum =
      cantidad == null || cantidad === ""
        ? null
        : Number.isFinite(Number(cantidad))
        ? Number(cantidad)
        : NaN;

    if (cantidadNum !== null) {
      if (!Number.isInteger(cantidadNum) || cantidadNum <= 0) {
        return reply.code(400).send({
          error: "cantidad debe ser un entero positivo",
        });
      }
    }

    const ivaRateNum = Number(ivaRate);
    if (!Number.isFinite(ivaRateNum) || ivaRateNum < 0 || ivaRateNum > 1) {
      return reply.code(400).send({
        error: "ivaRate inválido (ej: 0.19)",
      });
    }

    // =========================
    // Transacción
    // =========================
    const created = await prisma.$transaction(async (tx) => {
      // 1) Validar proyecto (empresa)
      const proyecto = await tx.proyecto.findFirst({
        where: { id: proyecto_id, empresa_id: empresaId, eliminado: false },
        select: { id: true },
      });
      if (!proyecto) throw new Error("Proyecto inválido");

      // 2) Validar cliente (si viene)
      if (cliente_id) {
        const cliente = await tx.cliente.findFirst({
          where: { id: cliente_id, empresa_id: empresaId, eliminado: false },
          select: { id: true },
        });
        if (!cliente) throw new Error("Cliente inválido");
      }

      // 3) Cargar ventas con detalles + relaciones (para generar items)
      //    Venta NO tiene empresa_id => validamos scope por:
      //    - ordenVenta.empresa_id
      //    - detalles.hhEmpleado.empresa_id
      //    - detalles.compras.compra.empresa_id
      const ventas = await tx.venta.findMany({
        where: {
          id: { in: ventaIds },
          OR: [
            { ordenVenta: { empresa_id: empresaId, eliminado: false } },
            { detalles: { some: { hhEmpleado: { empresa_id: empresaId } } } },
            {
              detalles: {
                some: {
                  compras: {
                    compra: { empresa_id: empresaId, eliminado: false },
                  },
                },
              },
            },
          ],
        },
        include: {
          detalles: {
            include: {
              tipoItem: { include: { unidadItem: true } },
              empleado: { include: { usuario: true } },
              hhEmpleado: true,
              tipoDia: true,
              compras: {
                include: { producto: true, proveedor: true, compra: true },
              },
            },
          },
          ordenVenta: { include: { proyecto: true, cliente: true } },
        },
      });

      if (ventas.length !== ventaIds.length) {
        throw new Error("Una o más ventas no existen o no pertenecen a la empresa");
      }

      // 4) Evitar reutilizar ventas
      const usadas = ventas.filter((v) => v.ordenVentaId);
      if (usadas.length > 0) {
        throw new Error(
          `Ventas ya asociadas a cotización: ${usadas
            .map((v) => v.numero ?? v.id)
            .join(", ")}`
        );
      }

      // 5) Crear cotización base
      const cot = await tx.cotizacion.create({
        data: {
          empresa_id: empresaId,
          proyecto_id,
          cliente_id: cliente_id || null,
          descripcion: descripcion || null,
          cantidad: cantidadNum, // ✅ guardamos cantidad
          terminos_condiciones: terminos_condiciones || null,
          acuerdo_pago: acuerdo_pago || null,
          estado: "COTIZACION",
          subtotal: 0,
          iva: 0,
          total: 0,
        },
        select: { id: true },
      });

      // 6) Vincular ventas a la cotización (ordenVentaId = cot.id)
      //    (mismo scope de empresa para no tocar ventas ajenas)
      const upd = await tx.venta.updateMany({
        where: {
          id: { in: ventaIds },
          OR: [
            { ordenVenta: { empresa_id: empresaId, eliminado: false } },
            { detalles: { some: { hhEmpleado: { empresa_id: empresaId } } } },
            {
              detalles: {
                some: {
                  compras: {
                    compra: { empresa_id: empresaId, eliminado: false },
                  },
                },
              },
            },
          ],
        },
        data: { ordenVentaId: cot.id },
      });

      if (upd.count !== ventaIds.length) {
        throw new Error("No se pudieron vincular todas las ventas (scope empresa)");
      }

      // 7) Calcular totales desde ventas
      const { subtotal, iva, total } = calcTotalesFromVentas(ventas, ivaRateNum);

      // 8) ✅ Generar CotizacionItem desde VentaDetalle
      //    - Si detalle viene de compras => PRODUCTO (producto_id si existe)
      //    - Si detalle viene de HH => SERVICIO (Item texto libre)
      //    - precioUnitario = totalDet/cantidad
      const itemsToCreate = [];

      for (const v of ventas) {
        for (const d of v.detalles || []) {
          const cantidadDetRaw = Number(d.cantidad ?? 1);
          const cantidadDet =
            Number.isFinite(cantidadDetRaw) && cantidadDetRaw > 0
              ? Math.trunc(cantidadDetRaw)
              : 1;

          const totalDet = Number(d.total ?? d.ventaTotal ?? 0);
          const precioUnitario = cantidadDet > 0 ? totalDet / cantidadDet : totalDet;

          const isCompra = !!d?.compras;
          const empleadoNombre =
            d?.empleado?.usuario?.nombre ||
            d?.empleado?.usuario?.correo ||
            d?.empleado?.id ||
            "";

          const productoNombre =
            d?.compras?.producto?.nombre || d?.compras?.item || null;

          const itemLabel = isCompra
            ? productoNombre || "Producto"
            : empleadoNombre
            ? `HH ${empleadoNombre}`.trim()
            : d?.tipoItem?.nombre || "Servicio";

          // Producto_id: intenta sacar desde compras si existe
          const productoId =
            d?.compras?.productoId || d?.compras?.producto?.id || null;

          itemsToCreate.push({
            cotizacion_id: cot.id,
            tipo: isCompra ? "PRODUCTO" : "SERVICIO",
            producto_id: isCompra ? productoId : null,
            Item: isCompra ? null : itemLabel,
            descripcion: d.descripcion || null,
            cantidad: cantidadDet,
            precioUnitario: Number.isFinite(precioUnitario) ? precioUnitario : 0,
            total: Number.isFinite(totalDet) ? totalDet : 0,
          });
        }
      }

      if (itemsToCreate.length > 0) {
        await tx.cotizacionItem.createMany({
          data: itemsToCreate,
        });
      }

      // 9) Actualizar totales y retornar con items incluidos
      return tx.cotizacion.update({
        where: { id: cot.id },
        data: { subtotal, iva, total },
        include: {
          proyecto: true,
          cliente: true,
          items: { include: { producto: true } }, // ✅ ahora sí aparecen items
          ventas: {
            include: {
              detalles: true,
            },
          },
        },
      });
    });

    return reply.code(201).send(created);
  } catch (e) {
    return reply.code(e.statusCode || 400).send({
      error: "Error al crear cotización desde ventas",
      detalle: e.message,
    });
  }
};


/* =========================
   POST /cotizaciones/:id/estado
========================= */
export const updateCotizacionEstado = async (request, reply) => {
  try {
    const empresaId = getEmpresaId(request);
    const { id } = request.params;
    const { estado } = request.body || {};

    const valid = ["COTIZACION", "ORDEN_VENTA", "FACTURADA", "PAGADA"];
    if (!valid.includes(estado)) {
      return reply.code(400).send({ error: "Estado inválido" });
    }

    const allowed = {
      COTIZACION: ["ORDEN_VENTA"],
      ORDEN_VENTA: ["FACTURADA"],
      FACTURADA: ["PAGADA"],
      PAGADA: [],
    };

    const actual = await prisma.cotizacion.findFirst({
      where: { id, empresa_id: empresaId, eliminado: false },
      select: { estado: true },
    });

    if (!actual) {
      return reply.code(404).send({ error: "Cotización no encontrada" });
    }

    if (!allowed[actual.estado].includes(estado)) {
      return reply.code(400).send({
        error: `Transición no permitida: ${actual.estado} → ${estado}`,
      });
    }

    const updated = await prisma.cotizacion.update({
      where: { id },
      data: { estado },
      include: {
        proyecto: true,
        cliente: true,
        ventas: {
          include: { detalles: true },
        },
      },
    });

    const { subtotal, iva, total } = calcTotalesFromVentas(updated.ventas);

    return reply.send({ ...updated, subtotal, iva, total });
  } catch (e) {
    return reply.code(500).send({
      error: "Error al actualizar estado",
      detalle: e.message,
    });
  }
};
