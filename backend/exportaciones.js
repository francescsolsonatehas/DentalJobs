// Exportación a CSV de las vistas del listado principal.
//
// El fichero se genera con separador ';' y BOM UTF-8, así Excel en español lo abre
// directamente con las columnas ya separadas (sin pasar por el asistente de importación).
//
// Cada vista devuelve las mismas filas que muestra la interfaz: las que dependen de los
// filtros del listado reciben la misma query string que usa la pantalla.

const { construirFiltros } = require("./filtros-publicaciones");
const { ETIQUETAS_ESTADO } = require("./catalogos");
const { geocodificarCiudad, distanciaKm } = require("./municipios-coords");

/* ===========================
   🔹 SERIALIZACIÓN
=========================== */

function escapar(valor) {
  return `"${String(valor ?? "").replace(/"/g, '""')}"`;
}

function construirCsv(columnas, filas) {
  const lineas = [columnas.map(escapar).join(";")];
  filas.forEach(fila => lineas.push(fila.map(escapar).join(";")));
  return "﻿" + lineas.join("\n");
}

function todos(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, filas) => (err ? reject(err) : resolve(filas || [])));
  });
}

/* ===========================
   🔹 ETIQUETAS Y FORMATO
=========================== */

const ETIQUETAS_TIPO = {
  oferta: "Oferta de empleo",
  solicitud: "Solicitud de empleo",
  suplencia: "Suplencia",
  colaboracion: "Colaboración"
};

const tipoPublicacion = (tipo) => ETIQUETAS_TIPO[tipo] || tipo || "";
const rol = (tipo) => (tipo === "clinica" ? "Clínica" : "Dentista");
const estado = (valor) => ETIQUETAS_ESTADO[valor] || valor || "";
const siNo = (valor) => (valor ? "Sí" : "No");

function salario(f) {
  if (f.salario_min && f.salario_max) return `${f.salario_min} - ${f.salario_max} €`;
  if (f.salario_min) return `Desde ${f.salario_min} €`;
  if (f.salario_max) return `Hasta ${f.salario_max} €`;
  return f.salario || "";
}

function retribucion(f) {
  if (f.retribucion_tipo !== "porcentaje") return "Fija";
  return f.retribucion_porcentaje ? `Porcentaje (${f.retribucion_porcentaje}%)` : "Porcentaje";
}

// Días de la semana de una colaboración, en texto ("Lunes (mañana), Miércoles (mañana
// y tarde)"), a partir del "1:manana,3:ambos" que arma DIAS_SEMANA_PUBLICACION.
const NOMBRES_DIA_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const NOMBRES_TURNO = { manana: "mañana", tarde: "tarde", ambos: "mañana y tarde" };
function diasSemana(f) {
  if (!f.dias_semana_raw) return "";
  return f.dias_semana_raw.split(",").map(par => {
    const [dia, turno] = par.split(":");
    return `${NOMBRES_DIA_SEMANA[parseInt(dia, 10) - 1] || dia} (${NOMBRES_TURNO[turno] || turno})`;
  }).join(", ");
}

/* ===========================
   🔹 FRAGMENTOS DE CONSULTA
=========================== */

const ESPECIALIDADES_PUBLICACION = `(SELECT GROUP_CONCAT(e.nombre, ', ')
   FROM publicacion_especialidades pe INNER JOIN especialidades e ON e.id = pe.especialidad_id
   WHERE pe.publicacion_id = p.id) AS especialidades`;

const EQUIPAMIENTO_PUBLICACION = `(SELECT GROUP_CONCAT(pq.equipo, ', ')
   FROM publicacion_equipamiento pq WHERE pq.publicacion_id = p.id) AS equipamiento`;

// "1:manana,3:ambos" (día:turno separados por coma); se formatea a texto con
// diasSemana() más abajo. Solo tiene filas para publicaciones de tipo 'colaboracion'.
const DIAS_SEMANA_PUBLICACION = `(SELECT GROUP_CONCAT(cd.dia_semana || ':' || cd.turno, ',')
   FROM colaboracion_dias cd WHERE cd.publicacion_id = p.id) AS dias_semana_raw`;

const ESPECIALIDADES_USUARIO = `(SELECT GROUP_CONCAT(e.nombre, ', ')
   FROM usuario_especialidades ue INNER JOIN especialidades e ON e.id = ue.especialidad_id
   WHERE ue.usuario_id = u.id) AS especialidades`;

// Orden por ciudad y, dentro de cada una, por especialidad: el mismo del listado
// cuando la clínica busca publicaciones de dentistas. Las que no tienen ciudad, al final.
const ORDEN_POR_CIUDAD = `ORDER BY (p.ciudad IS NULL OR TRIM(p.ciudad) = '') ASC,
                                   p.ciudad COLLATE NOCASE ASC,
                                   especialidades COLLATE NOCASE ASC,
                                   p.creado_en DESC`;

// Publicaciones ajenas: mismos campos de contacto que expone GET /publicaciones
function consultarPublicaciones(db, query, orden = "ORDER BY p.creado_en DESC") {
  // Mismo tratamiento del radio que GET /publicaciones: la ciudad se geocodifica como
  // centro y manda la distancia. Si no se reconoce, se ignora el radio y se filtra por
  // el nombre de la ciudad.
  const filtrosQuery = { ...query };
  if (filtrosQuery.radioKm && filtrosQuery.ciudad) {
    const centro = geocodificarCiudad(filtrosQuery.ciudad);
    if (centro) {
      filtrosQuery.latCentro = centro.lat;
      filtrosQuery.lonCentro = centro.lon;
    } else {
      delete filtrosQuery.radioKm;
    }
  }

  const filtros = construirFiltros(filtrosQuery);
  return todos(
    db,
    `SELECT p.*, u.nombre AS autor, u.email AS autor_email, u.telefono AS autor_telefono, u.tipo AS autor_tipo,
            ${ESPECIALIDADES_PUBLICACION}, ${EQUIPAMIENTO_PUBLICACION}, ${DIAS_SEMANA_PUBLICACION}
     FROM publicaciones p LEFT JOIN usuarios u ON p.usuario_id = u.id
     WHERE p.activo = 1${filtros.sql}
     ${orden}`,
    filtros.params
  );
}

// Postulaciones: 'recibidas' (sobre mis publicaciones) o 'enviadas' (las que he hecho yo)
function consultarPostulaciones(db, usuarioId, sentido) {
  const esRecibidas = sentido === "recibidas";
  const union = esRecibidas
    ? "INNER JOIN usuarios u ON c.usuario_id = u.id WHERE p.usuario_id = ?"
    : "INNER JOIN usuarios u ON p.usuario_id = u.id WHERE c.usuario_id = ?";

  return todos(
    db,
    `SELECT c.creado_en, c.actualizado_en, c.estado, c.mensaje,
            p.tipo AS publicacion_tipo, p.ciudad AS publicacion_ciudad,
            p.contrato, p.jornada, p.salario, p.salario_min, p.salario_max,
            u.nombre AS contraparte_nombre, u.email AS contraparte_email, u.ciudad AS contraparte_ciudad
     FROM candidaturas c
     INNER JOIN publicaciones p ON c.publicacion_id = p.id
     ${union}
     ORDER BY c.creado_en DESC`,
    [usuarioId]
  );
}

const COLUMNAS_POSTULACIONES = (etiquetaContraparte) => [
  "Fecha de postulación", "Estado", "Última actualización",
  "Publicación", "Ciudad de la publicación",
  etiquetaContraparte, "Email", "Ciudad",
  "Contrato", "Jornada", "Salario", "Mensaje"
];

const filaPostulacion = (f) => [
  f.creado_en, estado(f.estado), f.actualizado_en,
  tipoPublicacion(f.publicacion_tipo), f.publicacion_ciudad,
  f.contraparte_nombre, f.contraparte_email, f.contraparte_ciudad,
  f.contrato, f.jornada, salario(f), f.mensaje
];

/* ===========================
   🔹 VISTAS EXPORTABLES
=========================== */

// `soloPara` restringe la vista a un tipo de cuenta; el resto se adaptan al rol de quien exporta.
const VISTAS = {
  // Publicaciones a dentistas (clínicas) / Publicaciones a clínicas (dentistas)
  "publicaciones": {
    archivo: (usuario) => (usuario.tipo === "clinica" ? "publicaciones-de-dentistas" : "publicaciones-de-clinicas"),
    async consultar(db, usuario, query) {
      // El dentista ve, por defecto, oferta+suplencia+colaboración juntas (mismo tipo
      // combinado que el listado de esta vista); si acotó con el filtro de tipo, se
      // respeta ese único tipo (query.tipo llega ya con el valor elegido).
      const tipo = usuario.tipo === "clinica" ? "solicitud" : (query.tipo || "oferta,suplencia,colaboracion");
      // Mismo orden que el listado de esta vista: por ciudad y luego por especialidad
      const filas = await consultarPublicaciones(db, { ...query, tipo, usuario_id: undefined }, ORDEN_POR_CIUDAD);
      return {
        // Desde/Hasta/Urgente (suplencia) y Días de la semana (colaboración) van vacíos
        // en las filas de oferta: esta vista puede traer los tres tipos mezclados.
        columnas: ["Fecha de publicación", "Tipo", "Publicado por", "Email", "Teléfono", "Ciudad", "Provincia",
                   "Contrato", "Jornada", "Salario", "Retribución", "Experiencia mínima (años)",
                   "Desde", "Hasta", "Urgente", "Días de la semana",
                   "Especialidades", "Equipamiento", "Descripción"],
        filas: filas.map(f => [
          f.creado_en, tipoPublicacion(f.tipo), f.autor, f.autor_email, f.autor_telefono, f.ciudad, f.provincia,
          f.contrato, f.jornada, salario(f), retribucion(f), f.experiencia_minima,
          f.fecha_desde, f.fecha_hasta, f.tipo === "suplencia" ? siNo(f.urgente) : "", diasSemana(f),
          f.especialidades, f.equipamiento, f.descripcion
        ])
      };
    }
  },

  // Suplencias y turnos sueltos (solo dentistas navegan esta vista)
  "suplencias": {
    soloPara: "dentista",
    archivo: () => "suplencias",
    async consultar(db, usuario, query) {
      const filas = await consultarPublicaciones(db, { ...query, tipo: "suplencia", usuario_id: undefined });
      return {
        columnas: ["Fecha de publicación", "Publicado por", "Email", "Teléfono", "Ciudad", "Provincia",
                   "Desde", "Hasta", "Urgente", "Jornada", "Salario", "Retribución",
                   "Especialidades", "Equipamiento", "Descripción"],
        filas: filas.map(f => [
          f.creado_en, f.autor, f.autor_email, f.autor_telefono, f.ciudad, f.provincia,
          f.fecha_desde, f.fecha_hasta, siNo(f.urgente), f.jornada, salario(f), retribucion(f),
          f.especialidades, f.equipamiento, f.descripcion
        ])
      };
    }
  },

  // Mis publicaciones: las ofertas/suplencias/colaboraciones de una clínica, o las
  // solicitudes/colaboraciones de un dentista
  "mis-publicaciones": {
    archivo: () => "mis-publicaciones",
    async consultar(db, usuario, query) {
      const filtros = construirFiltros({ ...query, usuario_id: usuario.id });
      const filas = await todos(
        db,
        `SELECT p.*, ${ESPECIALIDADES_PUBLICACION}, ${EQUIPAMIENTO_PUBLICACION}, ${DIAS_SEMANA_PUBLICACION},
                (SELECT COUNT(*) FROM candidaturas c WHERE c.publicacion_id = p.id) AS postulaciones
         FROM publicaciones p LEFT JOIN usuarios u ON p.usuario_id = u.id
         WHERE p.activo = 1${filtros.sql}
         ORDER BY p.creado_en DESC`,
        filtros.params
      );
      return {
        columnas: ["Fecha de publicación", "Tipo", "Ciudad", "Provincia", "Contrato", "Jornada", "Salario",
                   "Retribución", "Experiencia mínima (años)", "Desde", "Hasta", "Urgente", "Días de la semana",
                   "Especialidades", "Equipamiento", "Vistas", "Postulaciones recibidas", "Descripción"],
        filas: filas.map(f => [
          f.creado_en, tipoPublicacion(f.tipo), f.ciudad, f.provincia, f.contrato, f.jornada, salario(f),
          retribucion(f), f.experiencia_minima, f.fecha_desde, f.fecha_hasta, siNo(f.urgente), diasSemana(f),
          f.especialidades, f.equipamiento, f.vistas || 0, f.postulaciones, f.descripcion
        ])
      };
    }
  },

  // Colaboraciones (las ven y navegan los dos roles, a diferencia de suplencias)
  "colaboraciones": {
    archivo: () => "colaboraciones",
    async consultar(db, usuario, query) {
      const filas = await consultarPublicaciones(db, { ...query, tipo: "colaboracion", usuario_id: undefined });
      return {
        columnas: ["Fecha de publicación", "Publicado por", "Tipo de cuenta", "Email", "Teléfono", "Ciudad", "Provincia",
                   "Días de la semana", "Retribución", "Salario",
                   "Especialidades", "Equipamiento", "Descripción"],
        filas: filas.map(f => [
          f.creado_en, f.autor, rol(f.autor_tipo), f.autor_email, f.autor_telefono, f.ciudad, f.provincia,
          diasSemana(f), retribucion(f), salario(f),
          f.especialidades, f.equipamiento, f.descripcion
        ])
      };
    }
  },

  // Perfiles de dentistas (clínicas) / Perfiles de clínicas (dentistas).
  // No incluye email ni teléfono: GET /perfiles tampoco los expone.
  "perfiles": {
    archivo: (usuario) => (usuario.tipo === "clinica" ? "perfiles-de-dentistas" : "perfiles-de-clinicas"),
    async consultar(db, usuario, query) {
      const tipo = usuario.tipo === "clinica" ? "dentista" : "clinica";
      let sql = `SELECT u.nombre, u.tipo, u.ciudad, u.provincia, u.descripcion, u.anyos_experiencia,
                        u.creado_en, ${ESPECIALIDADES_USUARIO}
                 FROM usuarios u
                 WHERE u.tipo = ? AND u.nombre != 'Usuario eliminado'`;
      const params = [tipo];

      // Búsqueda por radio, igual que en GET /perfiles: con radio manda la distancia al
      // centro, no que coincida el nombre de la ciudad, así que no se filtra por ella.
      const centroRadio = (query.radioKm && query.ciudad) ? geocodificarCiudad(query.ciudad) : null;
      const usarRadio = !!centroRadio;

      if (query.ciudad && !usarRadio) { sql += " AND u.ciudad LIKE ?"; params.push(`%${query.ciudad}%`); }
      if (query.provincia) { sql += " AND u.provincia LIKE ?"; params.push(`%${query.provincia}%`); }
      if (query.especialidad) {
        sql += " AND EXISTS (SELECT 1 FROM usuario_especialidades ue WHERE ue.usuario_id = u.id AND ue.especialidad_id = ?)";
        params.push(query.especialidad);
      }
      if (query.q) {
        sql += " AND (u.nombre LIKE ? OR u.descripcion LIKE ? OR u.ciudad LIKE ?)";
        params.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
      }
      // Mismo orden que el listado: por ciudad y, dentro de ella, por especialidad.
      // Los perfiles sin ciudad van al final.
      sql += ` ORDER BY (u.ciudad IS NULL OR TRIM(u.ciudad) = '') ASC,
                        u.ciudad COLLATE NOCASE ASC,
                        especialidades COLLATE NOCASE ASC`;

      let filas = await todos(db, sql, params);

      if (usarRadio) {
        const r = parseFloat(query.radioKm);
        filas = filas.filter(f => {
          const c = f.ciudad ? geocodificarCiudad(f.ciudad) : null;
          return c && distanciaKm(centroRadio.lat, centroRadio.lon, c.lat, c.lon) <= r;
        });
      }

      return {
        columnas: ["Nombre", "Tipo", "Ciudad", "Provincia", "Años de experiencia",
                   "Especialidades", "Alta en la plataforma", "Descripción"],
        filas: filas.map(f => [
          f.nombre, rol(f.tipo), f.ciudad, f.provincia, f.anyos_experiencia,
          f.especialidades, f.creado_en, f.descripcion
        ])
      };
    }
  },

  // Mis postulaciones: las que ha enviado quien exporta (a ofertas/suplencias si es
  // dentista, a solicitudes de dentistas si es clínica).
  "mis-postulaciones": {
    archivo: () => "mis-postulaciones",
    async consultar(db, usuario) {
      const filas = await consultarPostulaciones(db, usuario.id, "enviadas");
      return { columnas: COLUMNAS_POSTULACIONES("Publicado por"), filas: filas.map(filaPostulacion) };
    }
  },

  // Postulaciones recibidas sobre mis publicaciones (la usa también /candidaturas/export.csv)
  "postulaciones-recibidas": {
    archivo: () => "postulaciones-recibidas",
    async consultar(db, usuario) {
      const filas = await consultarPostulaciones(db, usuario.id, "recibidas");
      return { columnas: COLUMNAS_POSTULACIONES("Candidato"), filas: filas.map(filaPostulacion) };
    }
  }
};

function errorHttp(mensaje, status) {
  const error = new Error(mensaje);
  error.status = status;
  return error;
}

// Devuelve { archivo, csv } para la vista pedida, o lanza un error con `status`.
async function generarCsv(db, usuario, vista, query = {}) {
  const definicion = VISTAS[vista];
  if (!definicion) throw errorHttp("Vista no exportable", 400);
  if (definicion.soloPara && definicion.soloPara !== usuario.tipo) {
    throw errorHttp("Esta vista no está disponible para tu tipo de cuenta", 403);
  }

  const { columnas, filas } = await definicion.consultar(db, usuario, query);
  const fecha = new Date().toISOString().slice(0, 10);

  return {
    archivo: `${definicion.archivo(usuario)}-${fecha}.csv`,
    csv: construirCsv(columnas, filas)
  };
}

module.exports = { generarCsv, construirCsv, VISTAS };
