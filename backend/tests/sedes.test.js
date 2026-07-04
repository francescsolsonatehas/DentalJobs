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

test("sedes", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Sedes", email: "clinica-sedes@test.com", tipo: "clinica" });
  const otraClinica = await registrarYLoguear(app, { nombre: "Otra Clínica Sedes", email: "otra-sedes@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Sedes", email: "dentista-sedes@test.com", tipo: "dentista" });

  let sedeId;

  await t.test("una clínica puede crear sedes", async () => {
    const res = await request(app)
      .post("/sedes")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ nombre: "Sede Centro", ciudad: "Madrid", direccion: "Gran Vía 1" });

    assert.equal(res.status, 200);
    sedeId = res.body.id;
    assert.ok(sedeId);
  });

  await t.test("un dentista no puede crear sedes", async () => {
    const res = await request(app)
      .post("/sedes")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ nombre: "Sede X", ciudad: "Madrid" });

    assert.equal(res.status, 403);
  });

  await t.test("cada clínica ve solo sus sedes", async () => {
    const propias = await request(app)
      .get("/sedes")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(propias.body.sedes.length, 1);
    assert.equal(propias.body.sedes[0].nombre, "Sede Centro");

    const ajenas = await request(app)
      .get("/sedes")
      .set("Authorization", `Bearer ${otraClinica.token}`);
    assert.equal(ajenas.body.sedes.length, 0);
  });

  await t.test("se puede publicar una oferta asociada a una sede propia", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Madrid", descripcion: "Oferta en sede centro", sede_id: sedeId });

    assert.equal(res.status, 200);

    const pub = await request(app).get(`/publicaciones/${res.body.id}`);
    assert.equal(pub.body.sede_id, sedeId);
  });

  await t.test("no se puede publicar con una sede ajena", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${otraClinica.token}`)
      .send({ tipo: "oferta", ciudad: "Madrid", descripcion: "Oferta con sede ajena", sede_id: sedeId });

    assert.equal(res.status, 403);
  });

  await t.test("al eliminar la sede, sus publicaciones quedan sin sede pero activas", async () => {
    const res = await request(app)
      .delete(`/sedes/${sedeId}`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 200);

    const pubs = await request(app).get(`/publicaciones?tipo=oferta&usuario_id=${clinica.usuario.id}`);
    assert.equal(pubs.body.length, 1);
    assert.equal(pubs.body[0].sede_id, null);
  });
});
