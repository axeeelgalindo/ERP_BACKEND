//src/admin/guards.js

function getScope(request) {
  const empresaId =
    request?.scope?.empresaId ?? request?.headers?.["x-empresa-id"] ?? null;

  const userId =
    request?.scope?.userId ??
    request?.user?.userId ??
    request?.user?.sub ??
    null;

  if (!userId) {
    const err = new Error("Falta usuario en el contexto (token)");
    err.statusCode = 401;
    throw err;
  }

  // Solo obliga empresa para no-MASTER (igual que tu authz.js)
  const rolCodigo =
    request?.scope?.rolCodigo ?? request?.user?.rol?.codigo ?? null;
  if (!empresaId && rolCodigo !== "SUPERADMIN") {
    const err = new Error("Falta empresa en el contexto");
    err.statusCode = 401;
    throw err;
  }

  return {
    empresaId: empresaId ? String(empresaId) : null,
    userId: String(userId),
    rolCodigo,
  };
}

export function requireSuperAdmin(request, reply) {
  const scope = getScope(request);

  // Ajusta esto a cómo te llega el rol hoy (yo asumo algo así):
  // scope.rolCodigo o scope.user.rol?.codigo
  const rolCodigo =
    scope?.rolCodigo ||
    scope?.rol?.codigo ||
    scope?.user?.rol?.codigo ||
    null;

  if (rolCodigo !== "SUPERADMIN") {
    reply.code(403).send({ error: "Forbidden (SUPERADMIN requerido)" });
    return false;
  }
  return true;
}