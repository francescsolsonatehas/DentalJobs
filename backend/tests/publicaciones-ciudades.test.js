const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");

async function registrar(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo, aceptaTerminos: true });
  return { token: res.body.token, usuario: res.body.usuario };
}

test("búsqueda de publicaciones de dentistas por ciudad", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const dentista = await registrar(app, { nombre: "Dent Pub", email: "pub-dent@test.com", tipo: "dentista" });
  const clinica = await registrar(app, { nombre: "Clínica Pub", email: "pub-clinica@test.com", tipo: "clinica" });

  const publicar = (ciudad) =>
    request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ tipo: "solicitud", ciudad, descripcion: `Busco trabajo en ${ciudad}` });

  await publicar("Girona");
  await publicar("Barcelona");
  await publicar("Badalona");
  await publicar("Madrid");

  await t.test("lista las ciudades con publicaciones y el total", async () => {
    const res = await request(app).get("/publicaciones/ciudades?tipo=solicitud");
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 4);
    assert.deepEqual(res.body.ciudades.map(c => c.ciudad), ["Badalona", "Barcelona", "Girona", "Madrid"]);
  });

  // "ciudades" no debe confundirse con un id de publicación
  await t.test("la ruta de ciudades no colisiona con /publicaciones/:id", async () => {
    const res = await request(app).get("/publicaciones/ciudades");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.ciudades));
  });

  await t.test("sort=ciudad ordena por ciudad", async () => {
    const res = await request(app).get("/publicaciones?tipo=solicitud&sort=ciudad");
    assert.deepEqual(res.body.map(p => p.ciudad), ["Badalona", "Barcelona", "Girona", "Madrid"]);
  });

  await t.test("el radio alcanza ciudades vecinas y el CSV exporta lo mismo", async () => {
    const listado = await request(app).get("/publicaciones?tipo=solicitud&ciudad=Barcelona&radioKm=25&sort=ciudad");
    const ciudadesListado = listado.body.map(p => p.ciudad).sort();
    assert.deepEqual(ciudadesListado, ["Badalona", "Barcelona"]);

    const csv = await request(app)
      .get("/exportar/publicaciones.csv?ciudad=Barcelona&radioKm=25")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(csv.status, 200);
    const ciudadesCsv = csv.text.replace(/^﻿/, "").trim().split("\n").slice(1)
      .map(l => l.split(";")[5].replace(/"/g, "")).sort();
    assert.deepEqual(ciudadesCsv, ciudadesListado);
  });
});
