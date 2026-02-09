import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const listVentas = async (request, reply) => {
  try {
    const empresaId = request.headers["x-empresa-id"];
    if (!empresaId) return reply.status(400).send({ error: "Falta x-empresa-id" });

    const ventas = await prisma.venta.findMany({
      where: {
        OR: [
          // 1) Por OV/Cotización
          { ordenVenta: { empresa_id: String(empresaId), eliminado: false } },

          // 2) Por HHEmpleado (empresa)
          { detalles: { some: { hhEmpleado: { empresa_id: String(empresaId) } } } },

          // 3) Por compraItem -> compra -> empresa
          {
            detalles: {
              some: {
                compras: { compra: { empresa_id: String(empresaId), eliminado: false } },
              },
            },
          },

          // ✅ 4) Ventas “manuales / huérfanas”: sin OV y sin vínculos
          // (si tu sistema es solo para tu empresa, esto es válido)
          {
            AND: [
              { ordenVentaId: null },
              { detalles: { every: { hhEmpleadoId: null } } },
              { detalles: { every: { compraId: null } } },
            ],
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: {
        detalles: {
          include: {
            tipoDia: true,
            hhEmpleado: { include: { cif: true } },
            empleado: { include: { usuario: true } },
            tipoItem: { include: { unidadItem: true } },
            compras: { include: { producto: true, proveedor: true, compra: true } },
          },
        },
        ordenVenta: { include: { proyecto: true, cliente: true } },
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
    const { id } = request.params;
    if (!id) return reply.status(400).send({ error: "ID de venta es requerido" });

    const venta = await prisma.venta.findUnique({
      where: { id },
      include: {
        detalles: {
          include: {
            tipoDia: true,
            tipoItem: { include: { unidadItem: true } },
            empleado: { include: { usuario: true } },
            hhEmpleado: {
              include: { cif: true }, // <-- ajusta si tu relación se llama distinto
            },
            compras: { include: { producto: true, proveedor: true, compra: true } },
          },
        },
        ordenVenta: { include: { proyecto: true, cliente: true } },
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
    const {
      ordenVentaId,
      descripcion,
      detalles = [],
      utilidadPctObjetivo,
      utilidadObjetivoBase,
    } = request.body || {};

    if (!Array.isArray(detalles) || detalles.length === 0) {
      return reply.status(400).send({ error: "Debe enviar al menos un detalle de venta" });
    }

    const utilidadPct =
      utilidadPctObjetivo == null || utilidadPctObjetivo === ""
        ? null
        : Number(utilidadPctObjetivo);

    let base = utilidadObjetivoBase ? String(utilidadObjetivoBase).toUpperCase() : null;

    if (!base) {
      if (utilidadPct != null && Number.isFinite(utilidadPct) && utilidadPct >= 100) base = "COSTO";
      else base = "VENTA";
    }

    if (base !== "COSTO" && base !== "VENTA") {
      return reply.status(400).send({ error: "utilidadObjetivoBase inválido (COSTO | VENTA)" });
    }

    if (utilidadPct != null) {
      if (!Number.isFinite(utilidadPct) || utilidadPct < 0) {
        return reply.status(400).send({ error: "utilidadPctObjetivo inválido (>= 0)" });
      }
      if (base === "VENTA" && utilidadPct >= 100) {
        return reply.status(400).send({ error: "En base VENTA el % debe ser < 100" });
      }
    }

    const normalizeAlphaPct = (v) => {
      if (v == null || v === "") return 10;
      const n = Number(v);
      if (!Number.isFinite(n)) return 10;
      if (n > 0 && n <= 1) return n * 100;
      if (n < 0) return 0;
      return n;
    };

    const ventaCreada = await prisma.$transaction(async (tx) => {
      const tipoItemHH = await tx.tipoItem.findFirst({ where: { codigo: "HH" } });
      if (!tipoItemHH) {
        throw new Error(
          "Falta el Tipo ítem HH (tipoItem.codigo='HH'). Crea ese registro en el catálogo."
        );
      }

      const detallesData = [];

      for (const det of detalles) {
        const {
          descripcion: descDetalle,
          cantidad: cantidadRaw,
          tipoItemId: tipoItemIdRaw,
          modo: modoRaw,
          compraId,
          costoUnitarioManual,
          tipoDiaId,
          alpha: alphaRaw,
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

        const alphaPct = normalizeAlphaPct(alphaRaw);
        const alphaMult = 1 + alphaPct / 100;

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

          // ✅ cambio clave: include cif
          hhEmpleado = await tx.hHEmpleado.findUnique({
            where: { id: hhEmpleadoId },
            include: { cif: true }, // <-- importante
          });

          if (!hhEmpleado) throw new Error(`hhEmpleadoId inválido: ${hhEmpleadoId}`);
        }

        if (modo === "COMPRA" && compraId) {
          compraItem = await tx.compraItem.findUnique({ where: { id: compraId } });
          if (!compraItem) throw new Error(`compraId inválido: ${compraId}`);
        }

        if (modo === "HH" && compraId) throw new Error("Un detalle HH no puede traer compraId");

        if (modo === "COMPRA") {
          if (empleadoId || hhEmpleadoId) {
            throw new Error("Un detalle COMPRA no puede traer empleadoId/hhEmpleadoId");
          }

          const manualPU = costoUnitarioManual != null ? Number(costoUnitarioManual) : null;
          const tieneCompraVinculada = !!compraItem;
          const tieneManual = manualPU != null && Number.isFinite(manualPU) && manualPU > 0;

          if (!tieneCompraVinculada && !tieneManual) {
            throw new Error(
              "Detalle COMPRA requiere 'compraId' (vinculada) o 'costoUnitarioManual' (manual)"
            );
          }
        }

        let costoHH = null;
        let costoUnitario = 0;
        let costoTotal = 0;
        let ventaUnitario = 0;
        let ventaTotal = 0;

        const extraFijo = tipoDia ? Number(tipoDia.valor ?? 0) : 0;

        if (modo === "HH") {
          if (hhEmpleado.costoHH == null) {
            throw new Error(`El registro HHEmpleado ${hhEmpleadoId} no tiene costoHH definido`);
          }

          costoHH = Number(hhEmpleado.costoHH);

          // ✅ cambio clave: leer cif.valor (no hhEmpleado.cif directo)
          const cif = Number(hhEmpleado?.cif?.valor ?? 0);

          costoUnitario = costoHH;
          costoTotal = costoHH * cantidad + cif;

          const ventaBase = costoTotal + extraFijo;
          ventaTotal = ventaBase * alphaMult;
          ventaUnitario = cantidad > 0 ? ventaBase / cantidad : ventaBase;
        }

        if (modo === "COMPRA") {
          if (compraItem) {
            if (compraItem.precio_unit != null) costoUnitario = Number(compraItem.precio_unit);
            else {
              const cantCompra = Number(compraItem.cantidad) || 1;
              costoUnitario = (Number(compraItem.total) || 0) / cantCompra;
            }
          } else {
            costoUnitario = Number(costoUnitarioManual);
          }

          costoTotal = costoUnitario * cantidad;

          const ventaBase = costoTotal + extraFijo;
          ventaTotal = ventaBase * alphaMult;
          ventaUnitario = cantidad > 0 ? ventaBase / cantidad : ventaBase;
        }

        const utilidad = ventaTotal - costoTotal;
        const porcentajeUtilidad = ventaTotal > 0 ? (utilidad / ventaTotal) * 100 : 0;

        detallesData.push({
          descripcion: descDetalle,
          cantidad,
          modo,

          tipoItemId: tipoItem?.id ?? null,

          compraId: modo === "COMPRA" ? compraId ?? null : null,
          costoUnitario: modo === "COMPRA" && !compraId ? Number(costoUnitarioManual) : costoUnitario,

          empleadoId: modo === "HH" ? empleadoId ?? null : null,
          hhEmpleadoId: modo === "HH" ? hhEmpleadoId ?? null : null,
          costoHH,

          tipoDiaId: tipoDiaId ?? null,
          alpha: alphaPct,

          costoTotal,
          ventaUnitario,
          ventaTotal,
          utilidad,
          porcentajeUtilidad,
          total: ventaTotal,
        });
      }

      const totalCosto = detallesData.reduce((acc, d) => acc + (Number(d.costoTotal) || 0), 0);
      const totalVentaActual = detallesData.reduce((acc, d) => acc + (Number(d.ventaTotal) || 0), 0);

      let k = 1;

      if (utilidadPct != null && totalVentaActual > 0) {
        let ventaObjetivo = null;

        if (base === "COSTO") ventaObjetivo = totalCosto * (1 + utilidadPct / 100);
        else {
          const denom = 1 - utilidadPct / 100;
          ventaObjetivo = denom > 0 ? totalCosto / denom : null;
        }

        if (ventaObjetivo != null && Number.isFinite(ventaObjetivo) && ventaObjetivo > 0) {
          k = ventaObjetivo / totalVentaActual;
        }
      }

      if (k !== 1 && Number.isFinite(k)) {
        for (const d of detallesData) {
          d.ventaTotal = Number(d.ventaTotal || 0) * k;
          d.total = d.ventaTotal;
          d.ventaUnitario = d.cantidad > 0 ? d.ventaTotal / d.cantidad : d.ventaTotal;
          d.utilidad = d.ventaTotal - Number(d.costoTotal || 0);
          d.porcentajeUtilidad = d.ventaTotal > 0 ? (d.utilidad / d.ventaTotal) * 100 : 0;
        }
      }

      if (ordenVentaId) {
        const ov = await tx.cotizacion.findUnique({ where: { id: ordenVentaId } });
        if (!ov) throw new Error("ordenVentaId inválido (cotización no existe)");
      }

      const nuevaVenta = await tx.venta.create({
        data: {
          ordenVentaId: ordenVentaId ?? null,
          descripcion: descripcion ?? null,

          utilidadObjetivoBase: utilidadPct == null ? null : base,
          utilidadObjetivoPct: utilidadPct,
          factorKAplicado: Number.isFinite(k) ? k : null,

          detalles: { create: detallesData },
        },
        include: {
          detalles: {
            include: {
              tipoItem: { include: { unidadItem: true } },
              empleado: { include: { usuario: true } },
              compras: { include: { producto: true, proveedor: true, compra: true, tipoItem: true } },
              tipoDia: true,
              // ✅ opcional: para que al crear devuelva HH con cif también
              hhEmpleado: { include: { cif: true } },
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


export async function updateVenta(request, reply) {
  try {
    const { id } = request.params;
    if (!id) return reply.status(400).send({ error: "Falta id" });

    const {
      ordenVentaId = null,
      descripcion = null,
      detalles = [],
      utilidadPctObjetivo,
      utilidadObjetivoBase,
    } = request.body || {};

    if (!Array.isArray(detalles) || detalles.length === 0) {
      return reply.status(400).send({ error: "Debes enviar al menos 1 ítem en detalles" });
    }

    // =========================
    // normalización base + validación (igual que createVenta)
    // =========================
    const utilidadPct =
      utilidadPctObjetivo == null || utilidadPctObjetivo === ""
        ? null
        : Number(utilidadPctObjetivo);

    let base = utilidadObjetivoBase ? String(utilidadObjetivoBase).toUpperCase() : null;

    if (!base) {
      if (utilidadPct != null && Number.isFinite(utilidadPct) && utilidadPct >= 100) base = "COSTO";
      else base = "VENTA";
    }

    if (base !== "COSTO" && base !== "VENTA") {
      return reply.status(400).send({ error: "utilidadObjetivoBase inválido (COSTO | VENTA)" });
    }

    if (utilidadPct != null) {
      if (!Number.isFinite(utilidadPct) || utilidadPct < 0) {
        return reply.status(400).send({ error: "utilidadPctObjetivo inválido (>= 0)" });
      }
      if (base === "VENTA" && utilidadPct >= 100) {
        return reply.status(400).send({ error: "En base VENTA el % debe ser < 100" });
      }
    }

    const normalizeAlphaPct = (v) => {
      if (v == null || v === "") return 10;
      const n = Number(v);
      if (!Number.isFinite(n)) return 10;
      if (n > 0 && n <= 1) return n * 100;
      if (n < 0) return 0;
      return n;
    };

    const ventaActual = await prisma.venta.findUnique({ where: { id }, select: { id: true } });
    if (!ventaActual) return reply.status(404).send({ error: "Venta no encontrada" });

    const updated = await prisma.$transaction(async (tx) => {
      // TipoItem HH forzado
      const tipoItemHH = await tx.tipoItem.findFirst({ where: { codigo: "HH" } });
      if (!tipoItemHH) throw new Error("Falta el Tipo ítem HH (tipoItem.codigo='HH').");

      const detallesData = [];

      for (const det of detalles) {
        const {
          descripcion: descDetalle,
          cantidad: cantidadRaw,
          tipoItemId: tipoItemIdRaw,
          modo: modoRaw,
          compraId,
          costoUnitarioManual,
          tipoDiaId,
          alpha: alphaRaw,
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

        const alphaPct = normalizeAlphaPct(alphaRaw);
        const alphaMult = 1 + alphaPct / 100;

        let tipoItem = null;
        let compraItem = null;
        let hhEmpleado = null;
        let tipoDia = null;

        if (modo === "HH") {
          tipoItem = tipoItemHH;
        } else {
          if (!tipoItemIdRaw) throw new Error("Detalle COMPRA requiere tipoItemId");
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

          hhEmpleado = await tx.hHEmpleado.findUnique({
            where: { id: hhEmpleadoId },
            include: { cif: true }, // <-- clave para que CIF exista (ajusta si se llama distinto)
          });
          if (!hhEmpleado) throw new Error(`hhEmpleadoId inválido: ${hhEmpleadoId}`);
        }

        if (modo === "COMPRA" && compraId) {
          compraItem = await tx.compraItem.findUnique({ where: { id: compraId } });
          if (!compraItem) throw new Error(`compraId inválido: ${compraId}`);
        }

        if (modo === "HH" && compraId) throw new Error("Un detalle HH no puede traer compraId");

        if (modo === "COMPRA") {
          if (empleadoId || hhEmpleadoId) throw new Error("Detalle COMPRA no puede traer empleadoId/hhEmpleadoId");

          const manualPU = costoUnitarioManual != null ? Number(costoUnitarioManual) : null;
          const tieneCompraVinculada = !!compraItem;
          const tieneManual = manualPU != null && Number.isFinite(manualPU) && manualPU > 0;

          if (!tieneCompraVinculada && !tieneManual) {
            throw new Error("Detalle COMPRA requiere 'compraId' o 'costoUnitarioManual'");
          }
        }

        // ===== cálculos (idénticos a createVenta, pero con CIF real)
        let costoHH = null;
        let costoUnitario = 0;
        let costoTotal = 0;
        let ventaUnitario = 0;
        let ventaTotal = 0;

        const extraFijo = tipoDia ? Number(tipoDia.valor ?? 0) : 0;

        if (modo === "HH") {
          if (hhEmpleado.costoHH == null) throw new Error(`HHEmpleado ${hhEmpleadoId} no tiene costoHH`);

          costoHH = Number(hhEmpleado.costoHH);

          const cif = Number(hhEmpleado?.cif?.valor ?? 0); // <-- aquí calza con el modal
          costoUnitario = costoHH;
          costoTotal = costoHH * cantidad + cif;

          const ventaBase = costoTotal + extraFijo;
          ventaTotal = ventaBase * alphaMult;
          ventaUnitario = cantidad > 0 ? ventaBase / cantidad : ventaBase;
        }

        if (modo === "COMPRA") {
          if (compraItem) {
            if (compraItem.precio_unit != null) costoUnitario = Number(compraItem.precio_unit);
            else {
              const cantCompra = Number(compraItem.cantidad) || 1;
              costoUnitario = (Number(compraItem.total) || 0) / cantCompra;
            }
          } else {
            costoUnitario = Number(costoUnitarioManual);
          }

          costoTotal = costoUnitario * cantidad;

          const ventaBase = costoTotal + extraFijo;
          ventaTotal = ventaBase * alphaMult;
          ventaUnitario = cantidad > 0 ? ventaBase / cantidad : ventaBase;
        }

        const utilidad = ventaTotal - costoTotal;
        const porcentajeUtilidad = ventaTotal > 0 ? (utilidad / ventaTotal) * 100 : 0;

        detallesData.push({
          descripcion: descDetalle,
          cantidad,
          modo,
          tipoItemId: tipoItem?.id ?? null,
          compraId: modo === "COMPRA" ? compraId ?? null : null,
          costoUnitario: modo === "COMPRA" && !compraId ? Number(costoUnitarioManual) : costoUnitario,
          empleadoId: modo === "HH" ? empleadoId ?? null : null,
          hhEmpleadoId: modo === "HH" ? hhEmpleadoId ?? null : null,
          costoHH,
          tipoDiaId: tipoDiaId ?? null,
          alpha: alphaPct,
          costoTotal,
          ventaUnitario,
          ventaTotal,
          utilidad,
          porcentajeUtilidad,
          total: ventaTotal, // <-- esto evita tu error
        });
      }

      // ===== aplicar utilidad global con factor k (igual que createVenta)
      const totalCosto = detallesData.reduce((acc, d) => acc + (Number(d.costoTotal) || 0), 0);
      const totalVentaActual = detallesData.reduce((acc, d) => acc + (Number(d.ventaTotal) || 0), 0);

      let k = 1;

      if (utilidadPct != null && totalVentaActual > 0) {
        let ventaObjetivo = null;

        if (base === "COSTO") ventaObjetivo = totalCosto * (1 + utilidadPct / 100);
        else {
          const denom = 1 - utilidadPct / 100;
          ventaObjetivo = denom > 0 ? totalCosto / denom : null;
        }

        if (ventaObjetivo != null && Number.isFinite(ventaObjetivo) && ventaObjetivo > 0) {
          k = ventaObjetivo / totalVentaActual;
        }
      }

      if (k !== 1 && Number.isFinite(k)) {
        for (const d of detallesData) {
          d.ventaTotal = Number(d.ventaTotal || 0) * k;
          d.total = d.ventaTotal;
          d.ventaUnitario = d.cantidad > 0 ? d.ventaTotal / d.cantidad : d.ventaTotal;
          d.utilidad = d.ventaTotal - Number(d.costoTotal || 0);
          d.porcentajeUtilidad = d.ventaTotal > 0 ? (d.utilidad / d.ventaTotal) * 100 : 0;
        }
      }

      // update cabecera
      await tx.venta.update({
        where: { id },
        data: {
          ordenVentaId,
          descripcion,
          utilidadObjetivoBase: utilidadPct == null ? null : base,
          utilidadObjetivoPct: utilidadPct,
          factorKAplicado: Number.isFinite(k) ? k : null,
        },
      });

      // reemplazo total de detalles
      await tx.detalleVenta.deleteMany({ where: { ventaId: id } });

      await tx.detalleVenta.createMany({ data: detallesData.map(d => ({ ...d, ventaId: id })) });

      // devolver venta completa
      return tx.venta.findUnique({
        where: { id },
        include: {
          ordenVenta: { include: { proyecto: true, cliente: true } },
          detalles: {
            include: {
              tipoDia: true,
              tipoItem: { include: { unidadItem: true } },
              empleado: { include: { usuario: true } },
              hhEmpleado: { include: { cif: true } },
              compras: { include: { producto: true, proveedor: true, compra: true } },
            },
          },
        },
      });
    });

    return reply.send(updated);
  } catch (err) {
    console.error(err);
    return reply.status(500).send({ error: "Error actualizando venta", detalle: err?.message });
  }
}

