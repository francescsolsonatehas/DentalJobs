const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const sharp = require("sharp");
const PDFDocument = require("pdfkit");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");
const { comprimirPdf } = require("../pdfs");

async function registrar(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo, aceptaTerminos: true });
  return res.body.token;
}

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

test("subir un PDF con foto incrustada al Book llega comprimido", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const token = await registrar(app, { nombre: "Dentista PDF Grande", email: "dentista-pdf-grande@test.com", tipo: "dentista" });
  const original = await pdfConImagenGrande();

  const subida = await request(app)
    .post("/archivos/upload")
    .set("Authorization", `Bearer ${token}`)
    .field("tipo", "portfolio")
    .attach("archivo", original, { filename: "book.pdf", contentType: "application/pdf" });

  assert.equal(subida.status, 200);
  assert.ok(subida.body.archivo.tamanyo < original.length, "el archivo guardado debe pesar menos que el original subido");

  const descarga = await request(app).get(`/archivos/${subida.body.id}/download`);
  assert.equal(descarga.status, 200);
  assert.equal(descarga.headers["content-type"], "application/pdf");
  assert.equal(descarga.body.slice(0, 5).toString("latin1"), "%PDF-");
});
