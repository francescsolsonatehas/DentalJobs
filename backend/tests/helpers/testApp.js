const os = require("os");
const path = require("path");
const fs = require("fs");

// Crea una app Express con una base de datos SQLite temporal y aislada.
// `node --test` ejecuta cada fichero de test en su propio proceso, así que
// limpiar la caché de require aquí es suficiente para no compartir la
// conexión a la BD entre ficheros de test.
function createTestApp() {
  const dbPath = path.join(os.tmpdir(), `dentaljobs-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = "test"; // desactiva el rate limiting durante los tests
  process.env.JWT_SECRET = process.env.JWT_SECRET || "dental_jobs_secret_key_2024";
  // Los tests SIEMPRE usan la BD temporal local, nunca Turso
  // (server.js carga backend/.env con dotenv y estas variables se colarían)
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;

  delete require.cache[require.resolve("../../db")];
  delete require.cache[require.resolve("../../server")];
  delete require.cache[require.resolve("../../middleware/auth")];

  const app = require("../../server");

  return { app, dbPath };
}

async function cleanupTestApp(dbPath) {
  // Drenar y cerrar la conexión antes de borrar el fichero: así las escrituras
  // en vuelo (p. ej. notificaciones creadas como efecto secundario tras responder
  // un endpoint) terminan y no corrompen el runner ni provocan fallos flaky.
  try {
    const db = require("../../db");
    if (db && typeof db.close === "function") {
      await new Promise(resolve => db.close(() => resolve()));
    }
  } catch (e) {
    /* si no se puede cerrar, se borra igualmente */
  }

  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = dbPath + suffix;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

module.exports = { createTestApp, cleanupTestApp };
