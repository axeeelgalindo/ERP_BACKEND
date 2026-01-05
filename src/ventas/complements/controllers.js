//ventas/complements/controllers.js
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();


/* =========================
   TIPO DIA
   ========================= */
export const createTipoDia = async (request, reply) => {
  try {
    const { nombre, valor } = request.body || {};

    if (!nombre) {
      return reply
        .status(400)
        .send({ error: "El campo 'nombre' es obligatorio" });
    }

    const valorNum = valor != null ? Number(valor) : 0;

    const nuevoTipoDia = await prisma.tipoDia.create({
      data: { nombre, valor: valorNum },
    });

    return reply.status(201).send(nuevoTipoDia);
  } catch (error) {
    console.error("Error al crear tipoDia:", error);
    return reply.status(500).send({
      error: "Error al crear tipoDia",
      detalle: error.message,
    });
  }
};

export const getTipoDias = async (request, reply) => {
  try {
    const tipoDias = await prisma.tipoDia.findMany();
    return reply.status(200).send(tipoDias);
  } catch (error) {
    console.error("Error al obtener tipoDias:", error);
    return reply.status(500).send({
      error: "Error al obtener tipoDias",
      detalle: error.message,
    });
  }
};

/* =========================
   UNIDAD ITEM
   ========================= */
export const createUnidadItem = async (request, reply) => {
  try {
    const { nombre } = request.body || {};

    if (!nombre) {
      return reply
        .status(400)
        .send({ error: "El campo 'nombre' es obligatorio" });
    }

    const unidad = await prisma.unidadItem.create({ data: { nombre } });
    return reply.status(201).send(unidad);
  } catch (error) {
    console.error("Error al crear unidadItem:", error);
    return reply.status(500).send({
      error: "Error al crear unidadItem",
      detalle: error.message,
    });
  }
};

export const getUnidadItems = async (request, reply) => {
  try {
    const unidades = await prisma.unidadItem.findMany();
    return reply.status(200).send(unidades);
  } catch (error) {
    console.error("Error al obtener unidadItems:", error);
    return reply.status(500).send({
      error: "Error al obtener unidadItems",
      detalle: error.message,
    });
  }
};

/* =========================
   TIPO ITEM
   ========================= */
export const createTipoItem = async (request, reply) => {
  try {
    const { nombre, porcentajeUtilidad, unidadItemId } = request.body || {};

    if (!nombre) {
      return reply
        .status(400)
        .send({ error: "El campo 'nombre' es obligatorio" });
    }

    const porcentajeNum =
      porcentajeUtilidad != null ? Number(porcentajeUtilidad) : 0;

    const tipoItem = await prisma.tipoItem.create({
      data: {
        nombre,
        porcentajeUtilidad: porcentajeNum,
        unidadItemId: unidadItemId || null,
      },
    });

    return reply.status(201).send(tipoItem);
  } catch (error) {
    console.error("Error al crear tipoItem:", error);
    return reply.status(500).send({
      error: "Error al crear tipoItem",
      detalle: error.message,
    });
  }
};

export const getTipoItems = async (request, reply) => {
  try {
    const tipos = await prisma.tipoItem.findMany({
      include: { unidadItem: true },
    });
    return reply.status(200).send(tipos);
  } catch (error) {
    console.error("Error al obtener tipoItems:", error);
    return reply.status(500).send({
      error: "Error al obtener tipoItems",
      detalle: error.message,
    });
  }
};

/* =========================
   CATALOGOS PARA VENTAS
   ========================= */

/**
 * GET /ventas/empleados
 * - Usa x-empresa-id (o ?empresa_id)
 *
 * IMPORTANTE:
 * - Si tu modelo Empleado tiene empresa_id propio, usa where: { empresa_id: ... }
 * - Si NO lo tiene y depende del usuario, usa where: { usuario: { empresa_id: ... } }
 *
 * Para no adivinar, lo dejo “dual”:
 *   - primero intenta filtrar por empleado.empresa_id si existe (vía OR)
 *   - si no existe en tu schema, Prisma te va a avisar => ahí dejas SOLO el filtro usuario.
 */
export const listEmpleadosForVentas = async (request, reply) => {
  try {
    const empresaId =
      request.headers["x-empresa-id"] || request.query.empresa_id;
    if (!empresaId)
      return reply.code(400).send({ error: "Falta x-empresa-id" });

    const empleados = await prisma.empleado.findMany({
      where: {
        eliminado: false,
        // ✅ tu schema NO tiene empleado.empresa_id, así que filtramos por usuario.empresa_id
        usuario: { empresa_id: String(empresaId) },
      },
      include: { usuario: true },
      orderBy: { actualizado_en: "desc" },
    });

    return reply.send(empleados);
  } catch (e) {
    console.error(e);
    return reply
      .code(500)
      .send({ error: "Error empleados", detalle: e.message });
  }
};

/**
 * GET /ventas/hh-empleados?anio=YYYY&mes=MM
 * Devuelve HHEmpleado del período, con empleadoId plano para que el frontend
 * pueda filtrar por empleado y mostrar costoHH.
 */
export const listHHEmpleadosForVentas = async (request, reply) => {
  try {
    const empresaId =
      request.headers["x-empresa-id"] || request.query.empresa_id;
    const anioRaw = request.query.anio;
    const mesRaw = request.query.mes;

    if (!empresaId) return reply.code(400).send({ error: "Falta x-empresa-id" });
    if (!anioRaw || !mesRaw) return reply.code(400).send({ error: "Falta anio/mes" });

    const anio = Number(anioRaw);
    const mes = Number(mesRaw);

    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      return reply.code(400).send({ error: "anio/mes inválidos" });
    }

    const mesesES = [
      "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
    ];
    const nombrePeriodo = `${mesesES[mes]} ${anio}`;

    const rows = await prisma.hHEmpleado.findMany({
      where: {
        empresa_id: String(empresaId),
        OR: [
          { anio, mes },
          { nombre_periodo: nombrePeriodo }, // fallback si tu import guardó solo esto
        ],
      },
      include: {
        empleado: { include: { usuario: true } },
      },
    });

    const normalized = rows.map((r) => ({
      ...r,
      empleadoId: r.empleado_id ?? r.empleado?.id ?? null, // ✅ 1 solo nombre para FE
      rut: r.rut ?? r.empleado?.rut ?? null,               // ✅ todo minúscula
    }));

    return reply.send(normalized);
  } catch (e) {
    console.error("HHEmpleado error:", e);
    return reply.code(500).send({ error: "Error HHEmpleado", detalle: e.message });
  }
};




/**
 * GET /ventas/compra-items
 *
 * Tu frontend usa:
 * - ci.producto
 * - ci.proveedor
 * - ci.compra   ✅ (en tu UI y en createVenta/listVentas lo incluyes)
 *
 * Además:
 * - quitamos take: 500 (tú dijiste que traiga TODO)
 * - dejamos paginación opcional por si después quieres:
 *     ?cursor=<id>&limit=500
 */
export const listCompraItemsForVentas = async (request, reply) => {
  try {
    const empresaId =
      request.headers["x-empresa-id"] || request.query.empresa_id;
    if (!empresaId)
      return reply.code(400).send({ error: "Falta x-empresa-id" });

    const limit = Number(request.query.limit || 0); // 0 => sin límite
    const cursor = request.query.cursor ? String(request.query.cursor) : null;

    const items = await prisma.compraItem.findMany({
      where: {
        // CompraItem no tiene empresa_id, filtramos por proveedor.empresa_id
        proveedor: { empresa_id: String(empresaId) },
      },
      include: {
        producto: true,
        proveedor: true,
        compra: true, // ✅ faltaba para tu frontend y para consistencia
      },
      orderBy: { id: "desc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      ...(limit > 0 ? { take: limit } : {}),
    });

    return reply.send(items);
  } catch (e) {
    console.error(e);
    return reply
      .code(500)
      .send({ error: "Error CompraItems", detalle: e.message });
  }
};

