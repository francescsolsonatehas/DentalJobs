const test = require("node:test");
const assert = require("node:assert/strict");

// Sin las claves ILOVEPDF_* configuradas (el caso de desarrollo y tests), no debe
// llamarse a la API: el PDF se guarda tal cual llegó.
test("compresión de PDF: sin claves configuradas, no llama a la API y devuelve el original", async () => {
  delete process.env.ILOVEPDF_PUBLIC_KEY;
  delete process.env.ILOVEPDF_SECRET_KEY;
  delete require.cache[require.resolve("../pdfs")];
  const { habilitado, comprimirPdf } = require("../pdfs");

  assert.equal(habilitado(), false);

  const buffer = Buffer.from("%PDF-1.4 contenido de prueba");
  const resultado = await comprimirPdf(buffer, "cv.pdf");
  assert.equal(resultado, buffer);
});

test("compresión de PDF: se activa solo con las dos claves completas", async () => {
  delete require.cache[require.resolve("../pdfs")];
  process.env.ILOVEPDF_PUBLIC_KEY = "clave-publica";
  delete process.env.ILOVEPDF_SECRET_KEY; // falta una: sigue deshabilitado
  let { habilitado } = require("../pdfs");
  assert.equal(habilitado(), false);

  process.env.ILOVEPDF_SECRET_KEY = "clave-secreta";
  delete require.cache[require.resolve("../pdfs")];
  ({ habilitado } = require("../pdfs"));
  assert.equal(habilitado(), true);

  delete process.env.ILOVEPDF_PUBLIC_KEY;
  delete process.env.ILOVEPDF_SECRET_KEY;
  delete require.cache[require.resolve("../pdfs")];
});
