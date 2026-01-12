// src/controllers/hh.controller.js
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// =============================
// HELPERS
// =============================
function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const cleaned = value.replace(/\./g, "").replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

// ✅ Normaliza RUT (21.166.343-K => 21166343K)
function normalizeRut(rut) {
  return String(rut || "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "");
}

function stripAccents(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function cleanNameToken(s) {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-zñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Excel suele venir así: "Delgado Galindo, Axel Nicolas"
 * Retorna: { nombres: ["axel","nicolas"], apellidos: ["delgado","galindo"] }
 * Si viene sin coma: "Axel Nicolas Delgado Galindo" (fallback)
 */
function parseExcelFullName(fullName) {
  const raw = String(fullName || "").trim();
  if (!raw) return { nombres: [], apellidos: [] };

  const parts = raw.split(",").map((x) => x.trim());

  if (parts.length === 2) {
    const apellidos = cleanNameToken(parts[0]).split(" ").filter(Boolean);
    const nombres = cleanNameToken(parts[1]).split(" ").filter(Boolean);
    return { nombres, apellidos };
  }

  const tokens = cleanNameToken(raw).split(" ").filter(Boolean);
  if (tokens.length === 1) return { nombres: tokens, apellidos: [] };
  return { nombres: tokens.slice(0, -1), apellidos: tokens.slice(-1) };
}

function buildEmailLocalPartFromName(fullName) {
  const { nombres, apellidos } = parseExcelFullName(fullName);
  const primerNombre = nombres?.[0] || "";
  const primerApellido = apellidos?.[0] || "";
  const inicial = primerNombre ? primerNombre[0] : "";
  const base = `${inicial}${primerApellido}`.toLowerCase();
  return base.replace(/ñ/g, "n").replace(/[^a-z0-9]/g, "");
}

/**
 * Asegura correo único por empresa:
 * adelgado@dominio -> adelgado2@dominio -> adelgado3@dominio
 */
async function ensureUniqueEmail(tx, empresaId, emailLocalPart, domain) {
  const safeLocal = String(emailLocalPart || "").trim();
  if (!safeLocal) return null;

  const safeDomain = String(domain || "").trim().toLowerCase();
  if (!safeDomain) return null;

  for (let attempt = 0; attempt < 50; attempt++) {
    const suffix = attempt === 0 ? "" : String(attempt + 1);
    const correo = `${safeLocal}${suffix}@${safeDomain}`;

    const exists = await tx.usuario.findFirst({
      where: { empresa_id: String(empresaId), correo, eliminado: false },
      select: { id: true },
    });

    if (!exists) return correo;
  }

  return `${safeLocal}${Date.now().toString().slice(-5)}@${safeDomain}`;
}

function randomPassword(len = 10) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// =============================
// CONTROLLERS
// =============================
export const uploadLibroRemuneraciones = async (request, reply) => {
  try {
    const parts = request.parts();

    let empresa_id = null;
    let anio = null;
    let mes = null;

    let horas_mensuales = null;
    let porcentaje_efectividad = null;

    let cif = null;

    let fileBuffer = null;
    let filename = null;
    let mimetype = null;

    for await (const part of parts) {
      if (part.file) {
        filename = part.filename;
        mimetype = part.mimetype;
        const chunks = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
      } else {
        if (part.fieldname === "empresa_id") empresa_id = part.value;
        if (part.fieldname === "anio") anio = parseInt(part.value, 10);
        if (part.fieldname === "mes") mes = parseInt(part.value, 10);
        if (part.fieldname === "horas_mensuales") horas_mensuales = parseFloat(part.value);
        if (part.fieldname === "porcentaje_efectividad")
          porcentaje_efectividad = parseFloat(part.value);

        if (part.fieldname === "cif") cif = parseNumber(part.value);
      }
    }

    // =============================
    // VALIDACIONES
    // =============================
    if (!empresa_id || !anio || !mes) {
      return reply.code(400).send({ error: "empresa_id, anio y mes son obligatorios" });
    }
    if (!fileBuffer) {
      return reply.code(400).send({ error: "Debe enviar archivo Excel en 'file'" });
    }
    if (mes < 1 || mes > 12) {
      return reply.code(400).send({ error: "mes inválido (1..12)" });
    }
    if (
      horas_mensuales == null ||
      porcentaje_efectividad == null ||
      Number.isNaN(horas_mensuales) ||
      Number.isNaN(porcentaje_efectividad)
    ) {
      return reply.code(400).send({
        error: "horas_mensuales y porcentaje_efectividad son obligatorios",
      });
    }
    if (cif == null || Number.isNaN(cif)) {
      return reply.code(400).send({
        error: "cif es obligatorio y debe ser numérico (float)",
      });
    }

    const nombreMeses = [
      "",
      "Enero",
      "Febrero",
      "Marzo",
      "Abril",
      "Mayo",
      "Junio",
      "Julio",
      "Agosto",
      "Septiembre",
      "Octubre",
      "Noviembre",
      "Diciembre",
    ];
    const nombrePeriodo = `${nombreMeses[mes] || `Mes ${mes}`} ${anio}`;
    const horasEfectivas = horas_mensuales * (porcentaje_efectividad / 100);

    // =============================
    // LEER EXCEL
    // =============================
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    if (!rows?.length) {
      return reply.code(400).send({ error: "Excel vacío o ilegible" });
    }

    const headerRowIndex = rows.findIndex((r) => r?.[0] === "Nombre" && r?.[1] === "RUT");
    if (headerRowIndex === -1) {
      return reply.code(400).send({
        error: "No se encontró cabecera con columnas 'Nombre' y 'RUT'",
      });
    }
    const header = rows[headerRowIndex];

    // =============================
    // MAPEO DE COLUMNAS
    // =============================
    const idx = {
      nombre: null,
      rut: null,
      dias_trabajados: null,
      sueldo_base: null,
      extras: null,
      gratificacion: null,
      imponible1: null,
      imponible2: null,
      movilizacion: null,
      colacion: null,
      imponible3: null,
      imponible4: null,
      haberes: null,
      afp: null,
      unico: null,
      previsional: null,
      salud: null,
      antiguo: null,
      anticipos: null,
      prestamos: null,
      apv: null,
      desctos1: null,
      desctos2: null,
      liquido: null,
      empleador: null,
    };

    let countImponible = 0;
    let countDesctos = 0;

    header.forEach((col, i) => {
      switch (col) {
        case "Nombre":
          idx.nombre = i;
          break;
        case "RUT":
          idx.rut = i;
          break;
        case "Trab.":
          idx.dias_trabajados = i;
          break;
        case "Sueldo Base":
          idx.sueldo_base = i;
          break;
        case "Extras":
          idx.extras = i;
          break;
        case "Gratific.":
          idx.gratificacion = i;
          break;

        case "Imponible":
          countImponible++;
          if (countImponible === 1) idx.imponible1 = i;
          else if (countImponible === 2) idx.imponible2 = i;
          else if (countImponible === 3) idx.imponible3 = i;
          else if (countImponible === 4) idx.imponible4 = i;
          break;

        case "Moviliz.":
          idx.movilizacion = i;
          break;
        case "Colac.":
          idx.colacion = i;
          break;
        case "Haberes":
          idx.haberes = i;
          break;

        case "AFP":
          idx.afp = i;
          break;
        case "Único":
          idx.unico = i;
          break;
        case "Previsional":
          idx.previsional = i;
          break;
        case "Salud":
          idx.salud = i;
          break;
        case "Antiguo":
          idx.antiguo = i;
          break;
        case "Anticipos":
          idx.anticipos = i;
          break;
        case "Prestamos":
          idx.prestamos = i;
          break;
        case "APV":
          idx.apv = i;
          break;

        case "Desctos.":
          countDesctos++;
          if (countDesctos === 1) idx.desctos1 = i;
          else idx.desctos2 = i;
          break;

        case "Líquido":
          idx.liquido = i;
          break;
        case "Empleador":
          idx.empleador = i;
          break;
      }
    });

    if (idx.nombre == null || idx.rut == null) {
      return reply.code(400).send({
        error: "El Excel no tiene columnas Nombre y RUT",
        debug: idx,
      });
    }

    // =============================
    // 1) PRE-LECTURA: set de RUTs del Excel
    // =============================
    const excelRutNormSet = new Set();
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (row[0] === "Totales") break;

      const rutNorm = normalizeRut(row[idx.rut]);
      if (rutNorm) excelRutNormSet.add(rutNorm);
    }

    // =============================
    // 2) Traer empleados de la empresa + placeholders
    // =============================
    const empleadosEmpresa = await prisma.empleado.findMany({
      where: {
        eliminado: false,
        usuario: { empresa_id: String(empresa_id), eliminado: false },
      },
      select: { id: true, rut: true, usuario_id: true },
    });

    const placeholders = await prisma.empleado.findMany({
      where: { eliminado: false, usuario_id: null, rut: { not: null } },
      select: { id: true, rut: true, usuario_id: true },
    });

    const rutMap = new Map();
    for (const e of empleadosEmpresa) {
      const r = normalizeRut(e.rut);
      if (r) rutMap.set(r, { id: e.id, rut: e.rut, usuario_id: e.usuario_id });
    }
    for (const e of placeholders) {
      const r = normalizeRut(e.rut);
      if (r && excelRutNormSet.has(r) && !rutMap.has(r)) {
        rutMap.set(r, { id: e.id, rut: e.rut, usuario_id: e.usuario_id });
      }
    }

    // =============================
    // 3) Parsear filas: HH + upserts por RUT (incluye nombre)
    // =============================
    const registros = [];
    const upsertsByRutNorm = new Map();

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (row[0] === "Totales") break;

      const nombre = row[idx.nombre];
      if (!nombre) continue;

      const rutRaw = row[idx.rut] ?? null;
      const rutNorm = normalizeRut(rutRaw);

      if (rutNorm && !upsertsByRutNorm.has(rutNorm)) {
        upsertsByRutNorm.set(rutNorm, { rutRaw, nombreRaw: nombre });
      }

      const dias_trabajados =
        idx.dias_trabajados != null ? parseInt(row[idx.dias_trabajados]) : null;

      const sueldo_base = idx.sueldo_base != null ? parseNumber(row[idx.sueldo_base]) : null;
      const extras = idx.extras != null ? parseNumber(row[idx.extras]) : null;
      const gratificacion =
        idx.gratificacion != null ? parseNumber(row[idx.gratificacion]) : null;

      const imponible1 = idx.imponible1 != null ? parseNumber(row[idx.imponible1]) : null;
      const imponible2 = idx.imponible2 != null ? parseNumber(row[idx.imponible2]) : null;
      const movilizacion =
        idx.movilizacion != null ? parseNumber(row[idx.movilizacion]) : null;
      const colacion = idx.colacion != null ? parseNumber(row[idx.colacion]) : null;
      const imponible3 = idx.imponible3 != null ? parseNumber(row[idx.imponible3]) : null;
      const imponible4 = idx.imponible4 != null ? parseNumber(row[idx.imponible4]) : null;

      const haberes = idx.haberes != null ? parseNumber(row[idx.haberes]) : null;

      const afp = idx.afp != null ? parseNumber(row[idx.afp]) : null;
      const unico = idx.unico != null ? parseNumber(row[idx.unico]) : null;
      const previsional =
        idx.previsional != null ? parseNumber(row[idx.previsional]) : null;
      const salud = idx.salud != null ? parseNumber(row[idx.salud]) : null;
      const antiguo = idx.antiguo != null ? parseNumber(row[idx.antiguo]) : null;
      const anticipos = idx.anticipos != null ? parseNumber(row[idx.anticipos]) : null;
      const prestamos = idx.prestamos != null ? parseNumber(row[idx.prestamos]) : null;
      const apv = idx.apv != null ? parseNumber(row[idx.apv]) : null;

      const desctos1 = idx.desctos1 != null ? parseNumber(row[idx.desctos1]) : null;
      const desctos2 = idx.desctos2 != null ? parseNumber(row[idx.desctos2]) : null;

      const liquido = idx.liquido != null ? parseNumber(row[idx.liquido]) : null;
      const empleador = idx.empleador != null ? parseNumber(row[idx.empleador]) : null;

      let pagado = null;
      let feriado = null;
      let indemnizacion = null;
      let total = null;
      let costoHH = null;

      if (haberes != null || empleador != null) pagado = (haberes || 0) + (empleador || 0);

      if (pagado != null && dias_trabajados > 0) {
        feriado = (pagado / dias_trabajados) * 2.05;
        indemnizacion = (pagado / dias_trabajados) * 2.47;
        total = pagado + feriado + indemnizacion;
      }

      if (total != null && horasEfectivas > 0) costoHH = total / horasEfectivas;

      registros.push({
        _rutNorm: rutNorm,
        empresa_id: String(empresa_id),
        empleado_id: null,
        anio,
        mes,
        nombre_periodo: nombrePeriodo,

        cif,

        nombre,
        rut: rutRaw,

        dias_trabajados,

        sueldo_base,
        extras,
        gratificacion,

        imponible1,
        imponible2,
        movilizacion,
        colacion,
        imponible3,
        imponible4,

        haberes,

        afp,
        unico,
        previsional,
        salud,
        antiguo,
        anticipos,
        prestamos,
        apv,

        desctos1,
        desctos2,

        liquido,
        empleador,

        pagado,
        feriado,
        indemnizacion,
        total,

        costoHH,

        horasMensuales: horas_mensuales,
        horasEfectivas,

        raw: row,
      });
    }

    // =============================
    // 4) TRANSACCIÓN
    // =============================
    const DEFAULT_EMAIL_DOMAIN = "blueinge.com";

    const stats = {
      empleadosCreados: 0,
      empleadosActualizados: 0,
      usuariosCreados: 0,
      usuariosActualizados: 0,
      empleadosVinculadosAUsuario: 0,
      empleadosYaTenianUsuario: 0,
      warnings: [],
    };

    await prisma.$transaction(async (tx) => {
      // ✅ empresa existe (y valida antes de crear users)
      const empresa = await tx.empresa.findUnique({
        where: { id: String(empresa_id) },
        select: { id: true },
      });
      if (!empresa) throw new Error(`empresa_id inválido: ${empresa_id}`);

      // ✅ rol default obligatorio
      const rolDefault = await tx.rolUsuario.findFirst({
        where: {
          eliminado: false,
          OR: [
            { codigo: "USER" },
            { codigo: "USUARIO" },
            { nombre: "USER" },
            { nombre: "Usuario" },
            { nombre: "USUARIO" },
            { nombre: "Empleado" },
            { codigo: "EMPLEADO" },
            { nombre: "EMPLEADO" },
            { codigo: "ADMIN" }, // fallback
            { nombre: "ADMIN" },
          ],
        },
        select: { id: true },
        orderBy: { nombre: "asc" },
      });
      if (!rolDefault) {
        throw new Error(
          "No se encontró un rol default (USER/USUARIO/EMPLEADO/ADMIN). Crea uno en el seed antes de importar."
        );
      }

      // borra HH del periodo
      await tx.hHEmpleado.deleteMany({
        where: { empresa_id: String(empresa_id), anio, mes },
      });

      // 4.1 asegurar Empleado + Usuario para cada RUT del excel
      for (const [rutNorm, payload] of upsertsByRutNorm.entries()) {
        if (!rutNorm) continue;

        const rutRaw = payload?.rutRaw || rutNorm;
        const nombreRaw = payload?.nombreRaw || "";

        const existing = rutMap.get(rutNorm);

        // A) si no existe empleado => crea placeholder (sin usuario aún)
        if (!existing) {
          const nuevo = await tx.empleado.create({
            data: { rut: String(rutRaw), activo: true, usuario_id: null },
            select: { id: true, rut: true, usuario_id: true },
          });
          rutMap.set(rutNorm, { id: nuevo.id, rut: nuevo.rut, usuario_id: nuevo.usuario_id });
          stats.empleadosCreados++;
        } else {
          await tx.empleado.update({
            where: { id: existing.id },
            data: { rut: String(rutRaw), activo: true },
          });
          stats.empleadosActualizados++;
        }

        const cur = rutMap.get(rutNorm);
        if (!cur?.id) continue;

        // B) si empleado ya tiene usuario, listo
        if (cur.usuario_id) {
          stats.empleadosYaTenianUsuario++;
          continue;
        }

        // C) crear/asegurar correo único
        const local = buildEmailLocalPartFromName(nombreRaw);
        const correo = await ensureUniqueEmail(tx, empresa_id, local, DEFAULT_EMAIL_DOMAIN);

        if (!correo) {
          stats.warnings.push({
            rut: rutRaw,
            nombre: nombreRaw,
            motivo: "No se pudo generar correo desde el nombre",
          });
          continue;
        }

        // D) crear o upsert usuario (por correo+eliminado=false)
        const pass = randomPassword();
        const hash = await bcrypt.hash(pass, 10);

        const nombreUsuario = String(nombreRaw).trim() || String(rutRaw);

        const usuario = await tx.usuario.upsert({
          where: { correo_eliminado: { correo, eliminado: false } },
          update: {
            nombre: nombreUsuario,
            contrasena: hash,
            // ✅ relaciones obligatorias
            empresa: { connect: { id: empresa.id } },
            rol: { connect: { id: rolDefault.id } },
            eliminado: false,
            eliminado_en: null,
          },
          create: {
            nombre: nombreUsuario,
            correo,
            contrasena: hash,
            // ✅ relaciones obligatorias
            empresa: { connect: { id: empresa.id } },
            rol: { connect: { id: rolDefault.id } },
          },
          select: { id: true },
        });

        // stats (creado vs actualizado) sin hacer query extra:
        // Prisma no entrega flag, así que lo aproximamos:
        // si existía correo, fue update; si no, create.
        // Para no consultar 2 veces, dejamos conteo simple:
        // (si quieres exactitud, hacemos findFirst antes, pero es más lento)
        stats.usuariosCreados++;

        // E) vincular empleado a usuario
        await tx.empleado.update({
          where: { id: cur.id },
          data: { usuario_id: usuario.id, eliminado: false, eliminado_en: null, activo: true },
        });

        rutMap.set(rutNorm, { ...cur, usuario_id: usuario.id });
        stats.empleadosVinculadosAUsuario++;
      }

      // 4.2 Inserta HHEmpleado para el periodo (con empleado_id si existe en rutMap)
      const dataFinal = registros.map((r) => {
        const empleado_id =
          r._rutNorm && rutMap.has(r._rutNorm) ? rutMap.get(r._rutNorm).id : null;
        const { _rutNorm, ...rest } = r;
        return { ...rest, empleado_id };
      });

      await tx.hHEmpleado.createMany({ data: dataFinal });
    });

    return reply.code(200).send({
      msg: "Libro de remuneraciones importado correctamente",
      inserted: registros.length,
      periodo: { empresa_id, anio, mes, nombre_periodo: nombrePeriodo, cif },
      archivo: { filename, mimetype },
      ...stats,
      warningsPreview: stats.warnings.slice(0, 50),
    });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({
      error: "Error al procesar libro de remuneraciones",
      detalle: err.message,
    });
  }
};

export const listHH = async (request, reply) => {
  try {
    const empresaFromToken =
      request.user?.empresaId ||
      request.user?.empresa_id ||
      request.user?.empresa?.id ||
      null;

    const { empresa_id: empresaQuery, anio, mes } = request.query || {};
    const empresa_id = empresaFromToken || empresaQuery;

    if (!empresa_id) {
      return reply.code(400).send({
        error:
          "No se pudo determinar la empresa. Asegúrate de que el token incluya empresaId o envía empresa_id en query.",
      });
    }

    const where = { empresa_id: String(empresa_id) };
    if (anio) where.anio = Number(anio);
    if (mes) where.mes = Number(mes);

    const registros = await prisma.hHEmpleado.findMany({
      where,
      orderBy: [{ anio: "desc" }, { mes: "desc" }, { nombre: "asc" }],
    });

    return reply.code(200).send(registros);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({
      error: "Error al obtener HH",
      detalle: err.message,
    });
  }
};
