const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const sharp = require("sharp");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");

async function registrar(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo, aceptaTerminos: true });
  return res.body.token;
}

// Imagen grande y muy compresible (un degradado), para que el redimensionado y la
// recompresión a WebP se noten de verdad en el peso.
async function imagenGrande(ladoPx = 2400) {
  return sharp({
    create: { width: ladoPx, height: ladoPx, channels: 3, background: { r: 200, g: 220, b: 240 } }
  }).png().toBuffer();
}

test("las imágenes se recomprimen a WebP al subirlas", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const token = await registrar(app, { nombre: "Clínica Compresión", email: "clinica-compresion@test.com", tipo: "clinica" });
  const original = await imagenGrande();

  const subida = await request(app)
    .post("/archivos/upload")
    .set("Authorization", `Bearer ${token}`)
    .field("tipo", "foto")
    .attach("archivo", original, { filename: "clinica.png", contentType: "image/png" });

  assert.equal(subida.status, 200);
  assert.match(subida.body.archivo.nombre, /\.webp$/);
  assert.ok(subida.body.archivo.tamanyo < original.length, "el archivo guardado debe pesar menos que el original");

  const lista = await request(app).get("/archivos/usuario/" + JSON.parse(Buffer.from(token.split(".")[1], "base64")).id);
  const foto = lista.body.find(a => a.tipo === "foto");
  assert.equal(foto.mime_type, "image/webp");

  const descarga = await request(app).get(`/archivos/${foto.id}/download`);
  assert.equal(descarga.status, 200);
  assert.equal(descarga.headers["content-type"], "image/webp");

  const metadata = await sharp(descarga.body).metadata();
  assert.equal(metadata.format, "webp");
  assert.ok(metadata.width <= 1600, `el lado más largo debe recortarse a 1600px como máximo (salió ${metadata.width})`);
});

test("un archivo que no es una imagen de verdad se guarda tal cual (no rompe la subida)", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const token = await registrar(app, { nombre: "Clínica Fallback", email: "clinica-fallback@test.com", tipo: "clinica" });

  const subida = await request(app)
    .post("/archivos/upload")
    .set("Authorization", `Bearer ${token}`)
    .field("tipo", "foto")
    .attach("archivo", Buffer.from("esto no es una imagen de verdad"), { filename: "falsa.jpg", contentType: "image/jpeg" });

  assert.equal(subida.status, 200);
  assert.equal(subida.body.archivo.nombre, "falsa.jpg");
});
