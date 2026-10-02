import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import Fastify from "fastify";

// Ejecutar los controladores con persistencia simulada, sin acceder a una base real.
const source = readFileSync(new URL("./vacaciones.controllers.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace("const prisma = new PrismaClient();", "")
  .replace(/export /g, "");

function controller(prisma) {
  const context = vm.createContext({ prisma, Date });
  vm.runInContext(source, context);
  return context;
}

function reply() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, send(data) { return data; } };
}

function empleado() {
  return {
    id: "empleado-prueba", sede: "PMC", fecha_ingreso: null,
    saldo_vacaciones_base: 20, fecha_base_vacaciones: new Date(),
    usuario: { nombre: "Prueba" },
    vacaciones: [{ id: "vacacion-prueba", desde: new Date(), hasta: new Date(), dias: 3, estado: "CONFIRMADO" }],
  };
}

test("reporte con vacaciones existentes devuelve los mismos saldos que el resumen", async () => {
  const api = controller({ empleado: { findMany: async () => [empleado()] } });
  const result = await api.listGeneralVacaciones({ query: { ano: String(new Date().getFullYear()) } }, reply());
  assert.equal(result.vacaciones.length, 1);
  for (const key of ["saldo_disponible", "dias_acumulados", "dias_tomados"]) {
    assert.equal(result.vacaciones[0][key], result.saldos[0][key]);
    assert.equal(typeof result.vacaciones[0][key], "number");
  }
});

test("certificado respeta el saldo base aunque no exista fecha de ingreso", async () => {
  const emp = empleado();
  emp.vacaciones = [];
  const api = controller({
    empleado: { findUnique: async () => emp },
    empleadoVacacion: { create: async ({ data }) => ({ id: "nueva", ...data }) },
  });
  const result = await api.createEmpleadoVacacion({ params: { id: emp.id }, body: { desde: "2026-10-01", hasta: "2026-10-02", dias: 2 } }, reply());
  assert.equal(result.saldo_anterior, 20);
  assert.equal(result.saldo_pendiente, 18);
});

test("certificado sin saldo base conserva el cálculo por fecha de ingreso", async () => {
  const emp = empleado();
  emp.saldo_vacaciones_base = null;
  emp.fecha_ingreso = new Date(new Date().getFullYear() - 1, 0, 1);
  emp.vacaciones = [];
  const api = controller({
    empleado: { findUnique: async () => emp },
    empleadoVacacion: { create: async ({ data }) => data },
  });
  const result = await api.createEmpleadoVacacion({ params: { id: emp.id }, body: { desde: "2026-10-01", hasta: "2026-10-02", dias: 2 } }, reply());
  assert.equal(result.saldo_anterior, api.calcularSaldoEmpleado(emp).saldo_disponible);
  assert.equal(result.saldo_pendiente, Math.round((result.saldo_anterior - 2) * 100) / 100);
});

test("Fastify acepta DELETE sin cuerpo cuando se omite Content-Type", async () => {
  const app = Fastify();
  let deleted = false;
  const api = controller({ empleadoVacacion: {
    findUnique: async () => ({ id: "prueba" }),
    delete: async () => { deleted = true; },
  } });
  app.delete("/vacaciones/:vacacionId", api.deleteEmpleadoVacacion);
  try {
    const invalid = await app.inject({ method: "DELETE", url: "/vacaciones/prueba", headers: { "content-type": "application/json" } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(deleted, false);
    const valid = await app.inject({ method: "DELETE", url: "/vacaciones/prueba" });
    assert.equal(valid.statusCode, 200);
    assert.equal(deleted, true);
  } finally {
    await app.close();
  }
});
