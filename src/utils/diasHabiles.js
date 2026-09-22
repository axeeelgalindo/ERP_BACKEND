/**
 * Utilidades para cálculo de días hábiles y feriados en Chile
 * Según Código del Trabajo (Art. 67 y 69):
 * - Las vacaciones anuales se contabilizan de lunes a viernes.
 * - Sábados, domingos y feriados legales NO se descuentan del saldo de vacaciones.
 */

// Algoritmo astronómico para cálculo de Domingo de Resurrección (Pascua)
function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Retorna lista de fechas (formato 'YYYY-MM-DD') de feriados en Chile para un año dado
 */
export function getFeriadosChile(year) {
  const feriados = new Set();
  const add = (m, d) => {
    const mm = String(m).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    feriados.add(`${year}-${mm}-${dd}`);
  };

  // Feriados fijos
  add(1, 1);   // Año Nuevo
  add(5, 1);   // Día del Trabajador
  add(5, 21);  // Glorias Navales
  add(6, 21);  // Día Nacional de los Pueblos Indígenas
  add(7, 16);  // Virgen del Carmen
  add(8, 15);  // Asunción de la Virgen
  add(9, 18);  // Independencia Nacional
  add(9, 19);  // Glorias del Ejército
  add(11, 1);  // Todos los Santos
  add(12, 8);  // Inmaculada Concepción
  add(12, 25); // Navidad

  // Fiestas Patrias sándwiches legales (Ley 20.215)
  // Si 18 y 19 son martes y miércoles -> lunes 17 feriado
  // Si 18 y 19 son miércoles y jueves -> viernes 20 feriado
  const sep18Day = new Date(Date.UTC(year, 8, 18)).getUTCDay(); // 2: Martes, 3: Miércoles
  if (sep18Day === 2) add(9, 17);
  if (sep18Day === 3) add(9, 20);

  // Semana Santa (Viernes Santo y Sábado Santo)
  const easter = getEasterSunday(year);
  const viernesSanto = new Date(easter.getTime() - 2 * 24 * 60 * 60 * 1000);
  add(viernesSanto.getUTCMonth() + 1, viernesSanto.getUTCDate());

  // San Pedro y San Pablo (29 de Junio - Ley 19.668 traslados)
  const sanPedroDate = new Date(Date.UTC(year, 5, 29));
  const spDay = sanPedroDate.getUTCDay();
  if (spDay >= 2 && spDay <= 4) {
    // Si cae martes, miércoles o jueves -> se traslada al lunes de esa semana
    const diff = spDay - 1;
    const trasladado = new Date(sanPedroDate.getTime() - diff * 24 * 60 * 60 * 1000);
    add(trasladado.getUTCMonth() + 1, trasladado.getUTCDate());
  } else {
    add(6, 29);
  }

  // Encuentro de Dos Mundos (12 de Octubre - Ley 19.668)
  const dosMundosDate = new Date(Date.UTC(year, 9, 12));
  const dmDay = dosMundosDate.getUTCDay();
  if (dmDay >= 2 && dmDay <= 4) {
    const diff = dmDay - 1;
    const trasladado = new Date(dosMundosDate.getTime() - diff * 24 * 60 * 60 * 1000);
    add(trasladado.getUTCMonth() + 1, trasladado.getUTCDate());
  } else {
    add(10, 12);
  }

  // Día de las Iglesias Evangélicas (31 de Octubre - Ley 20.299)
  // Si cae miércoles -> se traslada al viernes de la misma semana
  // Si cae martes -> se traslada al viernes anterior
  const evanDate = new Date(Date.UTC(year, 9, 31));
  const evanDay = evanDate.getUTCDay();
  if (evanDay === 3) {
    add(11, 2); // viernes 2 de noviembre
  } else if (evanDay === 2) {
    add(10, 27); // viernes anterior 27 de octubre
  } else {
    add(10, 31);
  }

  return feriados;
}

/**
 * Verifica si una fecha específica es feriado en Chile
 */
export function isFeriadoChile(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return false;
  const y = d.getUTCFullYear();
  const feriados = getFeriadosChile(y);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return feriados.has(`${y}-${mm}-${dd}`);
}

/**
 * Calcula la cantidad de DÍAS HÁBILES entre dos fechas (ambas inclusive),
 * excluyendo sábados, domingos y feriados nacionales de Chile.
 * 
 * @param {Date|string} desde 
 * @param {Date|string} hasta 
 * @returns {{ diasHabiles: number, diasTotales: number, finesDeSemana: number, feriadosCount: number }}
 */
export function calcularDiasHabilesVacaciones(desde, hasta) {
  if (!desde || !hasta) {
    return { diasHabiles: 0, diasTotales: 0, finesDeSemana: 0, feriadosCount: 0 };
  }

  const d1 = new Date(desde);
  const d2 = new Date(hasta);

  if (isNaN(d1.getTime()) || isNaN(d2.getTime()) || d2 < d1) {
    return { diasHabiles: 0, diasTotales: 0, finesDeSemana: 0, feriadosCount: 0 };
  }

  // Cache de feriados por año para el rango
  const feriadosCache = {};
  const getFeriados = (y) => {
    if (!feriadosCache[y]) feriadosCache[y] = getFeriadosChile(y);
    return feriadosCache[y];
  };

  let diasHabiles = 0;
  let diasTotales = 0;
  let finesDeSemana = 0;
  let feriadosCount = 0;

  const cur = new Date(Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth(), d1.getUTCDate()));
  const end = new Date(Date.UTC(d2.getUTCFullYear(), d2.getUTCMonth(), d2.getUTCDate()));

  while (cur <= end) {
    diasTotales++;
    const dayOfWeek = cur.getUTCDay(); // 0: Dom, 6: Sab
    const y = cur.getUTCFullYear();
    const mm = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(cur.getUTCDate()).padStart(2, "0");
    const dateStr = `${y}-${mm}-${dd}`;

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = getFeriados(y).has(dateStr);

    if (isWeekend) {
      finesDeSemana++;
    } else if (isHoliday) {
      feriadosCount++;
    } else {
      diasHabiles++;
    }

    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return {
    diasHabiles,
    diasTotales,
    finesDeSemana,
    feriadosCount,
  };
}
