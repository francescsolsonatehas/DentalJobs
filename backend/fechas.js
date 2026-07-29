// Utilidades de fechas para las suplencias por días y la disponibilidad del
// dentista. Todas las fechas son cadenas 'YYYY-MM-DD' (lo que emite <input type=date>).

// Expande un rango continuo a la lista de días 'YYYY-MM-DD' (ambos incluidos).
// Si `hasta` es falsy, devuelve solo [desde]. Rango inválido o invertido → [desde]
// (o [] si tampoco hay `desde`). Tope de seguridad de 366 días.
function expandirRango(desde, hasta) {
  if (!desde) return [];
  const inicio = String(desde).slice(0, 10);
  const fin = hasta ? String(hasta).slice(0, 10) : inicio;

  const d = new Date(inicio + "T00:00:00Z");
  const limite = new Date(fin + "T00:00:00Z");
  if (isNaN(d.getTime()) || isNaN(limite.getTime()) || limite < d) return [inicio];

  const dias = [];
  let guard = 0;
  while (d <= limite && guard < 366) {
    dias.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    guard++;
  }
  return dias;
}

// Normaliza una lista de días: deduplica, descarta lo que no tenga formato
// 'YYYY-MM-DD', ordena ascendente y limita a `max` días.
function sanearDias(dias, max = 92) {
  if (!Array.isArray(dias)) return [];
  const set = new Set();
  for (const d of dias) {
    const s = String(d).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00Z").getTime())) {
      set.add(s);
    }
  }
  return [...set].sort().slice(0, max);
}

const TURNOS_VALIDOS = ["manana", "tarde", "ambos"];

// Normaliza días de la semana con turno para "Colaboración": deduplica por día (uno
// no puede tener dos turnos a la vez), descarta lo que no tenga día 1-6 (lunes a
// sábado) o turno válido, ordena por día y limita a `max` (hay como mucho 6 días).
function sanearDiasSemana(lista, max = 6) {
  if (!Array.isArray(lista)) return [];
  const porDia = new Map();
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const dia = parseInt(item.dia, 10);
    const turno = String(item.turno || "");
    if (!Number.isInteger(dia) || dia < 1 || dia > 6) continue;
    if (!TURNOS_VALIDOS.includes(turno)) continue;
    porDia.set(dia, { dia, turno });
  }
  return [...porDia.values()].sort((a, b) => a.dia - b.dia).slice(0, max);
}

module.exports = { expandirRango, sanearDias, sanearDiasSemana, TURNOS_VALIDOS };
