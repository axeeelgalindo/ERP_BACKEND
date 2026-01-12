import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const listVentas = async (request, reply) => {
  try {
    const ventas = await prisma.venta.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        detalles: {
          include: {
            tipoDia: true,
            hhEmpleado: true,
            empleado: { include: { usuario: true } },
            tipoItem: { include: { unidadItem: true } },
            compras: {
              include: { producto: true, proveedor: true, compra: true },
            },
          },
        },
        ordenVenta: {
          include: { proyecto: true, cliente: true },
        },
      },
    });

    return reply.send(ventas);
  } catch (error) {
    console.error(error);
    return reply.status(500).send({ error: "Error al listar ventas" });
  }
};

export const getVenta = async (request, reply) => {
  try {
    const empresaId = request.headers["x-empresa-id"];
    if (!empresaId)
      return reply.status(400).send({ error: "Falta x-empresa-id" });

    const { id } = request.params;
    if (!id)
      return reply.status(400).send({ error: "ID de venta es requerido" });

    const venta = await prisma.venta.findFirst({
      where: {
        id,
        OR: [
          { ordenVenta: { empresa_id: String(empresaId), eliminado: false } },
          {
            detalles: {
              some: { hhEmpleado: { empresa_id: String(empresaId) } },
            },
          },
          {
            detalles: {
              some: {
                compras: {
                  compra: { empresa_id: String(empresaId), eliminado: false },
                },
              },
            },
          },
        ],
      },
      include: {
        detalles: {
          include: {
            tipoDia: true,
            tipoItem: { include: { unidadItem: true } },
            empleado: { include: { usuario: true } },
            hhEmpleado: true,
            compras: {
              include: { producto: true, proveedor: true, compra: true },
            },
          },
        },
        ordenVenta: true,
      },
    });

    if (!venta) return reply.status(404).send({ error: "Venta no encontrada" });

    return reply.send(venta);
  } catch (error) {
    console.error(error);
    return reply.status(500).send({ error: "Error al obtener venta" });
  }
};

export const listOrdenesVenta = async (request, reply) => {
  try {
    const empresaId = request.headers["x-empresa-id"];
    if (!empresaId)
      return reply.status(400).send({ error: "Falta x-empresa-id" });

    const ovs = await prisma.cotizacion.findMany({
      where: {
        empresa_id: String(empresaId),
        eliminado: false,
      },
      orderBy: { creada_en: "desc" },
      select: {
        id: true,
        numero: true,
        total: true,
        creada_en: true,
        proyecto: { select: { nombre: true } },
        cliente: { select: { nombre: true } },
        estado: true,
      },
    });

    return reply.send(ovs);
  } catch (e) {
    console.error(e);
    return reply.status(500).send({ error: "Error listando ordenes de venta" });
  }
};

export const createVenta = async (request, reply) => {
  try {
    const { ordenVentaId, descripcion, detalles = [] } = request.body || {};

    if (!Array.isArray(detalles) || detalles.length === 0) {
      return reply.status(400).send({ error: "Debe enviar al menos un detalle de venta" });
    }

    /**
     * Acepta alpha como:
     * - porcentaje: 10, 20, 0  (UI)
     * - decimal: 0.1, 0.2, 0  (por si FE lo manda así)
     * Devuelve alphaPct (0..100)
     */
    const normalizeAlphaPct = (v) => {
      if (v == null || v === "") return 10; // default 10%
      const n = Number(v);
      if (!Number.isFinite(n)) return 10;

      // si viene como decimal (0..1), lo convertimos a %
      if (n > 0 && n <= 1) return n * 100;

      // si viene en % normal
      if (n < 0) return 0;
      return n;
    };

    const ventaCreada = await prisma.$transaction(async (tx) => {
      // TipoItem HH (forzado cuando modo=HH)
      const tipoItemHH = await tx.tipoItem.findFirst({ where: { codigo: "HH" } });
      if (!tipoItemHH) {
        throw new Error("Falta el Tipo ítem HH (tipoItem.codigo='HH'). Crea ese registro en el catálogo.");
      }

      const detallesData = [];

      for (const det of detalles) {
        const {
          descripcion: descDetalle,
          cantidad: cantidadRaw,

          tipoItemId: tipoItemIdRaw,
          modo: modoRaw,

          // COMPRA
          compraId, // CompraItem.id (opcional)
          costoUnitarioManual, // si es COMPRA manual

          // HH
          tipoDiaId,
          alpha: alphaRaw, // puede venir 10 o 0.1
          empleadoId,
          hhEmpleadoId,
        } = det;

        if (!descDetalle) throw new Error("Cada detalle debe tener 'descripcion'");

        const cantidad = Number(cantidadRaw) || 1;
        if (cantidad <= 0) throw new Error("La cantidad debe ser mayor a 0");

        const modo = String(modoRaw || "").toUpperCase();
        if (modo !== "HH" && modo !== "COMPRA") {
          throw new Error("Cada detalle debe incluir 'modo' válido: 'HH' o 'COMPRA'");
        }

        // alpha como porcentaje y multiplicador
        const alphaPct = normalizeAlphaPct(alphaRaw); // 0..100
        const alphaMult = 1 + alphaPct / 100;

        // =====================================
        // CARGAR RELACIONES
        // =====================================
        let tipoItem = null;
        let compraItem = null;
        let hhEmpleado = null;
        let tipoDia = null;

        if (modo === "HH") {
          tipoItem = tipoItemHH;
        } else {
          if (!tipoItemIdRaw) {
            throw new Error("Cada detalle COMPRA debe seleccionar un Tipo ítem (tipoItemId)");
          }
          tipoItem = await tx.tipoItem.findUnique({ where: { id: tipoItemIdRaw } });
          if (!tipoItem) throw new Error(`tipoItemId inválido: ${tipoItemIdRaw}`);
        }

        if (tipoDiaId) {
          tipoDia = await tx.tipoDia.findUnique({ where: { id: tipoDiaId } });
          if (!tipoDia) throw new Error(`tipoDiaId inválido: ${tipoDiaId}`);
        }

        if (modo === "HH") {
          if (!empleadoId) throw new Error("HH requiere empleadoId");
          if (!hhEmpleadoId) throw new Error("HH requiere hhEmpleadoId");

          hhEmpleado = await tx.hHEmpleado.findUnique({ where: { id: hhEmpleadoId } });
          if (!hhEmpleado) throw new Error(`hhEmpleadoId inválido: ${hhEmpleadoId}`);
        }

        if (modo === "COMPRA" && compraId) {
          compraItem = await tx.compraItem.findUnique({ where: { id: compraId } });
          if (!compraItem) throw new Error(`compraId inválido: ${compraId}`);
        }

        // =====================================
        // VALIDACIONES
        // =====================================
        if (modo === "HH" && compraId) {
          throw new Error("Un detalle HH no puede traer compraId");
        }

        if (modo === "COMPRA") {
          if (empleadoId || hhEmpleadoId) {
            throw new Error("Un detalle COMPRA no puede traer empleadoId/hhEmpleadoId");
          }

          const manualPU = costoUnitarioManual != null ? Number(costoUnitarioManual) : null;
          const tieneCompraVinculada = !!compraItem;
          const tieneManual = manualPU != null && Number.isFinite(manualPU) && manualPU > 0;

          if (!tieneCompraVinculada && !tieneManual) {
            throw new Error("Detalle COMPRA requiere 'compraId' (vinculada) o 'costoUnitarioManual' (manual)");
          }
        }

        // =====================================
        // CÁLCULOS
        // =====================================
        let costoHH = null;
        let costoUnitario = 0;
        let costoTotal = 0;
        let ventaUnitario = 0;
        let ventaTotal = 0;

        const gananciaPct = Number(tipoItem?.porcentajeUtilidad ?? 0); // ej 30 => 30%
        const extraFijo = tipoDia ? Number(tipoDia.valor ?? 0) : 0; // Normal = 0

        // --------- HH ---------
        if (modo === "HH") {
          if (hhEmpleado.costoHH == null) {
            throw new Error(`El registro HHEmpleado ${hhEmpleadoId} no tiene costoHH definido`);
          }

          costoHH = Number(hhEmpleado.costoHH);
          const cif = Number(hhEmpleado.cif ?? 0);

          // costo real
          costoUnitario = costoHH;
          costoTotal = costoHH * cantidad + cif; // CIF se suma una vez por ítem

          // ✅ venta correcta: costo + margen + CIF prorrateado + extra fijo
          ventaUnitario =
            costoHH * (1 + gananciaPct / 100) +
            (cantidad > 0 ? cif / cantidad : cif) +
            extraFijo;

          ventaTotal = ventaUnitario * cantidad * alphaMult;
        }

        // --------- COMPRA ---------
        if (modo === "COMPRA") {
          if (compraItem) {
            if (compraItem.precio_unit != null) {
              costoUnitario = Number(compraItem.precio_unit);
            } else {
              const cantCompra = Number(compraItem.cantidad) || 1;
              costoUnitario = (Number(compraItem.total) || 0) / cantCompra;
            }
          } else {
            costoUnitario = Number(costoUnitarioManual);
          }

          costoTotal = costoUnitario * cantidad;
          ventaUnitario = costoUnitario * (1 + gananciaPct / 100);
          ventaTotal = ventaUnitario * cantidad * alphaMult;
        }

        const utilidad = ventaTotal - costoTotal;
        const porcentajeUtilidad = ventaTotal > 0 ? (utilidad / ventaTotal) * 100 : 0;

        detallesData.push({
          descripcion: descDetalle,
          cantidad,
          modo,

          tipoItemId: tipoItem?.id ?? null,

          // COMPRA
          compraId: modo === "COMPRA" ? (compraId ?? null) : null,
          costoUnitario:
            modo === "COMPRA" && !compraId ? Number(costoUnitarioManual) : costoUnitario,

          // HH
          empleadoId: modo === "HH" ? (empleadoId ?? null) : null,
          hhEmpleadoId: modo === "HH" ? (hhEmpleadoId ?? null) : null,
          costoHH,

          // día
          tipoDiaId: tipoDiaId ?? null,

          // guardamos % (0..100)
          alpha: alphaPct,

          // cálculos
          costoTotal,
          ventaUnitario,
          ventaTotal,
          utilidad,
          porcentajeUtilidad,
          total: ventaTotal,
        });
      }

      if (ordenVentaId) {
        const ov = await tx.cotizacion.findUnique({ where: { id: ordenVentaId } });
        if (!ov) throw new Error("ordenVentaId inválido (cotización no existe)");
      }

      const nuevaVenta = await tx.venta.create({
        data: {
          ordenVentaId: ordenVentaId ?? null,
          descripcion: descripcion ?? null,
          detalles: { create: detallesData },
        },
        include: {
          detalles: {
            include: {
              tipoItem: { include: { unidadItem: true } },
              empleado: { include: { usuario: true } },
              compras: {
                include: { producto: true, proveedor: true, compra: true, tipoItem: true },
              },
              tipoDia: true,
            },
          },
          ordenVenta: { include: { proyecto: true, cliente: true } },
        },
      });

      return nuevaVenta;
    });

    return reply.status(201).send(ventaCreada);
  } catch (error) {
    console.error("Error al crear venta:", error);
    return reply.status(500).send({ error: "Error al crear venta", detalle: error.message });
  }
};

