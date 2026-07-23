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

async function fijarCiudad(app, usuario, ciudad) {
  await request(app)
    .put("/auth/actualizar-perfil")
    .set("Authorization", `Bearer ${usuario.token}`)
    .send({ nombre: usuario.usuario.nombre, ciudad });
}

test("listado de dentistas por radio (búsqueda de perfiles)", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  // Dentistas en Barcelona (centro), Badalona (~10 km), Girona (~85 km) y Madrid (~500 km)
  const bcn = await registrar(app, { nombre: "Dentista BCN", email: "d-bcn@test.com", tipo: "dentista" });
  const bad = await registrar(app, { nombre: "Dentista Badalona", email: "d-bad@test.com", tipo: "dentista" });
  const gir = await registrar(app, { nombre: "Dentista Girona", email: "d-gir@test.com", tipo: "dentista" });
  const mad = await registrar(app, { nombre: "Dentista Madrid", email: "d-mad@test.com", tipo: "dentista" });

  await fijarCiudad(app, bcn, "Barcelona");
  await fijarCiudad(app, bad, "Badalona");
  await fijarCiudad(app, gir, "Girona");
  await fijarCiudad(app, mad, "Madrid");

  await t.test("radio de 25 km desde Barcelona trae Barcelona y Badalona, no Girona/Madrid", async () => {
    const res = await request(app).get("/perfiles?rol=dentista&ciudad=Barcelona&radioKm=25");
    const ciudades = res.body.perfiles.map(p => p.ciudad).sort();
    assert.deepEqual(ciudades, ["Badalona", "Barcelona"]);
  });

  await t.test("radio de 100 km incluye Girona pero no Madrid", async () => {
    const res = await request(app).get("/perfiles?rol=dentista&ciudad=Barcelona&radioKm=100");
    const ciudades = res.body.perfiles.map(p => p.ciudad).sort();
    assert.deepEqual(ciudades, ["Badalona", "Barcelona", "Girona"]);
  });

  await t.test("sin radio, el filtro por ciudad es por coincidencia de texto", async () => {
    const res = await request(app).get("/perfiles?rol=dentista&ciudad=Barcelona");
    const ciudades = res.body.perfiles.map(p => p.ciudad);
    assert.deepEqual(ciudades, ["Barcelona"]);
  });

  await t.test("una ciudad no reconocida ignora el radio y cae al filtro por texto", async () => {
    const res = await request(app).get("/perfiles?rol=dentista&ciudad=CiudadInventada&radioKm=50");
    assert.equal(res.body.perfiles.length, 0);
  });
});

test("ciudades disponibles para elegir en la búsqueda de dentistas", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const a = await registrar(app, { nombre: "Dent A", email: "dc-a@test.com", tipo: "dentista" });
  const b = await registrar(app, { nombre: "Dent B", email: "dc-b@test.com", tipo: "dentista" });
  const c = await registrar(app, { nombre: "Dent C", email: "dc-c@test.com", tipo: "dentista" });
  const sinCiudad = await registrar(app, { nombre: "Dent D", email: "dc-d@test.com", tipo: "dentista" });

  await fijarCiudad(app, a, "Barcelona");
  await fijarCiudad(app, b, "Barcelona");
  await fijarCiudad(app, c, "Girona");
  // `sinCiudad` se queda sin ciudad a propósito
  assert.ok(sinCiudad.token);

  await t.test("devuelve las ciudades con dentistas, agrupadas y ordenadas", async () => {
    const res = await request(app).get("/perfiles/ciudades?rol=dentista");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.ciudades, [
      { ciudad: "Barcelona", total: 2 },
      { ciudad: "Girona", total: 1 }
    ]);
  });

  await t.test("sin elegir ciudad salen todos los dentistas, también los que no la tienen", async () => {
    const res = await request(app).get("/perfiles?rol=dentista");
    assert.equal(res.body.perfiles.length, 4);
  });
});

test("el CSV de dentistas exporta lo mismo que muestra el listado", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica CSV", email: "csv-clinica@test.com", tipo: "clinica" });
  const bcn = await registrar(app, { nombre: "CSV Barcelona", email: "csv-bcn@test.com", tipo: "dentista" });
  const bad = await registrar(app, { nombre: "CSV Badalona", email: "csv-bad@test.com", tipo: "dentista" });
  const mad = await registrar(app, { nombre: "CSV Madrid", email: "csv-mad@test.com", tipo: "dentista" });

  await fijarCiudad(app, bcn, "Barcelona");
  await fijarCiudad(app, bad, "Badalona");
  await fijarCiudad(app, mad, "Madrid");

  const nombresDelCsv = (texto) =>
    texto.replace(/^﻿/, "").trim().split("\n").slice(1)
      .map(linea => linea.split(";")[0].replace(/"/g, ""));

  await t.test("filtrando por ciudad exporta solo esa ciudad", async () => {
    const res = await request(app)
      .get("/exportar/perfiles.csv?ciudad=Barcelona")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 200);
    assert.deepEqual(nombresDelCsv(res.text), ["CSV Barcelona"]);
  });

  await t.test("el radio se aplica también al exportar", async () => {
    const listado = await request(app).get("/perfiles?rol=dentista&ciudad=Barcelona&radioKm=25");
    const csv = await request(app)
      .get("/exportar/perfiles.csv?ciudad=Barcelona&radioKm=25")
      .set("Authorization", `Bearer ${clinica.token}`);

    const enListado = listado.body.perfiles.map(p => p.nombre).sort();
    const enCsv = nombresDelCsv(csv.text).sort();
    assert.deepEqual(enCsv, enListado);
    assert.deepEqual(enCsv, ["CSV Badalona", "CSV Barcelona"]);
  });

  await t.test("sin filtros exporta todos, ordenados por ciudad", async () => {
    const res = await request(app)
      .get("/exportar/perfiles.csv")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.deepEqual(nombresDelCsv(res.text), ["CSV Badalona", "CSV Barcelona", "CSV Madrid"]);
  });
});
