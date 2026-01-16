// src/lib/costos.js
export function valorHoraFromEmpleado(empleado) {
  const sueldo = empleado?.sueldo_base ?? 0;
  if (!sueldo) return null;

  const HORAS_MES = 160; // criterio: 160 horas / mes
  return sueldo / HORAS_MES;
}
