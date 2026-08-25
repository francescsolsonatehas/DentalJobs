const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");

async function registrar(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo, aceptaTerminos: true });
  return res.body.token;
}

function subirFoto(app, token, nombre) {
  return request(app)
    .post("/archivos/upload")
    .set("Authorization", `Bearer ${token}`)
    .field("tipo", "foto")
    .attach("archivo", Buffer.from("fake-jpg"), nombre);
}

// JPEG 1x1 válido mínimo: el Book admite imágenes y estas se recomprimen con sharp,
// que necesita poder leer sus cabeceras de verdad.
const JPEG_MINIMO = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64"
);

function subirPortfolio(app, token, nombre) {
  return request(app)
    .post("/archivos/upload")
    .set("Authorization", `Bearer ${token}`)
    .field("tipo", "portfolio")
    .attach("archivo", JPEG_MINIMO, { filename: nombre, contentType: "image/jpeg" });
}

test("límite de fotos de la clínica (máx 4)", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const token = await registrar(app, { nombre: "Clínica Límite Fotos", email: "clinica-limite-fotos@test.com", tipo: "clinica" });

  for (let i = 1; i <= 4; i++) {
    const res = await subirFoto(app, token, `foto${i}.jpg`);
    assert.equal(res.status, 200, `la foto ${i} debe aceptarse`);
  }

  await t.test("la quinta foto se rechaza", async () => {
    const res = await subirFoto(app, token, "foto5.jpg");
    assert.equal(res.status, 400);
    assert.match(res.body.error, /máximo de 4/);
  });

  await t.test("al borrar una, vuelve a caber otra", async () => {
    const lista = await request(app).get("/archivos/usuario/" + jwtUsuarioId(token));
    const primera = lista.body.find(a => a.tipo === "foto");
    await request(app).delete(`/archivos/${primera.id}`).set("Authorization", `Bearer ${token}`);

    const res = await subirFoto(app, token, "foto-nueva.jpg");
    assert.equal(res.status, 200);
  });
});

test("el Book del dentista admite un único archivo, hasta 60 MB", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const token = await registrar(app, { nombre: "Dentista Límite Book", email: "dentista-limite-book@test.com", tipo: "dentista" });

  await t.test("subir un archivo lo guarda", async () => {
    const res = await subirPortfolio(app, token, "book1.jpg");
    assert.equal(res.status, 200);
  });

  await t.test("subir un segundo archivo sustituye al primero, no se acumula", async () => {
    const res = await subirPortfolio(app, token, "book2.jpg");
    assert.equal(res.status, 200);

    const lista = await request(app).get("/archivos/usuario/" + jwtUsuarioId(token));
    const portfolios = lista.body.filter(a => a.tipo === "portfolio");
    assert.equal(portfolios.length, 1, "solo debe quedar un archivo del Book");
    assert.equal(portfolios[0].id, res.body.id);
    assert.equal(portfolios[0].nombre_archivo, "book2.webp");
  });

  await t.test("un archivo de más de 60 MB se rechaza", async () => {
    const token2 = await registrar(app, { nombre: "Dentista Book Grande", email: "dentista-book-grande@test.com", tipo: "dentista" });
    const grande = Buffer.alloc(61 * 1024 * 1024, "a");
    const res = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${token2}`)
      .field("tipo", "portfolio")
      .attach("archivo", grande, { filename: "grande.pdf", contentType: "application/pdf" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /60 MB/);
  });
});

function jwtUsuarioId(token) {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
  return payload.id;
}
