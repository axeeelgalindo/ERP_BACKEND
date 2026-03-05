// src/lib/scope.js
export function resolveScope(request) {
  const user = request.user || request.session?.user || {};
  const rolCodigo = user.rol?.codigo || user.rolCodigo || null;

  // ✅ headers (fastify los deja en minúsculas)
  const empresaFromHeader =
    request.headers["x-empresa-id"] ??
    request.headers["x-empresa_id"] ??
    request.headers["xempresa-id"] ??
    request.headers["xempresaid"] ??
    null;

  const empresaFromBody = request.body?.empresa_id ?? request.body?.empresaId;
  const empresaFromQuery = request.query?.empresa_id ?? request.query?.empresaId;

  // del token: puede venir string, objeto { id }, o campos planos
  const empresaFromUser =
    user.empresa_id ??
    user.empresaId ??
    (typeof user.empresa === "string"
      ? user.empresa
      : user.empresa && typeof user.empresa === "object"
      ? user.empresa.id
      : undefined);

  const empresaIdRaw =
    empresaFromUser ?? empresaFromHeader ?? empresaFromBody ?? empresaFromQuery;

  const empresaId = empresaIdRaw != null ? String(empresaIdRaw) : null;

  if (!empresaId && rolCodigo !== "SUPERADMIN") {
    const err = new Error("Falta empresa en el contexto");
    err.statusCode = 401;
    throw err;
  }

  return {
    empresaId,
    rolCodigo,
    userId: user.id,
    empleadoId: user.empleado_id ?? user.empleadoId ?? null,
    isSUPERADMIN: rolCodigo === "SUPERADMIN",
  };
}

export const isSUPERADMIN = (s) => s.rolCodigo === "SUPERADMIN";
export const isAdminOrAbove = (s) =>
  s.rolCodigo === "SUPERADMIN" || s.rolCodigo === "ADMIN";