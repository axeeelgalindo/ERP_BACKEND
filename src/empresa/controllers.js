import { PrismaClient } from "@prisma/client";
import { resolveScope, isAdminOrAbove } from "../lib/scope.js";
const prisma = new PrismaClient();

/* ========== LISTAR EMPRESAS ========== */
export async function listEmpresas(request, reply) {
  try {
    const { q, activa, includeDeleted, page = 1, pageSize = 20 } = request.query;

    const showDeleted = ["1", "true", "yes", "on", true].includes(
      String(includeDeleted).toLowerCase()
    );

    const where = {
      ...(q
        ? {
            OR: [
              { nombre: { contains: q, mode: "insensitive" } },
              { rut: { contains: q, mode: "insensitive" } },
              { correo: { contains: q, mode: "insensitive" } },
              { telefono: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(typeof activa === "boolean" ? { activa } : {}),
      ...(showDeleted ? {} : { eliminado: false }),
    };

    const total = await prisma.empresa.count({ where });
    const data = await prisma.empresa.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { creada_en: "desc" },
    });

    return reply.send({ total, data });
  } catch (error) {
    console.error("❌ listEmpresas", error);
    return reply.status(500).send({ error: "Error al listar empresas" });
  }
}

/* ========== OBTENER EMPRESA POR ID ========== */
export async function getEmpresa(request, reply) {
  try {
    const { id } = request.params;
    const empresa = await prisma.empresa.findUnique({
      where: { id },
      include: {
        usuarios: true,
        clientes: true,
        proveedores: true,
        productos: true,
        proyectos: true,
      },
    });

    if (!empresa || empresa.eliminado)
      return reply.status(404).send({ error: "Empresa no encontrada o eliminada" });

    return reply.send(empresa);
  } catch (error) {
    console.error("❌ getEmpresa", error);
    return reply.status(500).send({ error: "Error al obtener empresa" });
  }
}

/* ========== CREAR EMPRESA ========== */
export async function createEmpresa(request, reply) {
  try {
    const data = request.body;
    const empresa = await prisma.empresa.create({ data });
    return reply.code(201).send(empresa);
  } catch (error) {
    console.error("❌ createEmpresa", error);
    return reply.status(500).send({ error: "Error al crear empresa" });
  }
}

/* ========== ACTUALIZAR EMPRESA ========== */
export async function updateEmpresa(request, reply) {
  try {
    const { id } = request.params;
    const data = request.body;
    const empresa = await prisma.empresa.update({ where: { id }, data });
    return reply.send(empresa);
  } catch (error) {
    console.error("❌ updateEmpresa", error);
    return reply.status(500).send({ error: "Error al actualizar empresa" });
  }
}

/* ========== ELIMINAR EMPRESA (HARD DELETE CON VALIDACIÓN) ========== */
export async function deleteEmpresa(request, reply) {
  try {
    const scope = resolveScope(request);
    if (!isAdminOrAbove(scope))
      return reply.forbidden("Solo ADMIN/MASTER pueden eliminar empresas");

    const { id } = request.params;
    const { force } = request.query || {};

    const empresa = await prisma.empresa.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            usuarios: true,
            clientes: true,
            proveedores: true,
            productos: true,
            proyectos: true,
          },
        },
      },
    });

    if (!empresa) return reply.notFound("Empresa no encontrada");

    // Si tiene relaciones y no hay force, rechazamos
    const tieneRelacion =
      empresa._count.usuarios > 0 ||
      empresa._count.clientes > 0 ||
      empresa._count.proveedores > 0 ||
      empresa._count.productos > 0 ||
      empresa._count.proyectos > 0;

    if (!force && tieneRelacion) {
      return reply.conflict(
        "Empresa con datos asociados. Usa ?force=true para eliminar definitivamente."
      );
    }

    // Si no está eliminada, pedimos deshabilitar antes
    if (!empresa.eliminado && !force) {
      return reply.conflict(
        "Debe deshabilitar la empresa antes de eliminarla, o usar ?force=true."
      );
    }

    await prisma.empresa.delete({ where: { id } });
    return reply.send({ success: true, msg: "Empresa eliminada permanentemente" });
  } catch (error) {
    console.error("❌ deleteEmpresa", error);
    return reply.status(500).send({ error: "Error al eliminar empresa" });
  }
}

/* ========== SOFT DELETE (DESHABILITAR) ========== */
export async function disableEmpresa(request, reply) {
  const scope = resolveScope(request);
  if (!isAdminOrAbove(scope))
    return reply.forbidden("Solo ADMIN/MASTER pueden deshabilitar empresas");

  const { id } = request.params;
  const emp = await prisma.empresa.findUnique({ where: { id } });
  if (!emp) return reply.notFound("Empresa no encontrada");
  if (emp.eliminado) return reply.conflict("Empresa ya está deshabilitada");

  const upd = await prisma.empresa.update({
    where: { id },
    data: { eliminado: true, eliminado_en: new Date(), activa: false },
  });

  return reply.send({ success: true, empresa: upd });
}

/* ========== RESTORE (REACTIVAR) ========== */
export async function restoreEmpresa(request, reply) {
  const scope = resolveScope(request);
  if (!isAdminOrAbove(scope))
    return reply.forbidden("Solo ADMIN/MASTER pueden restaurar empresas");

  const { id } = request.params;
  const emp = await prisma.empresa.findUnique({ where: { id } });
  if (!emp) return reply.notFound("Empresa no encontrada");
  if (!emp.eliminado) return reply.conflict("Empresa ya está activa");

  const upd = await prisma.empresa.update({
    where: { id },
    data: { eliminado: false, eliminado_en: null, activa: true },
  });

  return reply.send({ success: true, empresa: upd });
}
