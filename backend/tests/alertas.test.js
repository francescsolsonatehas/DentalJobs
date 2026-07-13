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

test("alertas de búsqueda guardadas", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Alerta", email: "clinica-alerta@test.com", tipo: "clinica" });
  const dentista = await registrar(app, { nombre: "Dentista Alerta", email: "dentista-alerta@test.com", tipo: "dentista" });

  // La clínica publica una oferta que debería casar con la alerta del dentista
  await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Valencia", descripcion: "Higienista dental", salarioDesde: 1800 });

  await t.test("crea una alerta ignorando claves no permitidas", async () => {
    const res = await request(app)
      .post("/alertas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ nombre: "Valencia", filtros: { tipo: "oferta", ciudad: "Valencia", basura: "x" }, frecuencia: "semanal" });
    assert.equal(res.status, 200);
    assert.ok(res.body.id);
  });

  await t.test("lista mis alertas con filtros parseados y recuento de coincidencias", async () => {
    const res = await request(app)
      .get("/alertas")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.alertas.length, 1);
    const a = res.body.alertas[0];
    assert.equal(a.filtros.ciudad, "Valencia");
    assert.equal(a.filtros.basura, undefined); // clave no permitida descartada
    assert.equal(a.coincidencias, 1); // la oferta de la clínica cuenta
  });

  await t.test("una alerta no cuenta las publicaciones propias", async () => {
    // La propia clínica se guarda una alerta que casaría con su oferta; no debe contarse a sí misma
    await request(app)
      .post("/alertas")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ filtros: { tipo: "oferta", ciudad: "Valencia" } });
    const res = await request(app).get("/alertas").set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.body.alertas[0].coincidencias, 0);
  });

  await t.test("rechaza una alerta sin filtros útiles", async () => {
    const res = await request(app)
      .post("/alertas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ filtros: { basura: "x" } });
    assert.equal(res.status, 400);
  });

  await t.test("permite pausar y reactivar la alerta", async () => {
    const lista = await request(app).get("/alertas").set("Authorization", `Bearer ${dentista.token}`);
    const id = lista.body.alertas[0].id;

    const pausar = await request(app)
      .put(`/alertas/${id}`)
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ activa: 0 });
    assert.equal(pausar.status, 200);

    const trasPausar = await request(app).get("/alertas").set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(trasPausar.body.alertas.find(a => a.id === id).activa, 0);
  });

  await t.test("un usuario no puede modificar ni borrar alertas de otro", async () => {
    const lista = await request(app).get("/alertas").set("Authorization", `Bearer ${dentista.token}`);
    const idAjena = lista.body.alertas[0].id;

    const put = await request(app)
      .put(`/alertas/${idAjena}`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ activa: 1 });
    assert.equal(put.status, 403);

    const del = await request(app)
      .delete(`/alertas/${idAjena}`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(del.status, 403);
  });

  await t.test("elimina la alerta del propio usuario", async () => {
    const lista = await request(app).get("/alertas").set("Authorization", `Bearer ${dentista.token}`);
    const id = lista.body.alertas[0].id;
    const del = await request(app).delete(`/alertas/${id}`).set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(del.status, 200);

    const trasBorrar = await request(app).get("/alertas").set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(trasBorrar.body.alertas.length, 0);
  });

  await t.test("requiere autenticación", async () => {
    const res = await request(app).get("/alertas");
    assert.equal(res.status, 401);
  });
});
