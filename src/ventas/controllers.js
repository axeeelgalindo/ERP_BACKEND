import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const listVentas = async (request, reply) => {
  try {
    const empresaId = request.headers["x-empresa-id"];
    if (!empresaId) return reply.status(400).send({ error: "Falta x-empresa-id" });

    const ventas = await prisma.venta.findMany({
      where: {
        empresa_id: String(empresaId),
        eliminado: false,
        folio: null,
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

    // ✅ Buscar valores de feriado/urgencia 1 vez (y no por cada venta)
    const findTipoDiaByNames = async (names = []) => {
      const ors = names.map((n) => ({
        nombre: { equals: n, mode: "insensitive" },
      }));

      return prisma.tipoDia.findFirst({
        where: {
          empresa_id: String(empresaId),
          eliminado: false,
          OR: ors,
        },
      });
    };

    const [tipoFeriado, tipoUrgencia] = await Promise.all([
      findTipoDiaByNames(["feriado", "festivo"]),
      findTipoDiaByNames(["urgencia", "urgente"]),
    ]);

    const vFeriado = tipoFeriado ? Number(tipoFeriado.valor || 0) : 0;
    const vUrgencia = tipoUrgencia ? Number(tipoUrgencia.valor || 0) : 0;

    const ventasConTotales = ventas.map((v) => {
      const extraFeriado = v.isFeriado ? vFeriado : 0;
      const extraUrgencia = v.isUrgencia ? vUrgencia : 0;
      const extraVenta = extraFeriado + extraUrgencia;

      const totalBase = (v.detalles || []).reduce(
        (acc, d) => acc + (Number(d.ventaTotal ?? d.total) || 0),
        0,
      );
      const costoBase = (v.detalles || []).reduce(
        (acc, d) => acc + (Number(d.costoTotal) || 0),
        0,
      );

      return {
        ...v,
        extraVenta,
        extraFeriado,
        extraUrgencia,
        totalBase,
        costoBase,
        totalFinal: totalBase + extraVenta,
        costoFinal: costoBase + extraVenta,
      };
    });

    return reply.send(ventasConTotales);
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

    const venta = await prisma.venta.findUnique({
      where: { id },
      include: {
        detalles: {
          include: {
            tipoDia: true,
            tipoItem: { include: { unidadItem: true } },
            empleado: { include: { usuario: true } },
            hhEmpleado: { include: { cif: true } },
            compras: { include: { producto: true, proveedor: true, compra: true } },
          },
        },
        ordenVenta: { include: { proyecto: true, cliente: true } },
      },
    });

    if (!venta) return reply.status(404).send({ error: "Venta no encontrada" });

    // ✅ helper local (mismo criterio que create)
    const findTipoDiaByNames = async (names = []) => {
      const ors = names.map((n) => ({
        nombre: { equals: n, mode: "insensitive" },
      }));

      return prisma.tipoDia.findFirst({
        where: {
          empresa_id: String(empresaId),
          eliminado: false,
          OR: ors,
        },
      });
    };

    const [tipoFeriado, tipoUrgencia] = await Promise.all([
      findTipoDiaByNames(["feriado", "festivo"]),
      findTipoDiaByNames(["urgencia", "urgente"]),
    ]);

    const vFeriado = tipoFeriado ? Number(tipoFeriado.valor || 0) : 0;
    const vUrgencia = tipoUrgencia ? Number(tipoUrgencia.valor || 0) : 0;

    const extraFeriado = venta.isFeriado ? vFeriado : 0;
    const extraUrgencia = venta.isUrgencia ? vUrgencia : 0;
    const extraVenta = extraFeriado + extraUrgencia;

    const totalBase = (venta.detalles || []).reduce(
      (acc, d) => acc + (Number(d.ventaTotal ?? d.total) || 0),
      0,
    );
    const costoBase = (venta.detalles || []).reduce(
      (acc, d) => acc + (Number(d.costoTotal) || 0),
      0,
    );

    return reply.send({
      ...venta,
      extraVenta,
      extraFeriado,
      extraUrgencia,
      totalBase,
      costoBase,
      totalFinal: totalBase + extraVenta,
      costoFinal: costoBase + extraVenta,
    });
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
      utilidadObjetivoBase, // COSTO | VENTA | VENTA_ACTUAL

      // ✅ Extra por costeo (NO por ítem)
      isFeriado = false,
      isUrgencia = false,

      // ✅ NUEVO: descuento general (0-100)
      descuentoPct: descuentoPctGeneralRaw,

      // ✅ NUEVO: moneda
      moneda = "CLP",
    } = request.body || {};

    if (!Array.isArray(detalles) || detalles.length === 0) {
      return reply
        .status(400)
        .send({ error: "Debe enviar al menos un detalle de venta" });
    }

    const empresaId = request.headers["x-empresa-id"];
    if (!empresaId) {
      return reply.status(400).send({ error: "Falta x-empresa-id" });
    }

    const utilidadPct =
      utilidadPctObjetivo == null || utilidadPctObjetivo === ""
        ? null
        : Number(utilidadPctObjetivo);

    // ✅ Normalizar base (evitar "COSTO " o "costo")
    let base = utilidadObjetivoBase
      ? String(utilidadObjetivoBase).trim().toUpperCase()
      : null;

    if (!base) base = "VENTA_ACTUAL";

    if (base !== "COSTO" && base !== "VENTA" && base !== "VENTA_ACTUAL") {
      return reply.status(400).send({
        error: "utilidadObjetivoBase inválido (COSTO | VENTA | VENTA_ACTUAL)",
      });
    }

    // ✅ Margen sobre venta: u debe ser < 100 siempre
    if (utilidadPct != null) {
      if (!Number.isFinite(utilidadPct) || utilidadPct < 0) {
        return reply
          .status(400)
          .send({ error: "utilidadPctObjetivo inválido (>= 0)" });
      }
      if (utilidadPct >= 100) {
        return reply.status(400).send({
          error: "El % utilidad objetivo debe ser < 100 (margen sobre venta)",
        });
      }
    }

    const normalizePct = (v, def = 0) => {
      if (v == null || v === "") return def;
      const n = Number(v);
      if (!Number.isFinite(n)) return def;
      // si viene 0.1 => 10%
      if (n > 0 && n <= 1) return n * 100;
      if (n < 0) return 0;
      return n;
    };

    const normalizeAlphaPct = (v) => normalizePct(v, 10);

    const toNumberOrNull = (v) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const toBool = (v) => v === true || v === "true" || v === 1 || v === "1";

    // ✅ Descuento general normalizado
    const descuentoPctGeneral = normalizePct(descuentoPctGeneralRaw, 0);
    if (descuentoPctGeneral < 0 || descuentoPctGeneral >= 100) {
      return reply.status(400).send({
        error: "descuentoPct (general) inválido. Debe ser 0 <= x < 100",
      });
    }
    const descuentoGeneralMult = 1 - descuentoPctGeneral / 100;

    // ✅ Obtiene valores extra (feriado/urgencia) desde catálogo TipoDia
    async function getExtrasForVenta(prisma, { empresaId, isFeriado, isUrgencia }) {
      if (!empresaId) {
        return { extra: 0, extraFeriado: 0, extraUrgencia: 0 };
      }

      const findTipoDiaByNames = async (names = []) => {
        const ors = names.map((n) => ({
          nombre: { equals: n, mode: "insensitive" },
        }));

        return prisma.tipoDia.findFirst({
          where: {
            empresa_id: String(empresaId),
            eliminado: false,
            OR: ors,
          },
        });
      };

      const [tipoFeriado, tipoUrgencia] = await Promise.all([
        findTipoDiaByNames(["feriado", "festivo"]),
        findTipoDiaByNames(["urgencia", "urgente"]),
      ]);

      const vFeriado = tipoFeriado ? Number(tipoFeriado.valor || 0) : 0;
      const vUrgencia = tipoUrgencia ? Number(tipoUrgencia.valor || 0) : 0;

      return {
        extra: (isFeriado ? vFeriado : 0) + (isUrgencia ? vUrgencia : 0),
        extraFeriado: isFeriado ? vFeriado : 0,
        extraUrgencia: isUrgencia ? vUrgencia : 0,
      };
    }

    const ventaCreada = await prisma.$transaction(async (tx) => {
      const tipoItemHH = await tx.tipoItem.findFirst({
        where: { codigo: "HH" },
      });

      if (!tipoItemHH) {
        throw new Error(
          "Falta el Tipo ítem HH (tipoItem.codigo='HH'). Crea ese registro en el catálogo.",
        );
      }

      const ventaIsFeriado = toBool(isFeriado);
      const ventaIsUrgencia = toBool(isUrgencia);

      // ✅ Extra por costeo (cabecera)
      const extraInfo = await getExtrasForVenta(tx, {
        empresaId: String(empresaId),
        isFeriado: ventaIsFeriado,
        isUrgencia: ventaIsUrgencia,
      });

      const detallesData = [];
      const uniqueProcessedEmployees = new Set();

      for (const det of detalles) {
        const {
          descripcion: descDetalle,
          cantidad: cantidadRaw,
          tipoItemId: tipoItemIdRaw,
          modo: modoRaw,
          compraId,
          costoUnitarioManual,
          tipoDiaId, // UI/histórico
          alpha: alphaRaw,
          empleadoId,
          hhEmpleadoId,

          // ✅ NUEVO: descuento por ítem
          descuentoPct: descuentoPctItemRaw,
        } = det;

        if (!descDetalle) throw new Error("Cada detalle debe tener 'descripcion'");

        const cantidad = (cantidadRaw !== null && cantidadRaw !== undefined && cantidadRaw !== "") ? Number(cantidadRaw) : 1;
        if (cantidad < 0) throw new Error("La cantidad no puede ser negativa");

        const modo = String(modoRaw || "").trim().toUpperCase();
        if (modo !== "HH" && modo !== "COMPRA") {
          throw new Error("Cada detalle debe incluir 'modo' válido: 'HH' o 'COMPRA'");
        }

        const alphaPct = normalizeAlphaPct(alphaRaw);
        const alphaMult = 1 + alphaPct / 100;

        // ✅ descuento por ítem
        const descuentoPctItem = normalizePct(descuentoPctItemRaw, 0);
        if (descuentoPctItem < 0 || descuentoPctItem >= 100) {
          throw new Error(
            `descuentoPct inválido en detalle '${descDetalle}'. Debe ser 0 <= x < 100`,
          );
        }
        const descuentoItemMult = 1 - descuentoPctItem / 100;

        let tipoItem = null;
        let compraItem = null;
        let hhEmpleado = null;

        // Tipo ítem
        if (modo === "HH") {
          tipoItem = tipoItemHH;
        } else {
          if (!tipoItemIdRaw) {
            throw new Error("Cada detalle COMPRA debe seleccionar un Tipo ítem (tipoItemId)");
          }
          tipoItem = await tx.tipoItem.findUnique({ where: { id: tipoItemIdRaw } });
          if (!tipoItem) throw new Error(`tipoItemId inválido: ${tipoItemIdRaw}`);
        }

        // Validar tipoDiaId si viene (solo UI/histórico)
        if (tipoDiaId) {
          const tipoDia = await tx.tipoDia.findUnique({ where: { id: tipoDiaId } });
          if (!tipoDia) throw new Error(`tipoDiaId inválido: ${tipoDiaId}`);
        }

        // HHEmpleado
        if (modo === "HH") {
          if (!empleadoId) throw new Error("HH requiere empleadoId");
          if (!hhEmpleadoId) throw new Error("HH requiere hhEmpleadoId");

          hhEmpleado = await tx.hHEmpleado.findUnique({
            where: { id: hhEmpleadoId },
            include: { cif: true },
          });
          if (!hhEmpleado) throw new Error(`hhEmpleadoId inválido: ${hhEmpleadoId}`);
        }

        // CompraItem
        if (modo === "COMPRA" && compraId) {
          compraItem = await tx.compraItem.findUnique({ where: { id: compraId } });
          if (!compraItem) throw new Error(`compraId inválido: ${compraId}`);
        }

        if (modo === "HH" && compraId) {
          throw new Error("Un detalle HH no puede traer compraId");
        }

        // Validaciones COMPRA
        if (modo === "COMPRA") {
          if (empleadoId || hhEmpleadoId) {
            throw new Error("Un detalle COMPRA no puede traer empleadoId/hhEmpleadoId");
          }

          const manualPU = toNumberOrNull(costoUnitarioManual);
          const tieneCompraVinculada = !!compraItem;
          const tieneManual = manualPU != null && manualPU > 0;

          if (!tieneCompraVinculada && !tieneManual) {
            throw new Error(
              "Detalle COMPRA requiere 'compraId' (vinculada) o 'costoUnitarioManual' (manual)",
            );
          }
        }

        let costoHH = null;
        let costoUnitario = 0;

        let costoTotal = 0;
        let ventaUnitario = 0;
        let ventaTotal = 0;

        // ✅ Extra por ítem eliminado (extra es solo por costeo)
        const extraFijo = 0;

        // base con alpha
        let costoConAlphaBase = 0;
        let cifLine = 0; 

        if (modo === "HH") {
          if (hhEmpleado.costoHH == null) {
            throw new Error(`El registro HHEmpleado ${hhEmpleadoId} no tiene costoHH definido`);
          }

          const costoHHVal = Number(hhEmpleado.costoHH);
          const cifValue = Number(hhEmpleado?.cif?.valor ?? 0);

          let cifToAdd = 0;
          if (!uniqueProcessedEmployees.has(hhEmpleadoId)) {
            uniqueProcessedEmployees.add(hhEmpleadoId);
            cifToAdd = cifValue;
          }

          const costoSinAlpha = cantidad > 0 ? costoHHVal * cantidad : 0;
          costoConAlphaBase = costoSinAlpha * alphaMult;

          costoTotal = costoConAlphaBase + extraFijo;
          ventaTotal = costoConAlphaBase + extraFijo;

          ventaUnitario = cantidad > 0 ? ventaTotal / cantidad : ventaTotal;
          cifLine = cifToAdd; // Store unique CIF impact
        }

        if (modo === "COMPRA") {
          if (compraItem) {
            if (compraItem.precio_unit != null) {
              costoUnitario = Number(compraItem.precio_unit);
            } else {
              const cantCompra = Number(compraItem.cantidad) || 1;
              costoUnitario = (Number(compraItem.total) || 0) / cantCompra;
            }
          } else {
            const manualPU = toNumberOrNull(costoUnitarioManual);
            costoUnitario = manualPU != null ? manualPU : 0;
          }

          const costoSinAlpha = costoUnitario * cantidad;
          costoConAlphaBase = costoSinAlpha * alphaMult;

          costoTotal = costoConAlphaBase + extraFijo;
          ventaTotal = costoConAlphaBase + extraFijo;

          ventaUnitario = cantidad > 0 ? ventaTotal / cantidad : ventaTotal;
        }

        const utilidad = ventaTotal - costoTotal;
        const porcentajeUtilidad = ventaTotal > 0 ? (utilidad / ventaTotal) * 100 : 0;

        detallesData.push({
          descripcion: descDetalle,
          cantidad,
          modo,
          tipoItemId: tipoItem?.id ?? null,

          compraId: modo === "COMPRA" ? (compraId ?? null) : null,
          costoUnitario:
            modo === "COMPRA" && !compraId
              ? (toNumberOrNull(costoUnitarioManual) ?? 0)
              : costoUnitario,

          empleadoId: modo === "HH" ? (empleadoId ?? null) : null,
          hhEmpleadoId: modo === "HH" ? (hhEmpleadoId ?? null) : null,
          costoHH,

          tipoDiaId: tipoDiaId ?? null, // UI/histórico
          alpha: alphaPct,

          // ✅ NUEVO
          descuentoPct: descuentoPctItem,

          costoTotal,
          ventaUnitario,
          ventaTotal,
          ventaTotalBruto: null, // se setea después (post-k)

          utilidad,
          porcentajeUtilidad,
          total: ventaTotal,
        });

        // guardamos para usar post-k (sin ensuciar schema)
        detallesData[detallesData.length - 1]._descuentoItemMult = descuentoItemMult;
        detallesData[detallesData.length - 1]._cifLineUnique = cifLine;
      }

      // totales base (sin extra por costeo)
      const totalCostoTotal = detallesData.reduce((acc, d) => acc + (Number(d.costoTotal) || 0), 0);

      const uPct = utilidadPct != null ? utilidadPct : 0;
      const targetMargin = uPct / 100;
      const marginDivisor = (1 - targetMargin) || 1; // evitar division por cero si uPct=100 (ya validado antes)

      const totalCIFUnique = detallesData.reduce((acc, d) => acc + (Number(d._cifLineUnique) || 0), 0);
      const totalVentaTarget = (totalCostoTotal / marginDivisor) + totalCIFUnique;

      let k = 1;
      if (totalCostoTotal > 0) {
        k = totalVentaTarget / totalCostoTotal;
      }

      // ✅ Aplicar Margen preciso por línea y luego descuentos
      for (const d of detallesData) {
        const costoLineTotal = Number(d.costoTotal || 0);

        const bruto = (costoLineTotal / marginDivisor) + (d._cifLineUnique || 0);
        d.ventaTotalBruto = bruto;

        const itemMult = d._descuentoItemMult ?? 1;
        const neto = bruto * itemMult * descuentoGeneralMult;

        d.ventaTotal = neto;
        d.total = neto;
        d.ventaUnitario = d.cantidad > 0 ? neto / d.cantidad : neto;

        d.utilidad = neto - costoLineTotal;
        d.porcentajeUtilidad = neto > 0 ? (d.utilidad / neto) * 100 : 0;

        // limpiar campos internos
        delete d._descuentoItemMult;
        delete d._cifLineUnique;
      }

      if (ordenVentaId) {
        const ov = await tx.cotizacion.findUnique({ where: { id: ordenVentaId } });
        if (!ov) throw new Error("ordenVentaId inválido (cotización no existe)");
      }

      const baseToSave = base === "VENTA_ACTUAL" ? "VENTA" : base;

      const maxVenta = await tx.venta.findFirst({
        where: { empresa_id: String(empresaId) },
        orderBy: { numero: "desc" },
        select: { numero: true },
      });
      let nextNumero = maxVenta ? maxVenta.numero + 1 : 1;

      // Garantizar unicidad global del número de venta para la empresa
      let exists = true;
      while (exists) {
        const checkExisting = await tx.venta.findFirst({
          where: { empresa_id: String(empresaId), numero: nextNumero },
          select: { id: true },
        });
        if (checkExisting) {
          nextNumero++;
        } else {
          exists = false;
        }
      }

      const nuevaVentaHeader = await tx.venta.create({
        data: {
          empresa_id: String(empresaId),
          numero: nextNumero,
          ordenVentaId: ordenVentaId ?? null,
          descripcion: descripcion ?? null,
          isFeriado: ventaIsFeriado,
          isUrgencia: ventaIsUrgencia,
          utilidadObjetivoBase: utilidadPct == null ? null : baseToSave,
          utilidadObjetivoPct: utilidadPct,
          factorKAplicado: Number.isFinite(k) ? k : null,
          descuentoPct: descuentoPctGeneral,
          moneda,
        },
      });

      // Crear detalles por separado con createMany para permitir IDs escalares (tipoItemId, etc.)
      await tx.detalleVenta.createMany({
        data: detallesData.map(d => ({ ...d, ventaId: nuevaVentaHeader.id }))
      });

      const nuevaVenta = await tx.venta.findUnique({
        where: { id: nuevaVentaHeader.id },
        include: {
          detalles: {
            include: {
              tipoItem: { include: { unidadItem: true } },
              empleado: { include: { usuario: true } },
              compras: {
                include: {
                  producto: true,
                  proveedor: true,
                  compra: true,
                  tipoItem: true,
                },
              },
              tipoDia: true,
              hhEmpleado: { include: { cif: true } },
            },
          },
          ordenVenta: { include: { proyecto: true, cliente: true } },
        },
      });

      // ✅ devolver totales finales
      const totalBase = (nuevaVenta.detalles || []).reduce(
        (acc, d) => acc + (Number(d.ventaTotal ?? d.total) || 0),
        0,
      );
      const totalBaseBruto = (nuevaVenta.detalles || []).reduce(
        (acc, d) => acc + (Number(d.ventaTotalBruto) || 0),
        0,
      );
      const costoBase = (nuevaVenta.detalles || []).reduce(
        (acc, d) => acc + (Number(d.costoTotal) || 0),
        0,
      );

      const extraVentaBruto = Number(extraInfo?.extra || 0);
      // ✅ si quieres que el descuento general afecte el extra, aplica el mismo mult:
      const extraVenta = extraVentaBruto * descuentoGeneralMult;

      return {
        ...nuevaVenta,

        // extras
        extraVenta,
        extraVentaBruto,
        extraFeriado: Number(extraInfo?.extraFeriado || 0),
        extraUrgencia: Number(extraInfo?.extraUrgencia || 0),

        // totales
        totalBase,
        totalBaseBruto,
        costoBase,

        totalFinal: totalBase + extraVenta,
        // ⚠️ tu código antes sumaba extra al costo. Lo dejo igual que tu retorno,
        // pero ojo: extraVenta es "venta", no necesariamente costo real.
        costoFinal: costoBase + extraVenta,
      };
    });

    return reply.status(201).send(ventaCreada);
  } catch (error) {
    console.error("Error al crear venta:", error);
    return reply
      .status(500)
      .send({ error: "Error al crear venta", detalle: error.message });
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
      utilidadObjetivoBase, // COSTO | VENTA | VENTA_ACTUAL

      // ✅ Extra por costeo (NO por ítem)
      isFeriado = false,
      isUrgencia = false,

      // ✅ NUEVO: moneda
      moneda,
    } = request.body || {};

    if (!Array.isArray(detalles) || detalles.length === 0) {
      return reply
        .status(400)
        .send({ error: "Debes enviar al menos 1 ítem en detalles" });
    }

    const empresaId = request.headers["x-empresa-id"];
    if (!empresaId) {
      return reply.status(400).send({ error: "Falta x-empresa-id" });
    }

    const utilidadPct =
      utilidadPctObjetivo == null || utilidadPctObjetivo === ""
        ? null
        : Number(utilidadPctObjetivo);

    // ✅ Normalizar base
    let base = utilidadObjetivoBase
      ? String(utilidadObjetivoBase).trim().toUpperCase()
      : null;

    if (!base) base = "VENTA_ACTUAL";

    if (base !== "COSTO" && base !== "VENTA" && base !== "VENTA_ACTUAL") {
      return reply.status(400).send({
        error: "utilidadObjetivoBase inválido (COSTO | VENTA | VENTA_ACTUAL)",
      });
    }

    // ✅ Margen sobre venta => u < 100 siempre
    if (utilidadPct != null) {
      if (!Number.isFinite(utilidadPct) || utilidadPct < 0) {
        return reply
          .status(400)
          .send({ error: "utilidadPctObjetivo inválido (>= 0)" });
      }
      if (utilidadPct >= 100) {
        return reply.status(400).send({
          error: "El % utilidad objetivo debe ser < 100 (margen sobre venta)",
        });
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

    const toNumberOrNull = (v) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const toBool = (v) => v === true || v === "true" || v === 1 || v === "1";

    // ✅ Obtiene valores extra (feriado/urgencia) desde catálogo TipoDia
    async function getExtrasForVenta(prismaTx, { empresaId, isFeriado, isUrgencia }) {
      if (!empresaId) {
        return { extra: 0, extraFeriado: 0, extraUrgencia: 0 };
      }

      const findTipoDiaByNames = async (names = []) => {
        const ors = names.map((n) => ({
          nombre: { equals: n, mode: "insensitive" },
        }));

        return prismaTx.tipoDia.findFirst({
          where: {
            empresa_id: String(empresaId),
            eliminado: false,
            OR: ors,
          },
        });
      };

      const [tipoFeriado, tipoUrgencia] = await Promise.all([
        findTipoDiaByNames(["feriado", "festivo"]),
        findTipoDiaByNames(["urgencia", "urgente"]),
      ]);

      const vFeriado = tipoFeriado ? Number(tipoFeriado.valor || 0) : 0;
      const vUrgencia = tipoUrgencia ? Number(tipoUrgencia.valor || 0) : 0;

      return {
        extra: (isFeriado ? vFeriado : 0) + (isUrgencia ? vUrgencia : 0),
        extraFeriado: isFeriado ? vFeriado : 0,
        extraUrgencia: isUrgencia ? vUrgencia : 0,
      };
    }

    const ventaActual = await prisma.venta.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!ventaActual)
      return reply.status(404).send({ error: "Venta no encontrada" });

    const updated = await prisma.$transaction(async (tx) => {
      const tipoItemHH = await tx.tipoItem.findFirst({
        where: { codigo: "HH" },
      });
      if (!tipoItemHH) {
        throw new Error(
          "Falta el Tipo ítem HH (tipoItem.codigo='HH'). Crea ese registro en el catálogo.",
        );
      }

      const ventaIsFeriado = toBool(isFeriado);
      const ventaIsUrgencia = toBool(isUrgencia);

      // ✅ Extra por costeo (cabecera)
      const extraInfo = await getExtrasForVenta(tx, {
        empresaId: String(empresaId),
        isFeriado: ventaIsFeriado,
        isUrgencia: ventaIsUrgencia,
      });

      // ✅ validar ordenVentaId si viene
      if (ordenVentaId) {
        const ov = await tx.cotizacion.findUnique({ where: { id: ordenVentaId } });
        if (!ov) throw new Error("ordenVentaId inválido (cotización no existe)");
      }

      const detallesData = [];
      const uniqueProcessedEmployees = new Set();

      for (const det of detalles) {
        const {
          descripcion: descDetalle,
          cantidad: cantidadRaw,
          tipoItemId: tipoItemIdRaw,
          modo: modoRaw,
          compraId,
          costoUnitarioManual,
          tipoDiaId, // 👈 solo UI/histórico
          alpha: alphaRaw,
          empleadoId,
          hhEmpleadoId,
        } = det;

        if (!descDetalle) throw new Error("Cada detalle debe tener 'descripcion'");

        const cantidad = (cantidadRaw !== null && cantidadRaw !== undefined && cantidadRaw !== "") ? Number(cantidadRaw) : 1;
        if (cantidad < 0) throw new Error("La cantidad no puede ser negativa");

        const modo = String(modoRaw || "").trim().toUpperCase();
        if (modo !== "HH" && modo !== "COMPRA") {
          throw new Error("Cada detalle debe incluir 'modo' válido: 'HH' o 'COMPRA'");
        }

        const alphaPct = normalizeAlphaPct(alphaRaw);
        const alphaMult = 1 + alphaPct / 100;

        let tipoItem = null;
        let compraItem = null;
        let hhEmpleado = null;

        // Tipo ítem
        if (modo === "HH") {
          tipoItem = tipoItemHH;
        } else {
          if (!tipoItemIdRaw) {
            throw new Error("Cada detalle COMPRA debe seleccionar un Tipo ítem (tipoItemId)");
          }
          tipoItem = await tx.tipoItem.findUnique({ where: { id: tipoItemIdRaw } });
          if (!tipoItem) throw new Error(`tipoItemId inválido: ${tipoItemIdRaw}`);
        }

        // Validar tipoDiaId si viene (solo para UI/histórico)
        if (tipoDiaId) {
          const tipoDia = await tx.tipoDia.findUnique({ where: { id: tipoDiaId } });
          if (!tipoDia) throw new Error(`tipoDiaId inválido: ${tipoDiaId}`);
        }

        // HHEmpleado
        if (modo === "HH") {
          if (!empleadoId) throw new Error("HH requiere empleadoId");
          if (!hhEmpleadoId) throw new Error("HH requiere hhEmpleadoId");

          hhEmpleado = await tx.hHEmpleado.findUnique({
            where: { id: hhEmpleadoId },
            include: { cif: true },
          });
          if (!hhEmpleado) throw new Error(`hhEmpleadoId inválido: ${hhEmpleadoId}`);
        }

        // CompraItem
        if (modo === "COMPRA" && compraId) {
          compraItem = await tx.compraItem.findUnique({ where: { id: compraId } });
          if (!compraItem) throw new Error(`compraId inválido: ${compraId}`);
        }

        if (modo === "HH" && compraId) {
          throw new Error("Un detalle HH no puede traer compraId");
        }

        // Validaciones COMPRA
        if (modo === "COMPRA") {
          if (empleadoId || hhEmpleadoId) {
            throw new Error("Un detalle COMPRA no puede traer empleadoId/hhEmpleadoId");
          }

          const manualPU = toNumberOrNull(costoUnitarioManual);
          const tieneCompraVinculada = !!compraItem;
          const tieneManual = manualPU != null && manualPU > 0;

          if (!tieneCompraVinculada && !tieneManual) {
            throw new Error(
              "Detalle COMPRA requiere 'compraId' (vinculada) o 'costoUnitarioManual' (manual)",
            );
          }
        }

        let costoHH = null;
        let costoUnitario = 0;

        let costoTotal = 0;
        let ventaUnitario = 0;
        let ventaTotal = 0;

        // ✅ Extra por ítem eliminado: extra SOLO por costeo
        const extraFijo = 0;

        // base con alpha
        let costoConAlphaBase = 0;
        let cifLine = 0; 

        if (modo === "HH") {
          if (hhEmpleado.costoHH == null) {
            throw new Error(
              `El registro HHEmpleado ${hhEmpleadoId} no tiene costoHH definido`,
            );
          }

          const costoHHVal = Number(hhEmpleado.costoHH);
          const cifValue = Number(hhEmpleado?.cif?.valor ?? 0);

          let cifToAdd = 0;
          if (!uniqueProcessedEmployees.has(hhEmpleadoId)) {
            uniqueProcessedEmployees.add(hhEmpleadoId);
            cifToAdd = cifValue;
          }

          const costoSinAlpha = cantidad > 0 ? costoHHVal * cantidad : 0;
          costoConAlphaBase = costoSinAlpha * alphaMult;

          costoTotal = costoConAlphaBase + extraFijo;
          ventaTotal = costoConAlphaBase + extraFijo;

          ventaUnitario = cantidad > 0 ? ventaTotal / cantidad : ventaTotal;
          cifLine = cifToAdd; // Store unique CIF impact
        }

        if (modo === "COMPRA") {
          if (compraItem) {
            if (compraItem.precio_unit != null) {
              costoUnitario = Number(compraItem.precio_unit);
            } else {
              const cantCompra = Number(compraItem.cantidad) || 1;
              costoUnitario = (Number(compraItem.total) || 0) / cantCompra;
            }
          } else {
            const manualPU = toNumberOrNull(costoUnitarioManual);
            costoUnitario = manualPU != null ? manualPU : 0;
          }

          const costoSinAlpha = costoUnitario * cantidad;
          costoConAlphaBase = costoSinAlpha * alphaMult;

          costoTotal = costoConAlphaBase + extraFijo;
          ventaTotal = costoConAlphaBase + extraFijo;

          ventaUnitario = cantidad > 0 ? ventaTotal / cantidad : ventaTotal;
        }

        const utilidad = ventaTotal - costoTotal;
        const porcentajeUtilidad = ventaTotal > 0 ? (utilidad / ventaTotal) * 100 : 0;

        detallesData.push({
          descripcion: descDetalle,
          cantidad,
          modo,
          tipoItemId: tipoItem?.id ?? null,

          compraId: modo === "COMPRA" ? (compraId ?? null) : null,
          costoUnitario:
            modo === "COMPRA" && !compraId
              ? (toNumberOrNull(costoUnitarioManual) ?? 0)
              : costoUnitario,

          empleadoId: modo === "HH" ? (empleadoId ?? null) : null,
          hhEmpleadoId: modo === "HH" ? (hhEmpleadoId ?? null) : null,
          costoHH,

          tipoDiaId: tipoDiaId ?? null, // solo UI/histórico
          alpha: alphaPct,

          costoTotal,
          ventaUnitario,
          ventaTotal,
          utilidad,
          porcentajeUtilidad,
          total: ventaTotal,
        });

        // guardamos para usar post-k
        detallesData[detallesData.length - 1]._cifLineUnique = cifLine;
      }

      // totales base (sin extra por costeo)
      const totalCostoTotal = detallesData.reduce((acc, d) => acc + (Number(d.costoTotal) || 0), 0);

      const uPct = utilidadPct != null ? utilidadPct : 0;
      const targetMargin = uPct / 100;
      const marginDivisor = (1 - targetMargin) || 1;

      const totalCIFUnique = detallesData.reduce((acc, d) => acc + (Number(d._cifLineUnique) || 0), 0);
      const totalVentaTarget = (totalCostoTotal / marginDivisor) + totalCIFUnique;

      let k = 1;
      if (totalCostoTotal > 0) {
        k = totalVentaTarget / totalCostoTotal;
      }

      // ✅ Aplicar Margen preciso por línea
      for (const d of detallesData) {
        const costoLineTotal = Number(d.costoTotal || 0);

        const bruto = (costoLineTotal / marginDivisor) + (d._cifLineUnique || 0);
        d.ventaTotalBruto = bruto;

        const neto = bruto; 
        d.ventaTotal = neto;
        d.total = neto;
        d.ventaUnitario = d.cantidad > 0 ? neto / d.cantidad : neto;

        d.utilidad = neto - costoLineTotal;
        d.porcentajeUtilidad = neto > 0 ? (d.utilidad / neto) * 100 : 0;

        delete d._cifLineUnique;
      }

      // guardamos base: VENTA_ACTUAL se persiste como VENTA
      const baseToSave = base === "VENTA_ACTUAL" ? "VENTA" : base;

      // update cabecera (incluye flags)
      await tx.venta.update({
        where: { id },
        data: {
          ordenVentaId,
          descripcion,

          isFeriado: ventaIsFeriado,
          isUrgencia: ventaIsUrgencia,

          utilidadObjetivoBase: utilidadPct == null ? null : baseToSave,
          utilidadObjetivoPct: utilidadPct,
          factorKAplicado: Number.isFinite(k) ? k : null,
          ...(moneda ? { moneda } : {}),
        },
      });

      // reemplazo total de detalles
      await tx.detalleVenta.deleteMany({ where: { ventaId: id } });

      await tx.detalleVenta.createMany({
        data: detallesData.map((d) => ({ ...d, ventaId: id })),
      });

      // devolver venta completa
      const nuevaVenta = await tx.venta.findUnique({
        where: { id },
        include: {
          ordenVenta: { include: { proyecto: true, cliente: true } },
          detalles: {
            include: {
              tipoDia: true,
              tipoItem: { include: { unidadItem: true } },
              empleado: { include: { usuario: true } },
              hhEmpleado: { include: { cif: true } },
              compras: {
                include: { producto: true, proveedor: true, compra: true, tipoItem: true },
              },
            },
          },
        },
      });

      // ✅ devolver totales finales (base + extra costeo)
      const totalBase = (nuevaVenta?.detalles || []).reduce(
        (acc, d) => acc + (Number(d.ventaTotal ?? d.total) || 0),
        0,
      );
      const costoBase = (nuevaVenta?.detalles || []).reduce(
        (acc, d) => acc + (Number(d.costoTotal) || 0),
        0,
      );

      const extraVenta = Number(extraInfo?.extra || 0);

      return {
        ...nuevaVenta,
        extraVenta,
        extraFeriado: Number(extraInfo?.extraFeriado || 0),
        extraUrgencia: Number(extraInfo?.extraUrgencia || 0),
        totalBase,
        costoBase,
        totalFinal: totalBase + extraVenta,
        costoFinal: costoBase + extraVenta,
      };
    });

    return reply.send(updated);
  } catch (err) {
    console.error(err);
    return reply
      .status(500)
      .send({ error: "Error actualizando venta", detalle: err?.message });
  }
}

export const disableVenta = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!id) return reply.status(400).send({ error: "Falta id" });

    const empresaId = request.headers["x-empresa-id"];
    if (!empresaId)
      return reply.status(400).send({ error: "Falta x-empresa-id" });

    // Verifica existencia (y que pertenezca a la empresa por alguna relación)
    const venta = await prisma.venta.findUnique({
      where: { id },
      include: {
        ordenVenta: { select: { empresa_id: true, eliminado: true } },
        detalles: {
          select: {
            id: true,
            hhEmpleado: { select: { empresa_id: true } },
            compras: {
              select: {
                compra: { select: { empresa_id: true, eliminado: true } },
              },
            },
          },
        },
      },
    });

    if (!venta) return reply.status(404).send({ error: "Venta no encontrada" });

    const belongs =
      (venta.ordenVenta?.empresa_id &&
        String(venta.ordenVenta.empresa_id) === String(empresaId)) ||
      venta.detalles?.some(
        (d) =>
          d.hhEmpleado?.empresa_id &&
          String(d.hhEmpleado.empresa_id) === String(empresaId),
      ) ||
      venta.detalles?.some(
        (d) =>
          d.compras?.compra?.empresa_id &&
          String(d.compras.compra.empresa_id) === String(empresaId),
      );

    // Si quieres dejarlo activo cuando estés listo:
    // if (!belongs) return reply.status(403).send({ error: "No autorizado para esta empresa" });

    const now = new Date();

    // ✅ Transacción: deshabilita venta + deshabilita sus detalles
    const updated = await prisma.$transaction(async (tx) => {
      const v = await tx.venta.update({
        where: { id },
        data: {
          eliminado: true,
          eliminado_en: now, // ✅ correcto (según tu schema)
        },
      });

      // opcional pero recomendado para que todo quede consistente
      await tx.detalleVenta.updateMany({
        where: { ventaId: id },
        data: {
          eliminado: true,
          eliminado_en: now,
        },
      });

      return v;
    });

    return reply.send({ ok: true, venta: updated });
  } catch (err) {
    console.error(err);
    return reply
      .status(500)
      .send({ error: "Error deshabilitando venta", detalle: err?.message });
  }
};

export const deleteVenta = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!id) return reply.status(400).send({ error: "Falta id" });

    const empresaId = request.headers["x-empresa-id"];
    if (!empresaId)
      return reply.status(400).send({ error: "Falta x-empresa-id" });

    const force = String(request.query?.force || "").toLowerCase() === "true";

    const venta = await prisma.venta.findUnique({
      where: { id },
      include: {
        ordenVenta: { select: { empresa_id: true, eliminado: true } },
        detalles: {
          select: {
            id: true,
            hhEmpleado: { select: { empresa_id: true } },
            compras: {
              select: {
                compra: { select: { empresa_id: true, eliminado: true } },
              },
            },
          },
        },
      },
    });

    if (!venta) return reply.status(404).send({ error: "Venta no encontrada" });

    const belongs =
      (venta.ordenVenta?.empresa_id &&
        String(venta.ordenVenta.empresa_id) === String(empresaId)) ||
      venta.detalles?.some(
        (d) =>
          d.hhEmpleado?.empresa_id &&
          String(d.hhEmpleado.empresa_id) === String(empresaId),
      ) ||
      venta.detalles?.some(
        (d) =>
          d.compras?.compra?.empresa_id &&
          String(d.compras.compra.empresa_id) === String(empresaId),
      );

    // Regla simple:
    // - si NO force: solo marca eliminado (soft delete) para evitar cagazos
    if (!force) {
      const updated = await prisma.venta.update({
        where: { id },
        data: { eliminado: true, eliminadoAt: new Date() },
      });
      return reply.send({
        ok: true,
        softDeleted: true,
        message:
          "Venta deshabilitada (usa ?force=true para eliminar definitivamente).",
        venta: updated,
      });
    }

    // force=true => borrar en cascada manual (según tu schema)
    // Si tienes relations con onDelete: Cascade, puedes simplificar,
    // pero aquí lo dejo seguro:
    await prisma.$transaction(async (tx) => {
      // si DetalleVenta tiene dependencias, bórralas primero acá
      await tx.detalleVenta.deleteMany({ where: { ventaId: id } });
      await tx.venta.delete({ where: { id } });
    });

    return reply.send({ ok: true, deleted: true });
  } catch (err) {
    console.error(err);
    return reply
      .status(500)
      .send({ error: "Error eliminando venta", detalle: err?.message });
  }
};
