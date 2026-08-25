const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const PDFDocument = require("pdfkit");
const { comprimirPdf } = require("../pdfs");

// Un PDF con una foto de alta resolución incrustada: es el caso donde Ghostscript
// (PDFSETTINGS=/ebook) de verdad reduce el peso, al bajarle la resolución a la imagen.
function pdfConImagenGrande() {
  return new Promise(async (resolve) => {
    const imagen = await sharp({
      create: { width: 2000, height: 1500, channels: 3, background: { r: 120, g: 180, b: 220 } }
    }).jpeg({ quality: 95 }).toBuffer();

    const doc = new PDFDocument();
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.image(imagen, 50, 50, { width: 500 });
    doc.end();
  });
}

test("comprimirPdf reduce un PDF con imágenes incrustadas", async () => {
  const original = await pdfConImagenGrande();
  const comprimido = await comprimirPdf(original);
  assert.ok(comprimido.length < original.length, "el PDF comprimido debe pesar menos");
  assert.equal(comprimido.slice(0, 5).toString("latin1"), "%PDF-");
});

test("comprimirPdf no empeora un PDF ya pequeño (se queda con el original)", async () => {
  const original = Buffer.from("%PDF-1.4 no es un pdf de verdad, solo texto corto");
  const resultado = await comprimirPdf(original);
  assert.deepEqual(resultado, original);
});

// La subida de un PDF al Book (una única hoja de miniaturas, no comprimirPdf sin más)
// tiene su propia cobertura en tests/book-miniaturas.test.js.
