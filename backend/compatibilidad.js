// Motor de compatibilidad dentista ↔ oferta/suplencia.
//
// Fase 1: solo puntúa las dimensiones que se pueden calcular con datos que YA
// existen en la plataforma, sin pedir nada nuevo a nadie:
//
//   - Nivel salarial: lo que ofrece la publicación vs. lo que pide el dentista
//     en su solicitud activa (salario_min).
//   - Horarios: en suplencias, solape de días con la disponibilidad del dentista;
//     en ofertas fijas, coincidencia de jornada con la de su solicitud.
//   - Tecnología: equipamiento de la clínica vs. el que aprovechan las
//     certificaciones del dentista (ver AFINIDAD_TECNOLOGIA).
//
// Las otras cinco variables del modelo (filosofía de trabajo, tipo de pacientes,
// ambiente, formación continua y objetivos profesionales) llegan en la Fase 2 con
// su cuestionario; el catálogo DIMENSIONES es el sitio donde se enchufan.
//
// Dos reglas que sostienen la credibilidad del porcentaje:
//
//   1. Una dimensión solo puntúa si AMBOS lados tienen el dato. Si falta uno, no
//      suma ni resta: sale del denominador y se reporta como `sin_datos` diciendo
//      a quién le falta (para poder pedírselo).
//   2. Si el peso evaluado no llega a COBERTURA_MINIMA del total, NO se devuelve
//      porcentaje (`porcentaje: null`). Un "92%" calculado sobre una sola
//      dimensión es peor que no enseñar nada.
//
// El módulo es puro (no toca la BD) para poder probarlo dimensión a dimensión.

const { EQUIPAMIENTO_CATALOGO } = require("./catalogos");

// Peso relativo de cada dimensión. Al normalizar por el peso realmente evaluado,
// estos números son proporciones, no porcentajes: subir uno no obliga a bajar otro.
const DIMENSIONES = [
  { clave: "salario", etiqueta: "Nivel salarial", peso: 3 },
  { clave: "horarios", etiqueta: "Horarios", peso: 3 },
  { clave: "tecnologia", etiqueta: "Tecnología", peso: 2 }
];

// Fracción mínima del peso total que hay que poder evaluar para enseñar un %.
const COBERTURA_MINIMA = 0.5;

// Qué equipamiento de la clínica aprovecha cada certificación del dentista. Es la
// forma de puntuar "tecnología" en la Fase 1 sin preguntarle al dentista con qué
// quiere trabajar: si está certificado en Invisalign, un escáner intraoral le sirve.
const AFINIDAD_TECNOLOGIA = {
  "Invisalign": ["Escáner intraoral", "CAD-CAM"],
  "Implantología avanzada": ["CBCT / TAC 3D"],
  "Ortodoncia lingual": ["Escáner intraoral", "CAD-CAM"],
  "Estética dental avanzada": ["Escáner intraoral", "CAD-CAM", "Láser dental"],
  "Sedación consciente": ["Sedación consciente"],
  "Cirugía guiada": ["CBCT / TAC 3D", "CAD-CAM"]
};

// Umbrales para traducir una puntuación (0..1) a un estado legible.
const UMBRAL_COINCIDE = 0.85;
const UMBRAL_PARCIAL = 0.4;

function estadoDe(puntuacion) {
  if (puntuacion >= UMBRAL_COINCIDE) return "coincide";
  if (puntuacion >= UMBRAL_PARCIAL) return "parcial";
  return "discrepa";
}

function sinDatos(falta, detalle) {
  return { puntuacion: null, falta, detalle };
}

// --- Nivel salarial -----------------------------------------------------------
// `oferta.salario_min/salario_max` es la horquilla que ofrece la clínica;
// `perfil.salario_pretendido` es el mínimo que pide el dentista en su solicitud.
// Se compara contra el techo de la horquilla: si la clínica llega a lo que pide,
// coincide; si se queda corta, la puntuación cae en proporción a lo que falta.
function puntuarSalario(perfil, oferta) {
  if (oferta.retribucion_tipo === "porcentaje") {
    // Un % de facturación no es comparable con un salario anual sin conocer la
    // facturación de la clínica: no se inventa un número, se declara sin datos.
    return sinDatos("clinica", "La clínica retribuye por porcentaje de facturación, no comparable con un salario fijo");
  }

  const pretendido = perfil.salario_pretendido;
  if (!pretendido) {
    return sinDatos("dentista", "No has indicado el salario que buscas en tu solicitud");
  }

  const ofrecido = oferta.salario_max || oferta.salario_min;
  if (!ofrecido) {
    return sinDatos("clinica", "La clínica no ha indicado el salario");
  }

  const ratio = ofrecido / pretendido;
  const puntuacion = Math.max(0, Math.min(1, ratio));
  const llega = ratio >= 1;

  // El salario impone su propio estado en vez de usar los umbrales genéricos: un
  // "✅ coincide" tiene que significar que la clínica llega a lo que pides. Quedarse
  // un 10% corto puntúa alto (0,9) pero no es una coincidencia, es un "casi".
  return {
    puntuacion,
    estado: llega ? "coincide" : (puntuacion >= UMBRAL_PARCIAL ? "parcial" : "discrepa"),
    detalle: llega
      ? `La clínica ofrece hasta ${ofrecido} €, igual o más de los ${pretendido} € que buscas`
      : `La clínica ofrece hasta ${ofrecido} €, por debajo de los ${pretendido} € que buscas`
  };
}

// --- Horarios -----------------------------------------------------------------
// En suplencias el dato bueno son los días: fracción de los días de la suplencia
// que el dentista tiene marcados como disponibles. En ofertas fijas no hay días,
// así que se compara la jornada (completa/parcial/…) con la de su solicitud.
function puntuarHorarios(perfil, oferta) {
  const dias = oferta.dias || [];

  if (oferta.tipo === "suplencia" && dias.length) {
    const disponibles = new Set(perfil.disponibilidad || []);
    if (disponibles.size === 0) {
      return sinDatos("dentista", "No has marcado ningún día disponible en tu calendario");
    }
    const cubiertos = dias.filter(d => disponibles.has(d));
    const puntuacion = cubiertos.length / dias.length;
    const detalle = cubiertos.length === dias.length
      ? `Estás disponible los ${dias.length} días de la suplencia`
      : `Estás disponible ${cubiertos.length} de los ${dias.length} días de la suplencia`;
    return { puntuacion, detalle, dias_coincidentes: cubiertos };
  }

  if (!oferta.jornada) {
    return sinDatos("clinica", "La clínica no ha indicado la jornada");
  }
  if (!perfil.jornada_buscada) {
    return sinDatos("dentista", "No has indicado la jornada que buscas en tu solicitud");
  }

  const coincide = oferta.jornada === perfil.jornada_buscada;
  return {
    puntuacion: coincide ? 1 : 0,
    detalle: coincide
      ? `Jornada ${oferta.jornada.toLowerCase()}, la que buscas`
      : `Jornada ${oferta.jornada.toLowerCase()}, y tú buscas ${perfil.jornada_buscada.toLowerCase()}`
  };
}

// --- Tecnología ---------------------------------------------------------------
// De todo el equipamiento que aprovecharían tus certificaciones, ¿cuánto tiene
// esta clínica? Puntúa lo que le sirve al dentista, no el catálogo entero: una
// clínica con un microscopio no es "mejor match" para un ortodoncista por tenerlo.
function puntuarTecnologia(perfil, oferta) {
  const equiposClinica = (oferta.equipamiento || []).filter(e => EQUIPAMIENTO_CATALOGO.includes(e));
  const certificaciones = perfil.certificaciones || [];

  const utiles = new Set();
  certificaciones.forEach(cert => {
    (AFINIDAD_TECNOLOGIA[cert] || []).forEach(equipo => utiles.add(equipo));
  });

  if (utiles.size === 0) {
    return sinDatos("dentista", "No has indicado certificaciones en tu perfil");
  }
  if (equiposClinica.length === 0) {
    return sinDatos("clinica", "La clínica no ha indicado su equipamiento");
  }

  const presentes = [...utiles].filter(e => equiposClinica.includes(e));
  const puntuacion = presentes.length / utiles.size;
  const detalle = presentes.length
    ? `La clínica tiene ${presentes.join(", ")}, que aprovechan tus certificaciones`
    : "La clínica no tiene el equipamiento que aprovechan tus certificaciones";

  return { puntuacion, detalle, equipos_coincidentes: presentes };
}

const PUNTUADORES = {
  salario: puntuarSalario,
  horarios: puntuarHorarios,
  tecnologia: puntuarTecnologia
};

/**
 * Calcula la compatibilidad entre un dentista y una oferta/suplencia.
 *
 * @param perfil  { salario_pretendido, jornada_buscada, disponibilidad: [YYYY-MM-DD], certificaciones: [string] }
 * @param oferta  { tipo, jornada, salario_min, salario_max, retribucion_tipo, dias: [YYYY-MM-DD], equipamiento: [string] }
 * @returns {{
 *   porcentaje: number|null,   // null si no hay cobertura suficiente para ser honesto
 *   suficiente: boolean,
 *   cobertura: number,         // fracción del peso total que se ha podido evaluar
 *   dimensiones: Array<{clave, etiqueta, peso, estado, puntuacion, detalle, falta}>
 * }}
 */
function calcularCompatibilidad(perfil = {}, oferta = {}) {
  let pesoEvaluado = 0;
  let pesoTotal = 0;
  let acumulado = 0;

  const dimensiones = DIMENSIONES.map(({ clave, etiqueta, peso }) => {
    pesoTotal += peso;
    const resultado = PUNTUADORES[clave](perfil, oferta);

    if (resultado.puntuacion === null) {
      return { clave, etiqueta, peso, estado: "sin_datos", puntuacion: null, detalle: resultado.detalle, falta: resultado.falta };
    }

    pesoEvaluado += peso;
    acumulado += resultado.puntuacion * peso;

    return {
      clave,
      etiqueta,
      peso,
      // Cada dimensión puede imponer su propio estado (ver puntuarSalario); si no,
      // se deriva de la puntuación con los umbrales genéricos.
      estado: resultado.estado || estadoDe(resultado.puntuacion),
      puntuacion: resultado.puntuacion,
      detalle: resultado.detalle,
      ...(resultado.dias_coincidentes ? { dias_coincidentes: resultado.dias_coincidentes } : {}),
      ...(resultado.equipos_coincidentes ? { equipos_coincidentes: resultado.equipos_coincidentes } : {})
    };
  });

  const cobertura = pesoTotal ? pesoEvaluado / pesoTotal : 0;
  const suficiente = cobertura >= COBERTURA_MINIMA;

  return {
    porcentaje: suficiente ? Math.round((acumulado / pesoEvaluado) * 100) : null,
    suficiente,
    cobertura,
    dimensiones
  };
}

module.exports = { calcularCompatibilidad, DIMENSIONES, AFINIDAD_TECNOLOGIA, COBERTURA_MINIMA };
