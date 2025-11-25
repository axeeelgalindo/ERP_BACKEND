// src/lib/scope.js
export function resolveScope(request) {
  const user = request.user || request.session?.user || {};
  const rolCodigo = user.rol?.codigo || user.rolCodigo || null;

  // fuentes normalizadas (¡se usan más abajo!)
  const empresaFromHeader = request.headers["x-empresa-id"];
  const empresaFromBody   = request.body?.empresa_id  ?? request.body?.empresaId;
  const empresaFromQuery  = request.query?.empresa_id ?? request.query?.empresaId;

  // del token: puede venir string, objeto { id }, o campos planos
  const empresaFromUser =
    user.empresa_id ??
    user.empresaId ??
    (typeof user.empresa === "string" ? user.empresa
     : user.empresa && typeof user.empresa === "object" ? user.empresa.id
     : undefined);

  // orden de prioridad
  const empresaId =
    empresaFromUser ??
    empresaFromHeader ??
    empresaFromBody ??
    empresaFromQuery;

  if (!empresaId && rolCodigo !== "MASTER") {
    const err = new Error("Falta empresa en el contexto");
    err.statusCode = 401;
    throw err;
  }

  return {
    empresaId,
    rolCodigo,
    userId: user.id,
    empleadoId: user.empleado_id ?? user.empleadoId ?? null,
    isMaster: rolCodigo === "MASTER",
  };
}

export const isMaster = (s) => s.rolCodigo === "MASTER";
export const isAdminOrAbove = (s) => s.rolCodigo === "MASTER" || s.rolCodigo === "ADMIN";
