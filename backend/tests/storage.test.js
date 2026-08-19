const test = require("node:test");
const assert = require("node:assert/strict");

// Sin las variables S3_* configuradas (el caso de desarrollo y tests), el módulo
// tiene que comportarse exactamente como si no existiera: todo sigue guardándose
// como BLOB en la propia BD.
test("storage externo: sin configurar, pasa el contenido tal cual (BLOB en BD)", async () => {
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
  delete require.cache[require.resolve("../storage")];
  const storage = require("../storage");

  assert.equal(storage.habilitado(), false);

  const buffer = Buffer.from("contenido de prueba");
  const guardado = await storage.guardar(1, "foto", buffer);
  assert.equal(guardado.storageKey, null);
  assert.equal(guardado.contenido, buffer);

  const leido = await storage.leer({ contenido: buffer, storage_key: null });
  assert.equal(leido, buffer);

  // No debe lanzar ni intentar hablar con ningún servidor
  await storage.borrar({ storage_key: null });
});

test("storage externo: se activa solo con las cuatro variables completas", async () => {
  delete require.cache[require.resolve("../storage")];
  process.env.S3_ENDPOINT = "https://example.r2.cloudflarestorage.com";
  process.env.S3_BUCKET = "dentaljobs-test";
  process.env.S3_ACCESS_KEY_ID = "clave";
  delete process.env.S3_SECRET_ACCESS_KEY; // falta una: sigue deshabilitado
  let storage = require("../storage");
  assert.equal(storage.habilitado(), false);

  process.env.S3_SECRET_ACCESS_KEY = "secreto";
  delete require.cache[require.resolve("../storage")];
  storage = require("../storage");
  assert.equal(storage.habilitado(), true);

  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
  delete require.cache[require.resolve("../storage")];
});
