// Etiquetas legibles compartidas por los avisos por email y las exportaciones a CSV.

const ETIQUETAS_ESTADO = {
  pendiente: "Pendiente",
  vista: "CV visto",
  en_proceso: "En proceso",
  entrevista: "Entrevista",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  retirada: "Retirada"
};

// Catálogos fijos (sin tabla propia, como contrato/jornada). Los comparte el
// servidor (validación al publicar) con el motor de compatibilidad.
const EQUIPAMIENTO_CATALOGO = ["CBCT / TAC 3D", "CAD-CAM", "Microscopio", "Escáner intraoral", "Láser dental", "Sedación consciente"];
const CERTIFICACIONES_CATALOGO = ["Invisalign", "Implantología avanzada", "Ortodoncia lingual", "Estética dental avanzada", "Sedación consciente", "Cirugía guiada"];

module.exports = { ETIQUETAS_ESTADO, EQUIPAMIENTO_CATALOGO, CERTIFICACIONES_CATALOGO };
