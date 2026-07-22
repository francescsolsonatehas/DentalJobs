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
