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

test("búsqueda por radio en km", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Radio", email: "clinica-radio@test.com", tipo: "clinica" });
  const publicar = (ciudad) =>
    request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad, descripcion: `Oferta en ${ciudad}`, salarioDesde: 1800 });

  // Barcelona (centro), Tarragona (~90 km), Girona (~85 km), Lleida (~150 km)
  await publicar("Barcelona");
  await publicar("Tarragona");
  await publicar("Girona");
  await publicar("Lleida");

  await t.test("geocodifica la ciudad al publicar (guarda lat/lon)", async () => {
    const res = await request(app).get("/publicaciones?tipo=oferta&ciudad=Barcelona");
    assert.ok(res.body[0].lat, "la publicación debe tener latitud");
    assert.ok(res.body[0].lon, "la publicación debe tener longitud");
  });

  await t.test("radio de 50 km desde Barcelona solo trae Barcelona", async () => {
    const res = await request(app).get("/publicaciones?tipo=oferta&ciudad=Barcelona&radioKm=50");
    const ciudades = res.body.map(p => p.ciudad);
    assert.deepEqual(ciudades, ["Barcelona"]);
  });

  await t.test("radio de 100 km incluye Tarragona y Girona pero no Lleida", async () => {
    const res = await request(app).get("/publicaciones?tipo=oferta&ciudad=Barcelona&radioKm=100");
    const ciudades = res.body.map(p => p.ciudad).sort();
    assert.ok(ciudades.includes("Barcelona"));
    assert.ok(ciudades.includes("Tarragona"));
    assert.ok(ciudades.includes("Girona"));
    assert.ok(!ciudades.includes("Lleida"), "Lleida (~150 km) queda fuera del radio de 100 km");
  });

  await t.test("una ciudad no reconocida ignora el radio y cae al filtro por ciudad", async () => {
    const res = await request(app).get("/publicaciones?tipo=oferta&ciudad=CiudadInventada&radioKm=50");
    assert.equal(res.body.length, 0);
  });

  await t.test("sin radio, el filtro por ciudad sigue siendo por coincidencia de texto", async () => {
    const res = await request(app).get("/publicaciones?tipo=oferta&ciudad=Barcelona");
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].ciudad, "Barcelona");
  });
});
