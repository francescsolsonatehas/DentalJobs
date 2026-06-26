const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "dental_jobs.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");

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
      titulo TEXT NOT NULL,
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

  // Agregar columnas si no existen (para compatibilidad)
  db.run(`ALTER TABLE mensajes ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id)`, (err) => {
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
