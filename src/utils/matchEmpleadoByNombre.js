// backend/src/utils/matchEmpleadoByNombre.js

export function normalize(str = "") {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar tildes
    .replace(/[^a-z\s]/g, "")        // solo letras
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(str = "") {
  return normalize(str).split(" ").filter(Boolean);
}

/**
 * Match flexible:
 * - Jira: "Juan Gonzalez"
 * - Sistema: "Juan Felipe Gonzalez Perez"
 * Reglas:
 * - Coincidir nombre + al menos 1 apellido
 * - Si es ambiguo, NO asigna
 */
export function matchEmpleadoByNombre(jiraName, empleados = []) {
  if (!jiraName) return null;

  const jiraTokens = tokenize(jiraName);
  if (jiraTokens.length < 2) return null;

  const candidatos = [];

  for (const e of empleados) {
    const empleadoTokens = tokenize(e.nombreCompleto);

    let score = 0;
    for (const t of jiraTokens) {
      if (empleadoTokens.includes(t)) score++;
    }

    // mínimo nombre + apellido
    if (score >= 2) {
      candidatos.push({ empleadoId: e.empleadoId, score });
    }
  }

  if (candidatos.length === 1) {
    return candidatos[0].empleadoId;
  }

  candidatos.sort((a, b) => b.score - a.score);

  if (
    candidatos.length > 1 &&
    candidatos[0].score === candidatos[1].score
  ) {
    return null; // ambiguo
  }

  return candidatos[0]?.empleadoId ?? null;
}
