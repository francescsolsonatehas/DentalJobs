// Vuelca la base de datos (Turso o archivo local) como SQL por stdout.
// Uso:  node backup-dump.js > backup.sql
// Con TURSO_DATABASE_URL + TURSO_AUTH_TOKEN vuelca la BD remota;
// sin ellas, el archivo local (útil para probar el propio script).
const path = require("path");
const { createClient } = require("@libsql/client");

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:" + (process.env.DB_PATH || path.join(__dirname, "dental_jobs.db")),
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  intMode: "number"
});

function escaparValor(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (v instanceof ArrayBuffer || Buffer.isBuffer(v)) {
    return "X'" + Buffer.from(v).toString("hex") + "'";
  }
  return "'" + String(v).replace(/'/g, "''") + "'";
}

(async () => {
  try {
    console.log("-- Backup DentalJobs " + new Date().toISOString());
    console.log("PRAGMA foreign_keys = OFF;");
    console.log("BEGIN TRANSACTION;");

    const tablas = await client.execute(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );

    for (const tabla of tablas.rows) {
      console.log("");
      console.log(`-- Tabla ${tabla.name}`);
      console.log(tabla.sql.replace(/\s+/g, " ").trim() + ";");

      const datos = await client.execute(`SELECT * FROM "${tabla.name}"`);
      for (const fila of datos.rows) {
        const valores = datos.columns.map((_, i) => escaparValor(fila[i]));
        console.log(`INSERT INTO "${tabla.name}" VALUES (${valores.join(", ")});`);
      }
    }

    console.log("");
    console.log("COMMIT;");
    process.exit(0);
  } catch (err) {
    console.error("Error al volcar la BD:", err.message);
    process.exit(1);
  }
})();
