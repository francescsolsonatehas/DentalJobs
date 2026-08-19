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

function subirPortfolio(app, token, nombre) {
  return request(app)
    .post("/archivos/upload")
    .set("Authorization", `Bearer ${token}`)
    .field("tipo", "portfolio")
    .attach("archivo", Buffer.from("%PDF-1.4 book"), nombre);
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

test("límite de archivos del Book del dentista (máx 5, 10 MB cada uno)", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const token = await registrar(app, { nombre: "Dentista Límite Book", email: "dentista-limite-book@test.com", tipo: "dentista" });

  for (let i = 1; i <= 5; i++) {
    const res = await subirPortfolio(app, token, `book${i}.pdf`);
    assert.equal(res.status, 200, `el archivo ${i} del Book debe aceptarse`);
  }

  await t.test("el sexto archivo se rechaza", async () => {
    const res = await subirPortfolio(app, token, "book6.pdf");
    assert.equal(res.status, 400);
    assert.match(res.body.error, /máximo de 5/);
  });

  await t.test("un archivo de más de 10 MB se rechaza", async () => {
    const token2 = await registrar(app, { nombre: "Dentista Book Grande", email: "dentista-book-grande@test.com", tipo: "dentista" });
    const grande = Buffer.alloc(11 * 1024 * 1024, "a");
    const res = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${token2}`)
      .field("tipo", "portfolio")
      .attach("archivo", grande, "grande.pdf");
    assert.equal(res.status, 400);
    assert.match(res.body.error, /máx 10 MB/);
  });
});

function jwtUsuarioId(token) {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
  return payload.id;
}
