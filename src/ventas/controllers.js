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
    if (!empresaId) return reply.status(400).send({ error: "Falta x-empresa-id" });

    const { id } = request.params;
    if (!id) return reply.status(400).send({ error: "ID de venta es requerido" });

    const venta = await prisma.venta.findFirst({
      where: {
        id,
        OR: [
          { ordenVenta: { empresa_id: String(empresaId), eliminado: false } },
          { detalles: { some: { hhEmpleado: { empresa_id: String(empresaId) } } } },
          { detalles: { some: { compras: { compra: { empresa_id: String(empresaId), eliminado: false } } } } },
        ],
      },
      include: {
        detalles: {
          include: {
            tipoDia: true,
            tipoItem: { include: { unidadItem: true } },
            empleado: { include: { usuario: true } },
            hhEmpleado: true,
            compras: { include: { producto: true, proveedor: true, compra: true } },
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
      return reply.status(400).send({
        error: "Debe enviar al menos un detalle de venta",
      });
    }

    const ventaCreada = await prisma.$transaction(async (tx) => {
      const detallesData = [];

      // helpers
      const contains = (s, sub) =>
        String(s || "")
          .toLowerCase()
          .includes(String(sub).toLowerCase());

      for (const det of detalles) {
        const {
          descripcion: descDetalle,
          cantidad: cantidadRaw,
          tipoItemId,
          compraId, // CompraItem.id
          tipoDiaId,
          alpha: alphaRaw, // ahora es decimal (0.10 = 10%)
          empleadoId,
          hhEmpleadoId,
        } = det;

        if (!descDetalle) {
          throw new Error("Cada detalle debe tener 'descripcion'");
        }

        const cantidad = Number(cantidadRaw) || 1;

        // ✅ alpha = porcentaje decimal (0.10 = 10%)
        const alpha = alphaRaw != null ? Number(alphaRaw) : 0.1;

        // =====================================
        // CARGAR RELACIONES
        // =====================================
        let tipoItem = null;
        let compraItem = null;
        let hhEmpleado = null;
        let tipoDia = null;

        if (tipoItemId) {
          tipoItem = await tx.tipoItem.findUnique({
            where: { id: tipoItemId },
          });
          if (!tipoItem) throw new Error(`tipoItemId inválido: ${tipoItemId}`);
        } else {
          throw new Error(
            "Cada detalle debe seleccionar un Tipo ítem (tipoItemId)"
          );
        }

        if (compraId) {
          compraItem = await tx.compraItem.findUnique({
            where: { id: compraId },
          });
          if (!compraItem) throw new Error(`compraId inválido: ${compraId}`);
        }

        if (hhEmpleadoId) {
          hhEmpleado = await tx.hHEmpleado.findUnique({
            where: { id: hhEmpleadoId },
          });
          if (!hhEmpleado)
            throw new Error(`hhEmpleadoId inválido: ${hhEmpleadoId}`);
        }

        if (tipoDiaId) {
          tipoDia = await tx.tipoDia.findUnique({ where: { id: tipoDiaId } });
          if (!tipoDia) throw new Error(`tipoDiaId inválido: ${tipoDiaId}`);
        }

        // No queremos empleado + compra a la vez
        const usaEmpleado = !!empleadoId && !!hhEmpleado;
        const usaCompra = !!compraId;

        if (usaEmpleado && usaCompra) {
          throw new Error(
            "Un detalle no puede usar al mismo tiempo empleado/HH y detalle de compra"
          );
        }
        if (!usaEmpleado && !usaCompra) {
          throw new Error(
            "Cada detalle debe seleccionar un empleado (con HH) o un detalle de compra"
          );
        }

        // =====================================
        // CÁLCULOS (SEGÚN TU REGLA)
        // =====================================
        let costoHH = null;
        let costoUnitario = 0;
        let costoTotal = 0;
        let ventaUnitario = 0;
        let ventaTotal = 0;

        const gananciaPct = Number(tipoItem?.porcentajeUtilidad ?? 0);

        const tipoDiaNombre = tipoDia?.nombre || "";
        const isFinSemana = contains(tipoDiaNombre, "fin de semana");
        const isUrgente = contains(tipoDiaNombre, "urgente");

        const extraFijo = (isFinSemana ? 200000 : 0) + (isUrgente ? 400000 : 0);

        // --------- CASO 1: HH ---------
        if (usaEmpleado) {
          if (hhEmpleado.costoHH == null) {
            throw new Error(
              `El registro HHEmpleado ${hhEmpleadoId} no tiene costoHH definido`
            );
          }

          costoHH = Number(hhEmpleado.costoHH);
          const cif = Number(hhEmpleado.cif ?? 0); // ✅ float

          // ✅ Costo T HH = costoHH*cantidad + CIF
          costoUnitario = costoHH; // (unit HH "puro")
          costoTotal = costoHH * cantidad + cif;

          // ✅ Venta Un HH = costoHH*(%ganancia/100) + (CIF/cantidad) + extras
          ventaUnitario =
            costoHH * (gananciaPct / 100) + cif / cantidad + extraFijo;

          // ✅ Venta T HH:
          // normal: ventaUn * cant * (1+alpha)
          // fin de semana: ventaUn * cant * (1+%ganancia) * (1+alpha)
          const multGananciaFinSemana = isFinSemana ? 1 + gananciaPct / 100 : 1;
          ventaTotal =
            ventaUnitario * cantidad * multGananciaFinSemana * (1 + alpha);
        }

        // --------- CASO 2: COMPRA / OTRO ---------
        if (usaCompra) {
          if (compraItem.precio_unit != null) {
            costoUnitario = Number(compraItem.precio_unit);
          } else {
            const cantCompra = Number(compraItem.cantidad) || 1;
            costoUnitario = (Number(compraItem.total) || 0) / cantCompra;
          }

          // ✅ Costo T otro = costoUnit*cantidad
          costoTotal = costoUnitario * cantidad;

          // ✅ Venta Un otro = costoUnit*(1+%ganancia)
          ventaUnitario = costoUnitario * (1 + gananciaPct / 100);

          // ✅ Venta T otro = costoT*(1+%ganancia)*(1+alpha)
          ventaTotal = costoTotal * (1 + gananciaPct / 100) * (1 + alpha);
        }

        // ✅ utilidad y %
        const utilidad = ventaTotal - costoTotal;
        const porcentajeUtilidad =
          ventaTotal > 0 ? (utilidad / ventaTotal) * 100 : 0;

        const total = ventaTotal;

        detallesData.push({
          descripcion: descDetalle,
          cantidad,
          tipoItemId: tipoItemId ?? null,
          compraId: compraId ?? null,
          empleadoId: empleadoId ?? null,
          hhEmpleadoId: hhEmpleadoId ?? null,
          tipoDiaId: tipoDiaId ?? null,

          alpha, // ✅ decimal (0.10)
          costoHH,
          costoUnitario,
          costoTotal,
          ventaUnitario,
          ventaTotal,
          utilidad,
          porcentajeUtilidad,
          total,
        });
      }

      // Total de la venta
      const totalVenta = detallesData.reduce(
        (acc, d) => acc + (Number(d.ventaTotal) || 0),
        0
      );

      if (ordenVentaId) {
        const ov = await tx.cotizacion.findUnique({
          where: { id: ordenVentaId },
        });
        if (!ov)
          throw new Error("ordenVentaId inválido (cotización no existe)");
        // ✅ quitamos restricción de estado
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
              compras: { include: { producto: true, proveedor: true } },
              tipoDia: true,
            },
          },
          ordenVenta: { include: { proyecto: true, cliente: true } },
        },
      });

      return { ...nuevaVenta, _totales: { totalVenta } };
    });

    return reply.status(201).send(ventaCreada);
  } catch (error) {
    console.error("Error al crear venta:", error);
    return reply.status(500).send({
      error: "Error al crear venta",
      detalle: error.message,
    });
  }
};
