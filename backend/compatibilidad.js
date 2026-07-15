// Motor de compatibilidad dentista ↔ oferta/suplencia.
//
// Ocho dimensiones, de dos naturalezas distintas.
//
// Derivadas de datos que YA existen en la plataforma (Fase 1), sin preguntar nada:
//
//   - Nivel salarial: lo que ofrece la publicación vs. lo que pide el dentista
//     en su solicitud activa (salario_min).
//   - Horarios: en suplencias, solape de días con la disponibilidad del dentista;
//     en ofertas fijas, coincidencia de jornada con la de su solicitud.
//   - Tecnología: equipamiento de la clínica vs. el que aprovechan las
//     certificaciones del dentista (ver AFINIDAD_TECNOLOGIA).
//
// Preguntadas en el cuestionario del perfil (Fase 2), porque no se pueden derivar
// de nada: filosofía de trabajo, tipo de pacientes, ambiente, formación continua y
// objetivos profesionales (ver DIMENSIONES_CUESTIONARIO).
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

// Las cinco dimensiones del cuestionario (Fase 2). A diferencia de las tres
// primeras, estas no se pueden derivar de nada: hay que preguntarlas. Se
// preguntan UNA vez en el perfil, a los dos lados, con las mismas opciones:
//
//   - el dentista responde lo que busca,
//   - la clínica responde lo que es/ofrece,
//
// y las ofertas de una clínica heredan sus respuestas (filosofía, ambiente o
// tipo de pacientes son rasgos de la clínica, no de la vacante concreta: pedirlos
// en cada publicación sería fricción por nada y acabarían vacíos).
//
// Dos tipos de comparación:
//   - "eje": opción única sobre un eje ordenado. Puntúa por cercanía entre las
//     posiciones elegidas, no por igualdad: estar a un paso no es lo mismo que
//     estar en el extremo opuesto.
//   - "multi": varias opciones. Puntúa qué fracción de LO QUE EL DENTISTA BUSCA
//     cubre la clínica (no al revés: que la clínica haga cosas que al dentista no
//     le interesan no le resta, simplemente no le suma).
const DIMENSIONES_CUESTIONARIO = [
  {
    clave: "filosofia",
    etiqueta: "Filosofía de trabajo",
    peso: 3,
    tipo: "eje",
    pregunta_dentista: "¿Cómo te gusta trabajar?",
    pregunta_clinica: "¿Cómo trabajáis en la clínica?",
    opciones: [
      "Mínimamente invasiva: preservar todo lo posible",
      "Equilibrada, según cada caso",
      "Resolutiva: tratamientos completos y rápidos"
    ]
  },
  {
    clave: "pacientes",
    etiqueta: "Tipo de pacientes",
    peso: 2,
    tipo: "multi",
    pregunta_dentista: "¿Con qué pacientes quieres trabajar?",
    pregunta_clinica: "¿Qué pacientes atendéis principalmente?",
    opciones: [
      "Familias y niños",
      "Adultos, odontología general",
      "Estética",
      "Implantología y pacientes mayores",
      "Ortodoncia",
      "Urgencias",
      "Pacientes de aseguradora"
    ]
  },
  {
    clave: "ambiente",
    etiqueta: "Ambiente de trabajo",
    peso: 2,
    tipo: "eje",
    pregunta_dentista: "¿En qué ambiente quieres trabajar?",
    pregunta_clinica: "¿Cómo es el ambiente de la clínica?",
    opciones: [
      "Clínica pequeña y familiar",
      "Equipo mediano",
      "Grupo grande y estructurado"
    ]
  },
  {
    clave: "formacion_continua",
    etiqueta: "Formación continua",
    peso: 2,
    tipo: "eje",
    pregunta_dentista: "¿Cuánto te importa la formación continua?",
    pregunta_clinica: "¿Cuánta formación continua ofrecéis?",
    opciones: [
      "No es una prioridad",
      "Cursos puntuales",
      "Formación pagada y frecuente"
    ]
  },
  {
    clave: "objetivos",
    etiqueta: "Objetivos profesionales",
    peso: 2,
    tipo: "multi",
    pregunta_dentista: "¿Qué buscas en tu carrera ahora mismo?",
    pregunta_clinica: "¿Qué podéis ofrecer a quien se incorpore?",
    opciones: [
      "Estabilidad a largo plazo",
      "Crecer hacia dirección clínica",
      "Especializarme",
      "Casos complejos",
      "Conciliación y flexibilidad",
      "Maximizar ingresos"
    ]
  }
];

// Peso relativo de cada dimensión. Al normalizar por el peso realmente evaluado,
// estos números son proporciones, no porcentajes: subir uno no obliga a bajar otro.
const DIMENSIONES = [
  { clave: "salario", etiqueta: "Nivel salarial", peso: 3 },
  { clave: "horarios", etiqueta: "Horarios", peso: 3 },
  { clave: "tecnologia", etiqueta: "Tecnología", peso: 2 },
  ...DIMENSIONES_CUESTIONARIO
];

// Fracción mínima del peso total que hay que poder evaluar para enseñar un %.
//
// El listón está donde está por una razón concreta: salario + horarios (las dos
// más pesadas, 6 de los 19 puntos = 0,32) son la base mínima honesta para hablar
// de compatibilidad, y se calculan sin preguntarle nada a nadie. Una dimensión
// suelta (3 de 19 = 0,16 como mucho) nunca lo es.
//
// Cuidado al tocar los pesos o al añadir dimensiones: subir este número por encima
// de 0,32 dejaría sin porcentaje a las ofertas que solo tienen salario y jornada
// (el equipamiento es opcional y muchas no lo rellenan), y subirlo por encima de
// 0,42 se lo quitaría incluso a las que tienen las tres dimensiones derivadas,
// que es justo lo que veía el usuario antes de existir el cuestionario.
const COBERTURA_MINIMA = 0.3;

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

// --- Dimensiones del cuestionario (Fase 2) ------------------------------------
// Las respuestas llegan en `perfil.preferencias` y `oferta.preferencias`, ambas
// con la forma { clave: valor }, donde valor es un string ("eje") o un array de
// strings ("multi"). Una respuesta que no esté en el catálogo se ignora: no se
// puntúa contra basura.

// Eje ordinal: la nota cae con la distancia entre las posiciones elegidas.
// Con 3 opciones: misma posición = 1, a un paso = 0,5, extremos opuestos = 0.
function puntuarEje(dim, valorDentista, valorClinica) {
  const i = dim.opciones.indexOf(valorDentista);
  const j = dim.opciones.indexOf(valorClinica);
  if (i === -1 || j === -1) return null;

  const pasos = dim.opciones.length - 1;
  const puntuacion = pasos === 0 ? 1 : 1 - Math.abs(i - j) / pasos;
  const detalle = i === j
    ? `Coincidís: ${valorClinica.toLowerCase()}`
    : `Tú buscas «${valorDentista.toLowerCase()}» y la clínica es «${valorClinica.toLowerCase()}»`;

  return { puntuacion, detalle };
}

// Multiselección: qué fracción de lo que busca el dentista cubre la clínica.
// Deliberadamente asimétrico (no es Jaccard): que la clínica ofrezca cosas que al
// dentista no le interesan no debe penalizarla, solo no le suma.
function puntuarMulti(dim, valoresDentista, valoresClinica) {
  const busca = (valoresDentista || []).filter(v => dim.opciones.includes(v));
  const ofrece = (valoresClinica || []).filter(v => dim.opciones.includes(v));
  if (busca.length === 0 || ofrece.length === 0) return null;

  const cubiertos = busca.filter(v => ofrece.includes(v));
  const puntuacion = cubiertos.length / busca.length;
  const detalle = cubiertos.length
    ? `La clínica cubre ${cubiertos.length} de las ${busca.length} que buscas: ${cubiertos.join(", ").toLowerCase()}`
    : `La clínica no cubre ninguna de las ${busca.length} que buscas`;

  return { puntuacion, detalle, coincidencias: cubiertos };
}

// Puntuador de una dimensión del cuestionario: resuelve qué lado tiene el hueco
// cuando falta una respuesta, para poder pedírsela a quien toca.
function puntuarCuestionario(dim, perfil, oferta) {
  const respuestaDentista = (perfil.preferencias || {})[dim.clave];
  const respuestaClinica = (oferta.preferencias || {})[dim.clave];

  const vacia = r => r == null || r === "" || (Array.isArray(r) && r.length === 0);
  const faltaDentista = vacia(respuestaDentista);
  const faltaClinica = vacia(respuestaClinica);

  if (faltaDentista || faltaClinica) {
    const falta = faltaDentista && faltaClinica ? "ambos" : (faltaDentista ? "dentista" : "clinica");
    const detalle = faltaDentista && faltaClinica
      ? "Ni tú ni la clínica habéis respondido a esta pregunta"
      : faltaDentista
        ? "No has respondido a esta pregunta en tu perfil"
        : "La clínica no ha respondido a esta pregunta";
    return sinDatos(falta, detalle);
  }

  const resultado = dim.tipo === "eje"
    ? puntuarEje(dim, respuestaDentista, respuestaClinica)
    : puntuarMulti(dim, respuestaDentista, respuestaClinica);

  // Respuestas fuera del catálogo (p. ej. tras cambiar las opciones): se tratan
  // como si no estuvieran, en vez de puntuar 0 y mentir.
  return resultado || sinDatos("ambos", "Las respuestas guardadas ya no están en el catálogo de opciones");
}

const PUNTUADORES = {
  salario: puntuarSalario,
  horarios: puntuarHorarios,
  tecnologia: puntuarTecnologia
};

/**
 * Calcula la compatibilidad entre un dentista y una oferta/suplencia.
 *
 * @param perfil  { salario_pretendido, jornada_buscada, disponibilidad: [YYYY-MM-DD], certificaciones: [string], preferencias: {clave: valor} }
 * @param oferta  { tipo, jornada, salario_min, salario_max, retribucion_tipo, dias: [YYYY-MM-DD], equipamiento: [string], preferencias: {clave: valor} }
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

  const dimensiones = DIMENSIONES.map(dim => {
    const { clave, etiqueta, peso } = dim;
    pesoTotal += peso;
    // Las tres primeras dimensiones tienen puntuador propio (derivan el dato de la
    // plataforma); las del cuestionario comparten los dos genéricos por tipo.
    const resultado = PUNTUADORES[clave]
      ? PUNTUADORES[clave](perfil, oferta)
      : puntuarCuestionario(dim, perfil, oferta);

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
      ...(resultado.equipos_coincidentes ? { equipos_coincidentes: resultado.equipos_coincidentes } : {}),
      ...(resultado.coincidencias ? { coincidencias: resultado.coincidencias } : {})
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

module.exports = {
  calcularCompatibilidad,
  DIMENSIONES,
  DIMENSIONES_CUESTIONARIO,
  AFINIDAD_TECNOLOGIA,
  COBERTURA_MINIMA
};
