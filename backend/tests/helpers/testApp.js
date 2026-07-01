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
  process.env.JWT_SECRET = process.env.JWT_SECRET || "dental_jobs_secret_key_2024";

  delete require.cache[require.resolve("../../db")];
  delete require.cache[require.resolve("../../server")];
  delete require.cache[require.resolve("../../middleware/auth")];

  const app = require("../../server");

  return { app, dbPath };
}

function cleanupTestApp(dbPath) {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = dbPath + suffix;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

module.exports = { createTestApp, cleanupTestApp };
