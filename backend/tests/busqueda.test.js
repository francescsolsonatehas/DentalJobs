const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");

async function registrarYLoguear(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo, aceptaTerminos: true });
  return { token: res.body.token, usuario: res.body.usuario };
}

test("búsqueda por texto y salario estructurado", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Búsqueda", email: "clinica-busqueda@test.com", tipo: "clinica" });

  await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Barcelona", descripcion: "Ortodoncista con certificación Invisalign", salarioDesde: 2400, salarioHasta: 2900 });

  await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Madrid", descripcion: "Endodoncista con microscopio", salarioDesde: 1800 });

  await t.test("q busca en la descripción", async () => {
    const res = await request(app).get("/publicaciones?tipo=oferta&q=invisalign");
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].ciudad, "Barcelona");

    const nada = await request(app).get("/publicaciones?tipo=oferta&q=periodoncia");
    assert.equal(nada.body.length, 0);
  });

  await t.test("q también encuentra por ciudad y nombre de la clínica", async () => {
    const porCiudad = await request(app).get("/publicaciones?tipo=oferta&q=madrid");
    assert.equal(porCiudad.body.length, 1);

    const porNombre = await request(app).get("/publicaciones?tipo=oferta&q=Búsqueda");
    assert.equal(porNombre.body.length, 2);
  });

  await t.test("los campos numéricos rellenan salario_min y salario_max", async () => {
    const res = await request(app).get("/publicaciones?tipo=oferta&ciudad=Barcelona");
    assert.equal(res.body[0].salario_min, 2400);
    assert.equal(res.body[0].salario_max, 2900);
  });

  await t.test("filtro por rango salarial", async () => {
    const min = await request(app).get("/publicaciones?tipo=oferta&salarioMin=2000");
    assert.equal(min.body.length, 1);
    assert.equal(min.body[0].ciudad, "Barcelona");

    const max = await request(app).get("/publicaciones?tipo=oferta&salarioMax=2000");
    assert.equal(max.body.length, 1);
    assert.equal(max.body[0].ciudad, "Madrid");
  });

  // Lo usan las notificaciones que hablan de varias publicaciones a la vez, para
  // llevar exactamente a esas.
  await t.test("filtro por lista de ids", async () => {
    const todas = await request(app).get("/publicaciones?tipo=oferta");
    assert.ok(todas.body.length >= 2);
    const elegida = todas.body[0];

    const una = await request(app).get(`/publicaciones?ids=${elegida.id}`);
    assert.equal(una.body.length, 1);
    assert.equal(una.body[0].id, elegida.id);

    const dos = await request(app).get(`/publicaciones?ids=${todas.body[0].id},${todas.body[1].id}`);
    assert.equal(dos.body.length, 2);

    // Un id que no existe no debe colar el listado entero
    const ninguna = await request(app).get("/publicaciones?ids=99999999");
    assert.equal(ninguna.body.length, 0);

    // Ni tampoco una lista con basura
    const basura = await request(app).get("/publicaciones?ids=abc");
    assert.equal(basura.body.length, 0);
  });
});
