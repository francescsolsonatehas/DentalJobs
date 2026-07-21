const { crearDb } = require("./libsql-adapter");

const db = crearDb();

// Funde varias especialidades en una sola. La primera de `origenes` que exista se
// renombra a `destino` (así conserva su id y todo lo que ya apunta a ella); las
// demás se absorben moviendo sus referencias a esa y borrando la fila sobrante.
//
// Las tablas puente tienen UNIQUE(x, especialidad_id): si un usuario o publicación
// ya tenía las dos especialidades que se funden, mover una chocaría con la otra, así
// que se usa UPDATE OR IGNORE y luego se limpian las filas que no se pudieron mover.
// La trayectoria guarda la especialidad como texto (nombre), no como id: se migra
// aparte por nombre.
function fusionarEspecialidades(db, origenes, destino) {
  // Punto de anclaje: el primer origen que exista pasa a llamarse `destino`.
  db.run(
    `UPDATE especialidades SET nombre = ?
      WHERE id = (SELECT MIN(id) FROM especialidades WHERE nombre IN (${origenes.map(() => "?").join(",")}))`,
    [destino, ...origenes],
    () => {
      db.get("SELECT id FROM especialidades WHERE nombre = ?", [destino], (err, fila) => {
        if (err || !fila) return;
        const destinoId = fila.id;

        // Cada especialidad que aún tenga un nombre de origen se absorbe en el destino
        origenes.forEach(nombreOrigen => {
          db.get("SELECT id FROM especialidades WHERE nombre = ?", [nombreOrigen], (e2, orig) => {
            if (e2 || !orig) return;
            const origenId = orig.id;

            db.run("UPDATE OR IGNORE usuario_especialidades SET especialidad_id = ? WHERE especialidad_id = ?", [destinoId, origenId], () => {
              db.run("DELETE FROM usuario_especialidades WHERE especialidad_id = ?", [origenId], () => {});
            });
            db.run("UPDATE OR IGNORE publicacion_especialidades SET especialidad_id = ? WHERE especialidad_id = ?", [destinoId, origenId], () => {
              db.run("DELETE FROM publicacion_especialidades WHERE especialidad_id = ?", [origenId], () => {});
            });
            // La especialidad principal de una publicación no tiene UNIQUE: se mueve directa
            db.run("UPDATE publicaciones SET especialidad_id = ? WHERE especialidad_id = ?", [destinoId, origenId], () => {
              db.run("DELETE FROM especialidades WHERE id = ?", [origenId], () => {});
            });
          });
        });
      });
    }
  );

  // La trayectoria guarda el nombre en texto: se reetiqueta directamente
  const placeholders = origenes.map(() => "?").join(",");
  db.run(
    `UPDATE experiencia_laboral SET especialidad = ? WHERE especialidad IN (${placeholders})`,
    [destino, ...origenes],
    () => {}
  );
}

db.serialize(() => {
  // En Turso (remoto) los PRAGMA pueden no estar soportados: ignorar el error
  db.run("PRAGMA foreign_keys = ON", () => {});

  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      tipo TEXT NOT NULL,
      telefono TEXT,
      direccion TEXT,
      codigo_postal TEXT,
      pais TEXT,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS especialidades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS publicaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      descripcion TEXT,
      ciudad TEXT NOT NULL,
      especialidad_id INTEGER REFERENCES especialidades(id),
      contrato TEXT,
      jornada TEXT,
      salario TEXT,
      usuario_id INTEGER REFERENCES usuarios(id),
      nombre_contacto TEXT,
      email_contacto TEXT,
      telefono_contacto TEXT,
      activo INTEGER DEFAULT 1,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mensajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publicacion_id INTEGER REFERENCES publicaciones(id),
      usuario_id INTEGER REFERENCES usuarios(id),
      remitente_nombre TEXT NOT NULL,
      remitente_email TEXT NOT NULL,
      cuerpo TEXT NOT NULL,
      leido INTEGER DEFAULT 0,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS confirmacion_email (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id),
      nuevo_email TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      datos TEXT,
      expiracion DATETIME NOT NULL,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS usuario_especialidades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id),
      especialidad_id INTEGER REFERENCES especialidades(id),
      UNIQUE(usuario_id, especialidad_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS publicacion_especialidades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publicacion_id INTEGER REFERENCES publicaciones(id),
      especialidad_id INTEGER REFERENCES especialidades(id),
      UNIQUE(publicacion_id, especialidad_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS candidaturas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publicacion_id INTEGER NOT NULL REFERENCES publicaciones(id),
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      estado TEXT DEFAULT 'pendiente',
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(publicacion_id, usuario_id)
    )
  `);

  // Agregar columnas si no existen (para compatibilidad)
  db.run(`ALTER TABLE mensajes ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id)`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE candidaturas ADD COLUMN mensaje TEXT`, (err) => {
    // Ignorar error si la columna ya existe
  });

  // Preguntas de criba (killer questions) que la clínica define en la oferta,
  // y las respuestas que el candidato da al postularse. Ambas se guardan como
  // JSON: preguntas = ["¿...?", ...]; respuestas = [{pregunta, respuesta}, ...]
  // (las respuestas guardan también el texto de la pregunta para que sobrevivan
  // aunque la oferta cambie sus preguntas más adelante).
  db.run(`ALTER TABLE publicaciones ADD COLUMN preguntas TEXT`, () => {});
  db.run(`ALTER TABLE candidaturas ADD COLUMN respuestas TEXT`, () => {});

  db.run(`ALTER TABLE usuarios ADD COLUMN direccion TEXT`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE usuarios ADD COLUMN codigo_postal TEXT`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE usuarios ADD COLUMN pais TEXT`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE usuarios ADD COLUMN ciudad TEXT`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE usuarios ADD COLUMN provincia TEXT`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE usuarios ADD COLUMN movil TEXT`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE publicaciones ADD COLUMN salario_min INTEGER`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE publicaciones ADD COLUMN experiencia_minima INTEGER`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE publicaciones ADD COLUMN vistas INTEGER DEFAULT 0`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE publicaciones ADD COLUMN salario_max INTEGER`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE publicaciones ADD COLUMN provincia TEXT`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE publicaciones ADD COLUMN fecha_desde TEXT`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE publicaciones ADD COLUMN fecha_hasta TEXT`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE publicaciones ADD COLUMN urgente INTEGER DEFAULT 0`, (err) => {
    // Ignorar error si la columna ya existe
  });

  // Retribución: salario fijo (por defecto) o porcentaje de facturación (habitual en autónomos)
  db.run(`ALTER TABLE publicaciones ADD COLUMN retribucion_tipo TEXT DEFAULT 'fijo'`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE publicaciones ADD COLUMN retribucion_porcentaje INTEGER`, (err) => {
    // Ignorar error si la columna ya existe
  });

  // Equipamiento disponible en la clínica para esta oferta/suplencia (catálogo fijo, ver server.js)
  db.run(`
    CREATE TABLE IF NOT EXISTS publicacion_equipamiento (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publicacion_id INTEGER NOT NULL REFERENCES publicaciones(id),
      equipo TEXT NOT NULL,
      UNIQUE(publicacion_id, equipo)
    )
  `);

  // Certificaciones del dentista más allá de su especialidad base (catálogo fijo, ver server.js)
  db.run(`
    CREATE TABLE IF NOT EXISTS certificaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      certificacion TEXT NOT NULL,
      UNIQUE(usuario_id, certificacion)
    )
  `);

  db.run(`ALTER TABLE usuarios ADD COLUMN anyos_experiencia INTEGER`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE usuarios ADD COLUMN descripcion TEXT`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE mensajes ADD COLUMN destinatario_id INTEGER REFERENCES usuarios(id)`, (err) => {
    // Ignorar error si la columna ya existe
    // Backfill: los mensajes antiguos iban siempre dirigidos al dueño de la publicación
    db.run(`
      UPDATE mensajes SET destinatario_id = (
        SELECT usuario_id FROM publicaciones WHERE publicaciones.id = mensajes.publicacion_id
      )
      WHERE destinatario_id IS NULL
    `);
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS archivos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      tipo TEXT NOT NULL,
      nombre_archivo TEXT NOT NULL,
      mime_type TEXT,
      contenido BLOB NOT NULL,
      tamanyo INTEGER,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS favoritos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      publicacion_id INTEGER NOT NULL REFERENCES publicaciones(id),
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id, publicacion_id)
    )
  `);

  // Favoritos de PERFILES (un usuario guarda la ficha de otro usuario), aparte de los de publicaciones
  db.run(`
    CREATE TABLE IF NOT EXISTS favoritos_perfil (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      perfil_id INTEGER NOT NULL REFERENCES usuarios(id),
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id, perfil_id)
    )
  `);

  // Contactos de PERFIL: "postularse" a la ficha de otro usuario (sin publicación asociada).
  // Al aceptarse, se habilita el chat entre ambos (espejo de candidaturas para publicaciones).
  db.run(`
    CREATE TABLE IF NOT EXISTS contactos_perfil (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitante_id INTEGER NOT NULL REFERENCES usuarios(id),
      perfil_id INTEGER NOT NULL REFERENCES usuarios(id),
      estado TEXT DEFAULT 'pendiente',
      mensaje TEXT,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(solicitante_id, perfil_id)
    )
  `);

  // Un mensaje de chat puede pertenecer a una publicación (candidatura) o a un contacto de perfil
  db.run(`ALTER TABLE mensajes ADD COLUMN contacto_perfil_id INTEGER REFERENCES contactos_perfil(id)`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE usuarios ADD COLUMN email_verificado INTEGER DEFAULT 0`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE usuarios ADD COLUMN acepto_terminos_en DATETIME`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE usuarios ADD COLUMN recibir_emails INTEGER DEFAULT 1`, (err) => {
    // Ignorar error si la columna ya existe
  });

  // La funcionalidad de colegiación (nº de colegiado, colegio y su verificación)
  // se retiró: no aportaba y era información sensible. Se eliminan las columnas y,
  // con ellas, cualquier dato guardado. DROP COLUMN no es idempotente, pero el
  // adaptador ignora el error si la columna ya no existe (BD nueva o segundo boot).
  db.run(`ALTER TABLE usuarios DROP COLUMN num_colegiado`, () => {});
  db.run(`ALTER TABLE usuarios DROP COLUMN colegio`, () => {});
  db.run(`ALTER TABLE usuarios DROP COLUMN colegiado_estado`, () => {});

  db.run(`
    CREATE TABLE IF NOT EXISTS tokens_verificacion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      tipo TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expiracion DATETIME NOT NULL,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS resenyas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidatura_id INTEGER NOT NULL REFERENCES candidaturas(id),
      autor_id INTEGER NOT NULL REFERENCES usuarios(id),
      destinatario_id INTEGER NOT NULL REFERENCES usuarios(id),
      puntuacion INTEGER NOT NULL CHECK (puntuacion BETWEEN 1 AND 5),
      comentario TEXT,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(candidatura_id, autor_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sedes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      nombre TEXT NOT NULL,
      ciudad TEXT NOT NULL,
      direccion TEXT,
      codigo_postal TEXT,
      telefono TEXT,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`ALTER TABLE publicaciones ADD COLUMN sede_id INTEGER REFERENCES sedes(id)`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE sedes ADD COLUMN provincia TEXT`, (err) => {
    // Ignorar error si la columna ya existe
  });

  // Equipamiento por sede. YA NO SE USA: el equipamiento pasó a ser de la clínica
  // entera (ver usuario_equipamiento). La tabla se conserva con sus datos por si
  // hubiera que volver atrás, pero no se lee ni se escribe.
  db.run(`
    CREATE TABLE IF NOT EXISTS sede_equipamiento (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sede_id INTEGER NOT NULL REFERENCES sedes(id),
      equipo TEXT NOT NULL,
      UNIQUE(sede_id, equipo)
    )
  `);

  // Equipamiento de la clínica (catálogo fijo, ver server.js). Antes se declaraba en
  // cada sede, pero en la práctica una clínica tiene el mismo equipo en todas y
  // repetirlo por sede era trabajo de más. Las ofertas lo heredan de aquí.
  db.run(`
    CREATE TABLE IF NOT EXISTS usuario_equipamiento (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      equipo TEXT NOT NULL,
      UNIQUE(usuario_id, equipo)
    )
  `);

  // Backfill: subir a la clínica lo que ya estaba declarado en sus sedes, uniendo
  // todo lo que tuviera cualquiera de ellas. Solo actúa si la clínica aún no tiene
  // equipamiento propio, para no pisar lo que haya editado después.
  db.run(
    `INSERT OR IGNORE INTO usuario_equipamiento (usuario_id, equipo)
     SELECT s.usuario_id, se.equipo
       FROM sede_equipamiento se
       JOIN sedes s ON s.id = se.sede_id
      WHERE NOT EXISTS (
        SELECT 1 FROM usuario_equipamiento ue WHERE ue.usuario_id = s.usuario_id
      )`,
    () => {}
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS plantillas_publicacion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL,
      descripcion TEXT,
      ciudad TEXT,
      contrato TEXT,
      jornada TEXT,
      salario TEXT,
      experiencia INTEGER,
      nombre_contacto TEXT,
      email_contacto TEXT,
      telefono_contacto TEXT,
      especialidades TEXT,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS experiencia_laboral (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      puesto TEXT NOT NULL,
      lugar TEXT,
      fecha_inicio TEXT,
      fecha_fin TEXT,
      actual INTEGER DEFAULT 0,
      descripcion TEXT,
      orden INTEGER DEFAULT 0,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS formacion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      titulo TEXT NOT NULL,
      centro TEXT,
      anyo TEXT,
      orden INTEGER DEFAULT 0,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS idiomas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      idioma TEXT NOT NULL,
      nivel TEXT NOT NULL,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Alertas de búsqueda guardadas por el usuario. `filtros` es un JSON con los
  // mismos parámetros que acepta construirFiltros (tipo, ciudad, especialidad,
  // salarioMin...), de modo que el matching reutiliza exactamente la misma lógica
  // que el listado de publicaciones. `ultimo_aviso` guarda cuándo se avisó por
  // última vez, para solo notificar publicaciones nuevas desde entonces.
  db.run(`
    CREATE TABLE IF NOT EXISTS alertas_busqueda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      nombre TEXT,
      filtros TEXT NOT NULL,
      frecuencia TEXT DEFAULT 'semanal',
      activa INTEGER DEFAULT 1,
      ultimo_aviso DATETIME,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Backfill: calcular salario_min para publicaciones existentes que aún no lo tienen
  db.all("SELECT id, salario FROM publicaciones WHERE salario_min IS NULL AND salario IS NOT NULL", (err, filas) => {
    if (err || !filas) return;
    const stmt = db.prepare("UPDATE publicaciones SET salario_min = ? WHERE id = ?");
    filas.forEach(fila => {
      const match = (fila.salario || '').match(/\d+/);
      if (match) {
        stmt.run(parseInt(match[0]), fila.id);
      }
    });
    stmt.finalize();
  });

  // Coordenadas de la publicación (geocodificadas desde su ciudad), para la
  // búsqueda por radio en km.
  db.run(`ALTER TABLE publicaciones ADD COLUMN lat REAL`, () => {});
  db.run(`ALTER TABLE publicaciones ADD COLUMN lon REAL`, () => {});

  // Backfill: geocodificar la ciudad de las publicaciones que aún no tienen coordenadas
  const { geocodificarCiudad } = require("./municipios-coords");
  db.all("SELECT id, ciudad FROM publicaciones WHERE lat IS NULL AND ciudad IS NOT NULL", (err, filas) => {
    if (err || !filas) return;
    const stmt = db.prepare("UPDATE publicaciones SET lat = ?, lon = ? WHERE id = ?");
    filas.forEach(fila => {
      const geo = geocodificarCiudad(fila.ciudad);
      if (geo) stmt.run(geo.lat, geo.lon, fila.id);
    });
    stmt.finalize();
  });

  // Coordenadas del usuario (geocodificadas desde su ciudad) y radio de
  // desplazamiento del dentista, para casar suplencias por distancia real y no solo
  // por coincidencia exacta de ciudad. radio_km NULL = valor por defecto (ver
  // server.js, RADIO_MATCHING_DEFECTO); radio_km = 0 = solo mi ciudad.
  db.run(`ALTER TABLE usuarios ADD COLUMN lat REAL`, () => {});
  db.run(`ALTER TABLE usuarios ADD COLUMN lon REAL`, () => {});
  db.run(`ALTER TABLE usuarios ADD COLUMN radio_km INTEGER`, () => {});

  // Especialidad en la que se desempeñó cada puesto de la trayectoria. Opcional: un
  // puesto puede no corresponder a una especialidad concreta (recepción, gestión…).
  db.run(`ALTER TABLE experiencia_laboral ADD COLUMN especialidad TEXT`, () => {});

  // Fusión de especialidades: "Cirugía oral" e "Implantología" pasan a ser una sola,
  // "Cirugía e Implantología". Se hace por NOMBRE (no por id fijo) para no depender
  // del orden del seed, y es idempotente: si ya se ejecutó, esos nombres ya no
  // existen y no hace nada. "Cirugía oral" se renombra (conserva su id y todo lo que
  // apunta a ella) y "Implantología" se absorbe en ella.
  fusionarEspecialidades(db, ["Cirugía oral", "Implantología"], "Cirugía e Implantología");

  // Backfill: geocodificar la ciudad de los usuarios que aún no tienen coordenadas
  db.all("SELECT id, ciudad FROM usuarios WHERE lat IS NULL AND ciudad IS NOT NULL", (err, filas) => {
    if (err || !filas) return;
    const stmt = db.prepare("UPDATE usuarios SET lat = ?, lon = ? WHERE id = ?");
    filas.forEach(fila => {
      const geo = geocodificarCiudad(fila.ciudad);
      if (geo) stmt.run(geo.lat, geo.lon, fila.id);
    });
    stmt.finalize();
  });

  // Backfill: las notificaciones creadas antes de que se guardara el destino se
  // quedaron sin `enlace`, y el frontend solo hace clicable la que trae uno.
  //
  // El identificador concreto no se guardó, pero casi siempre se puede reconstruir:
  // la notificación se crea justo después del hecho que la provoca, así que basta
  // cruzar por destinatario y buscar el elemento inmediatamente anterior. La ventana
  // es estrecha a propósito: ante la duda es mejor dejar el destino genérico que
  // mandar a alguien a la candidatura equivocada.
  //
  // Vuelve a pasar también sobre los destinos genéricos que puso una versión previa
  // de este mismo backfill, para mejorarlos ahora que se sabe reconstruirlos.
  const VENTANA = "300.0/86400"; // 5 minutos, en días julianos

  const generico = (...valores) =>
    `(enlace IS NULL OR enlace IN (${valores.map(v => `'${v}'`).join(",")}))`;

  // Nueva postulación → la candidatura a una publicación de quien recibe el aviso
  db.run(
    `UPDATE notificaciones SET enlace = '#candidatura=' || (
       SELECT c.id FROM candidaturas c
         JOIN publicaciones p ON p.id = c.publicacion_id
        WHERE p.usuario_id = notificaciones.usuario_id
          AND c.creado_en <= notificaciones.creado_en
          AND julianday(notificaciones.creado_en) - julianday(c.creado_en) < ${VENTANA}
        ORDER BY c.creado_en DESC LIMIT 1)
     WHERE titulo = '¡Tienes una nueva postulación!'
       AND ${generico("#postulaciones-recibidas")}
       AND (SELECT c.id FROM candidaturas c
              JOIN publicaciones p ON p.id = c.publicacion_id
             WHERE p.usuario_id = notificaciones.usuario_id
               AND c.creado_en <= notificaciones.creado_en
               AND julianday(notificaciones.creado_en) - julianday(c.creado_en) < ${VENTANA}
             ORDER BY c.creado_en DESC LIMIT 1) IS NOT NULL`,
    () => {}
  );

  // Cambio de estado → la candidatura de quien recibe el aviso, por fecha de cambio
  db.run(
    `UPDATE notificaciones SET enlace = '#candidatura=' || (
       SELECT c.id FROM candidaturas c
        WHERE c.usuario_id = notificaciones.usuario_id
          AND julianday(notificaciones.creado_en) - julianday(COALESCE(c.actualizado_en, c.creado_en)) BETWEEN -${VENTANA} AND ${VENTANA}
        ORDER BY COALESCE(c.actualizado_en, c.creado_en) DESC LIMIT 1)
     WHERE titulo LIKE 'Candidatura %'
       AND ${generico("#mis-postulaciones")}
       AND (SELECT c.id FROM candidaturas c
             WHERE c.usuario_id = notificaciones.usuario_id
               AND julianday(notificaciones.creado_en) - julianday(COALESCE(c.actualizado_en, c.creado_en)) BETWEEN -${VENTANA} AND ${VENTANA}
             ORDER BY COALESCE(c.actualizado_en, c.creado_en) DESC LIMIT 1) IS NOT NULL`,
    () => {}
  );

  // Mensaje nuevo → el hilo con quien lo envió
  db.run(
    `UPDATE notificaciones SET enlace = '#chat=' || (
       SELECT m.usuario_id FROM mensajes m
        WHERE m.destinatario_id = notificaciones.usuario_id
          AND m.creado_en <= notificaciones.creado_en
          AND julianday(notificaciones.creado_en) - julianday(m.creado_en) < ${VENTANA}
        ORDER BY m.creado_en DESC LIMIT 1)
     WHERE titulo = 'Tienes un mensaje nuevo'
       AND ${generico("#chat")}
       AND (SELECT m.usuario_id FROM mensajes m
             WHERE m.destinatario_id = notificaciones.usuario_id
               AND m.creado_en <= notificaciones.creado_en
               AND julianday(notificaciones.creado_en) - julianday(m.creado_en) < ${VENTANA}
             ORDER BY m.creado_en DESC LIMIT 1) IS NOT NULL`,
    () => {}
  );

  // Solicitud de contacto → esa solicitud
  db.run(
    `UPDATE notificaciones SET enlace = '#contacto=' || (
       SELECT cp.id FROM contactos_perfil cp
        WHERE cp.perfil_id = notificaciones.usuario_id
          AND cp.creado_en <= notificaciones.creado_en
          AND julianday(notificaciones.creado_en) - julianday(cp.creado_en) < ${VENTANA}
        ORDER BY cp.creado_en DESC LIMIT 1)
     WHERE titulo = 'Alguien quiere contactar contigo'
       AND ${generico("#chat")}
       AND (SELECT cp.id FROM contactos_perfil cp
             WHERE cp.perfil_id = notificaciones.usuario_id
               AND cp.creado_en <= notificaciones.creado_en
               AND julianday(notificaciones.creado_en) - julianday(cp.creado_en) < ${VENTANA}
             ORDER BY cp.creado_en DESC LIMIT 1) IS NOT NULL`,
    () => {}
  );

  // Suplencias: aquí no hace falta adivinar. `notificaciones_suplencia` guarda
  // exactamente de qué publicación se avisó a cada dentista.
  db.run(
    `UPDATE notificaciones SET enlace = '#publicacion=' || (
       SELECT ns.publicacion_id FROM notificaciones_suplencia ns
        WHERE ns.usuario_id = notificaciones.usuario_id
          AND julianday(notificaciones.creado_en) - julianday(ns.creado_en) BETWEEN -${VENTANA} AND ${VENTANA}
        ORDER BY ns.creado_en DESC LIMIT 1)
     WHERE titulo = 'Una suplencia urgente encaja con tu disponibilidad'
       AND ${generico("#suplencias")}
       AND (SELECT ns.publicacion_id FROM notificaciones_suplencia ns
             WHERE ns.usuario_id = notificaciones.usuario_id
               AND julianday(notificaciones.creado_en) - julianday(ns.creado_en) BETWEEN -${VENTANA} AND ${VENTANA}
             ORDER BY ns.creado_en DESC LIMIT 1) IS NOT NULL`,
    () => {}
  );

  // El digest agrupa varias: se reconstruye la lista de ids de esa misma tanda
  db.run(
    `UPDATE notificaciones SET enlace = '#suplencias=' || (
       SELECT group_concat(ns.publicacion_id) FROM notificaciones_suplencia ns
        WHERE ns.usuario_id = notificaciones.usuario_id
          AND julianday(notificaciones.creado_en) - julianday(ns.creado_en) BETWEEN -${VENTANA} AND ${VENTANA})
     WHERE titulo = 'Suplencias que encajan con tu disponibilidad'
       AND ${generico("#suplencias")}
       AND (SELECT group_concat(ns.publicacion_id) FROM notificaciones_suplencia ns
             WHERE ns.usuario_id = notificaciones.usuario_id
               AND julianday(notificaciones.creado_en) - julianday(ns.creado_en) BETWEEN -${VENTANA} AND ${VENTANA}) IS NOT NULL`,
    () => {}
  );

  // Lo que no se puede reconstruir se queda con el destino genérico: de qué alerta
  // hablaba no lo guarda nadie, y el resumen semanal es sobre un conjunto.
  db.run(
    "UPDATE notificaciones SET enlace = '#alertas' WHERE enlace IS NULL AND titulo = 'Nuevas coincidencias para tu alerta'",
    () => {}
  );

  db.run(
    `UPDATE notificaciones SET enlace = CASE
       WHEN (SELECT tipo FROM usuarios WHERE id = notificaciones.usuario_id) = 'clinica'
       THEN '#dentistas-potenciales' ELSE '#clinicas-potenciales' END
     WHERE enlace IS NULL AND titulo = 'Resumen semanal de coincidencias'`,
    () => {}
  );

  // Red de seguridad: si algo quedó sin enlace (título de una versión antigua, o un
  // cruce que no encontró nada), al menos que lleve a su listado en vez de no ser
  // clicable. Se aplica al final, solo sobre lo que sigue en NULL.
  const ENLACES_GENERICOS = {
    "¡Tienes una nueva postulación!": "#postulaciones-recibidas",
    "Tienes un mensaje nuevo": "#chat",
    "Alguien quiere contactar contigo": "#chat",
    "Una suplencia urgente encaja con tu disponibilidad": "#suplencias",
    "Suplencias que encajan con tu disponibilidad": "#suplencias"
  };
  Object.entries(ENLACES_GENERICOS).forEach(([titulo, enlace]) => {
    db.run("UPDATE notificaciones SET enlace = ? WHERE enlace IS NULL AND titulo = ?", [enlace, titulo], () => {});
  });
  db.run(
    "UPDATE notificaciones SET enlace = '#mis-postulaciones' WHERE enlace IS NULL AND titulo LIKE 'Candidatura %'",
    () => {}
  );

  // Días concretos que cubre una suplencia. Permite días sueltos o recurrentes,
  // no solo un rango continuo. En publicaciones, fecha_desde/fecha_hasta se
  // conservan como resumen (min/max de los días) para el listado, el SEO y el
  // sitemap, que no necesitan el detalle día a día.
  db.run(`
    CREATE TABLE IF NOT EXISTS suplencia_dias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publicacion_id INTEGER NOT NULL REFERENCES publicaciones(id),
      fecha TEXT NOT NULL,
      UNIQUE(publicacion_id, fecha)
    )
  `);

  // Disponibilidad del dentista para suplencias: un registro por día disponible.
  db.run(`
    CREATE TABLE IF NOT EXISTS disponibilidad_dentista (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      fecha TEXT NOT NULL,
      UNIQUE(usuario_id, fecha)
    )
  `);

  // Dedup de avisos de matching de suplencias: un dentista solo se avisa una vez
  // por suplencia, aunque el digest diario se ejecute muchas veces.
  db.run(`
    CREATE TABLE IF NOT EXISTS notificaciones_suplencia (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      publicacion_id INTEGER NOT NULL REFERENCES publicaciones(id),
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(usuario_id, publicacion_id)
    )
  `);

  // Notificaciones in-app (campana): se crean en cada evento por-usuario a la vez
  // que el email, y se muestran aunque el usuario tenga los emails desactivados.
  db.run(`
    CREATE TABLE IF NOT EXISTS notificaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      tipo TEXT DEFAULT 'general',
      titulo TEXT NOT NULL,
      cuerpo TEXT,
      enlace TEXT,
      leido INTEGER DEFAULT 0,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Respuestas al cuestionario de compatibilidad. Una sola tabla para los dos
  // lados: el dentista responde lo que busca y la clínica lo que es/ofrece, con
  // las mismas claves del catálogo (ver compatibilidad.js). Las ofertas heredan
  // las respuestas de la clínica que las publica, así que no se pregunta nada por
  // publicación. Las dimensiones de multiselección guardan una fila por opción.
  db.run(`
    CREATE TABLE IF NOT EXISTS preferencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      clave TEXT NOT NULL,
      valor TEXT NOT NULL,
      UNIQUE(usuario_id, clave, valor)
    )
  `);

  // Prioridades personales del dentista sobre las dimensiones de compatibilidad
  // (Fase 3). Una fila por dimensión que el dentista mueve del neutro; las que no
  // aparecen valen "media" (peso base). Solo la usan los dentistas: la clínica es
  // el lado evaluado, no quien pondera. Ver compatibilidad.js (NIVELES_PRIORIDAD).
  db.run(`
    CREATE TABLE IF NOT EXISTS prioridades_compat (
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      clave TEXT NOT NULL,
      nivel TEXT NOT NULL,
      PRIMARY KEY (usuario_id, clave)
    )
  `);

  // Backfill: las suplencias que ya existían solo tenían el rango fecha_desde →
  // fecha_hasta. Se expande a días concretos en suplencia_dias para las que aún
  // no tengan ninguno, de modo que el nuevo filtro por fecha las incluya.
  const { expandirRango } = require("./fechas");
  db.all(
    `SELECT id, fecha_desde, fecha_hasta FROM publicaciones
     WHERE tipo = 'suplencia' AND fecha_desde IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM suplencia_dias sd WHERE sd.publicacion_id = publicaciones.id)`,
    (err, filas) => {
      if (err || !filas) return;
      const stmt = db.prepare("INSERT OR IGNORE INTO suplencia_dias (publicacion_id, fecha) VALUES (?, ?)");
      filas.forEach(fila => {
        expandirRango(fila.fecha_desde, fila.fecha_hasta).forEach(dia => stmt.run(fila.id, dia));
      });
      stmt.finalize();
    }
  );

  db.get("SELECT COUNT(*) as count FROM especialidades", (err, row) => {
    if (row.count === 0) {
      const especializaciones = [
        "Generalista",
        "Cirugía e Implantología",
        "Endodoncia",
        "Periodoncia",
        "Ortodoncia",
        "Estética dental",
        "Odontopediatría"
      ];

      const stmt = db.prepare("INSERT INTO especialidades (nombre) VALUES (?)");
      especializaciones.forEach(esp => stmt.run(esp));
      stmt.finalize();
    }
    if (process.env.NODE_ENV !== "test") console.log("✅ Base de datos inicializada");
  });
});

module.exports = db;
