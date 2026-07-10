// Cláusulas WHERE del listado de publicaciones, compartidas por GET /publicaciones
// y por su exportación a CSV, para que el fichero exportado contenga exactamente
// las mismas filas que la vista.
//
// Asume que la consulta usa los alias `p` (publicaciones) y `u` (usuarios), y que
// ya filtra por `p.activo = 1`.
function construirFiltros(query = {}) {
  const {
    tipo, especialidad, ciudad, usuario_id, contrato, jornada,
    salarioMin, salarioMax, experienciaMin, q, equipamiento, retribucion, certificacion
  } = query;

  const clausulas = [];
  const params = [];

  if (tipo) {
    clausulas.push("p.tipo = ?");
    params.push(tipo);
  }

  if (usuario_id) {
    clausulas.push("p.usuario_id = ?");
    params.push(usuario_id);
  }

  if (ciudad) {
    clausulas.push("p.ciudad LIKE ?");
    params.push(`%${ciudad}%`);
  }

  if (contrato) {
    clausulas.push("p.contrato = ?");
    params.push(contrato);
  }

  if (jornada) {
    clausulas.push("p.jornada = ?");
    params.push(jornada);
  }

  if (especialidad) {
    clausulas.push("EXISTS (SELECT 1 FROM publicacion_especialidades pe WHERE pe.publicacion_id = p.id AND pe.especialidad_id = ?)");
    params.push(especialidad);
  }

  if (salarioMin) {
    clausulas.push("p.salario_min >= ?");
    params.push(parseInt(salarioMin));
  }

  if (salarioMax) {
    clausulas.push("p.salario_min <= ?");
    params.push(parseInt(salarioMax));
  }

  // Búsqueda de texto libre sobre descripción, ciudad y nombre del publicante
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    clausulas.push("(p.descripcion LIKE ? OR p.ciudad LIKE ? OR p.nombre_contacto LIKE ? OR u.nombre LIKE ?)");
    params.push(like, like, like, like);
  }

  if (equipamiento) {
    clausulas.push("EXISTS (SELECT 1 FROM publicacion_equipamiento pq WHERE pq.publicacion_id = p.id AND pq.equipo = ?)");
    params.push(equipamiento);
  }

  if (retribucion) {
    clausulas.push("p.retribucion_tipo = ?");
    params.push(retribucion);
  }

  // Certificación del dentista: solo tiene sentido al buscar solicitudes (perfiles de dentistas)
  if (certificacion) {
    clausulas.push("EXISTS (SELECT 1 FROM certificaciones cert WHERE cert.usuario_id = p.usuario_id AND cert.certificacion = ?)");
    params.push(certificacion);
  }

  if (experienciaMin) {
    if (tipo === "solicitud") {
      // Dentistas con al menos esta experiencia
      clausulas.push("p.experiencia_minima >= ?");
    } else {
      // Ofertas que exigen como máximo esta experiencia (el dentista sí califica)
      clausulas.push("p.experiencia_minima <= ?");
    }
    params.push(parseInt(experienciaMin));
  }

  return { sql: clausulas.length ? " AND " + clausulas.join(" AND ") : "", params };
}

module.exports = { construirFiltros };
