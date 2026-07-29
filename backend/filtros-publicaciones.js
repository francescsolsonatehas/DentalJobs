// Cláusulas WHERE del listado de publicaciones, compartidas por GET /publicaciones
// y por su exportación a CSV, para que el fichero exportado contenga exactamente
// las mismas filas que la vista.
//
// Asume que la consulta usa los alias `p` (publicaciones) y `u` (usuarios), y que
// ya filtra por `p.activo = 1`.
function construirFiltros(query = {}) {
  const {
    tipo, especialidad, ciudad, usuario_id, contrato, jornada,
    salarioMin, salarioMax, experienciaMin, q, equipamiento, retribucion, certificacion,
    radioKm, latCentro, lonCentro, fecha, fechaDesde, fechaHasta, disponibleUsuarioId,
    diaSemana, ids
  } = query;

  const clausulas = [];
  const params = [];

  // Lista explícita de publicaciones ("12,15,18"). La usan las notificaciones que
  // hablan de varias a la vez (p. ej. el digest de suplencias que encajan) para
  // llevar exactamente a esas y no a todo el listado. Se limita para que nadie pueda
  // pedir una consulta enorme.
  if (ids) {
    const lista = String(ids)
      .split(",")
      .map(n => parseInt(n, 10))
      .filter(Number.isInteger)
      .slice(0, 100);
    if (lista.length === 0) {
      clausulas.push("1 = 0"); // ids inválidos: no devolver nada, mejor que devolverlo todo
    } else {
      clausulas.push(`p.id IN (${lista.map(() => "?").join(",")})`);
      params.push(...lista);
    }
  }

  // Búsqueda por radio: si viene un centro geocodificado y un radio en km, se
  // filtra por un recuadro (bounding box) alrededor del centro en vez de por
  // coincidencia exacta de ciudad. El recuadro es una aproximación barata del
  // círculo, suficiente para "a X km de".
  const usarRadio = radioKm && latCentro != null && lonCentro != null;

  if (tipo) {
    clausulas.push("p.tipo = ?");
    params.push(tipo);
  }

  if (usuario_id) {
    clausulas.push("p.usuario_id = ?");
    params.push(usuario_id);
  }

  if (usarRadio) {
    const km = Math.min(Math.max(parseInt(radioKm) || 0, 1), 500);
    const lat = parseFloat(latCentro);
    const lon = parseFloat(lonCentro);
    const dLat = km / 111;
    const dLon = km / (111 * Math.cos((lat * Math.PI) / 180) || 1);
    clausulas.push("p.lat IS NOT NULL AND p.lat BETWEEN ? AND ? AND p.lon BETWEEN ? AND ?");
    params.push(lat - dLat, lat + dLat, lon - dLon, lon + dLon);
  } else if (ciudad) {
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

  // Filtro por fecha de suplencia: cubre un día concreto (fecha) o solapa con un
  // rango (fechaDesde/fechaHasta). Solo casan publicaciones con días en suplencia_dias
  // (las suplencias), así que activarlo excluye ofertas fijas y solicitudes.
  if (fecha) {
    clausulas.push("EXISTS (SELECT 1 FROM suplencia_dias sd WHERE sd.publicacion_id = p.id AND sd.fecha = ?)");
    params.push(String(fecha).slice(0, 10));
  } else if (fechaDesde || fechaHasta) {
    clausulas.push("EXISTS (SELECT 1 FROM suplencia_dias sd WHERE sd.publicacion_id = p.id AND sd.fecha BETWEEN ? AND ?)");
    params.push(fechaDesde ? String(fechaDesde).slice(0, 10) : "0000-01-01", fechaHasta ? String(fechaHasta).slice(0, 10) : "9999-12-31");
  }

  // Colaboraciones que piden un día de la semana concreto (1=lunes..6=sábado).
  if (diaSemana) {
    clausulas.push("EXISTS (SELECT 1 FROM colaboracion_dias cd WHERE cd.publicacion_id = p.id AND cd.dia_semana = ?)");
    params.push(parseInt(diaSemana));
  }

  // "Solo las que encajan con mi disponibilidad": suplencias con algún día que el
  // dentista (disponibleUsuarioId) tiene marcado como disponible en su calendario, o
  // colaboraciones con algún día de la semana que tiene marcado en su disponibilidad
  // semanal recurrente (con turno compatible: "ambos" cubre pedir mañana, tarde o ambos).
  if (disponibleUsuarioId) {
    clausulas.push(`(
      EXISTS (SELECT 1 FROM suplencia_dias sd JOIN disponibilidad_dentista dd ON dd.fecha = sd.fecha WHERE sd.publicacion_id = p.id AND dd.usuario_id = ?)
      OR EXISTS (
        SELECT 1 FROM colaboracion_dias cd
        JOIN disponibilidad_semanal_dentista dsd ON dsd.dia_semana = cd.dia_semana AND (dsd.turno = 'ambos' OR dsd.turno = cd.turno)
        WHERE cd.publicacion_id = p.id AND dsd.usuario_id = ?
      )
    )`);
    params.push(disponibleUsuarioId, disponibleUsuarioId);
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
