const { crearDb } = require("./libsql-adapter");

const db = crearDb();

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

  db.run(`
    CREATE TABLE IF NOT EXISTS busquedas_guardadas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      nombre TEXT,
      tipo TEXT NOT NULL,
      ciudad TEXT,
      especialidad_id INTEGER REFERENCES especialidades(id),
      contrato TEXT,
      jornada TEXT,
      salario_min INTEGER,
      experiencia_minima INTEGER,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS alertas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      busqueda_guardada_id INTEGER REFERENCES busquedas_guardadas(id),
      publicacion_id INTEGER REFERENCES publicaciones(id),
      leido INTEGER DEFAULT 0,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`ALTER TABLE usuarios ADD COLUMN email_verificado INTEGER DEFAULT 0`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE usuarios ADD COLUMN acepto_terminos_en DATETIME`, (err) => {
    // Ignorar error si la columna ya existe
  });

  db.run(`ALTER TABLE usuarios ADD COLUMN recibir_emails INTEGER DEFAULT 1`, (err) => {
    // Ignorar error si la columna ya existe
  });

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

  db.get("SELECT COUNT(*) as count FROM especialidades", (err, row) => {
    if (row.count === 0) {
      const especializaciones = [
        "Generalista",
        "Cirugía oral",
        "Implantología",
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
    console.log("✅ Base de datos inicializada");
  });
});

module.exports = db;
