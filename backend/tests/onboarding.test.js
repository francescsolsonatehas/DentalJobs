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

const paso = (body, id) => body.pasos.find(p => p.id === id);

test("onboarding: primeros pasos del dentista", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const esp = await request(app).get("/especialidades");
  const ortodoncia = esp.body.find(e => e.nombre === "Ortodoncia").id;

  const den = await registrar(app, { nombre: "Dentista Onb", email: "den-onb@test.com", tipo: "dentista" });
  const clinica = await registrar(app, { nombre: "Clínica Onb", email: "clin-onb@test.com", tipo: "clinica" });
  const auth = { Authorization: `Bearer ${den.token}` };

  await t.test("de inicio nada está hecho y no está completado", async () => {
    const res = await request(app).get("/onboarding").set(auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.completado, false);
    assert.equal(paso(res.body, "perfil").hecho, false);
    assert.equal(paso(res.body, "cv").opcional, true);
  });

  await t.test("perfil (ciudad + especialidad) marca el paso", async () => {
    await request(app).put("/auth/actualizar-perfil").set(auth).send({ nombre: "Dentista Onb", ciudad: "Valencia" });
    await request(app).post("/auth/guardar-especialidades").set(auth).send({ especialidades: [ortodoncia] });
    const res = await request(app).get("/onboarding").set(auth);
    assert.equal(paso(res.body, "perfil").hecho, true);
  });

  await t.test("disponibilidad marca el paso", async () => {
    await request(app).put("/disponibilidad").set(auth).send({ dias: ["2026-08-10"] });
    const res = await request(app).get("/onboarding").set(auth);
    assert.equal(paso(res.body, "disponibilidad").hecho, true);
  });

  await t.test("al postularse se completan los pasos obligatorios (el CV es opcional)", async () => {
    const oferta = await request(app).post("/publicaciones").set({ Authorization: `Bearer ${clinica.token}` })
      .send({ tipo: "oferta", ciudad: "Valencia", descripcion: "Generalista" });
    await request(app).post("/candidaturas").set(auth).send({ publicacion_id: oferta.body.id });

    const res = await request(app).get("/onboarding").set(auth);
    assert.equal(paso(res.body, "postular").hecho, true);
    assert.equal(paso(res.body, "cv").hecho, false); // opcional, sigue sin hacer
    assert.equal(res.body.completado, true); // pero completado, porque el CV no cuenta
  });
});

test("onboarding: primeros pasos de la clínica", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clin = await registrar(app, { nombre: "Clínica Onb2", email: "clin-onb2@test.com", tipo: "clinica" });
  const auth = { Authorization: `Bearer ${clin.token}` };

  await t.test("de inicio faltan sede y publicación", async () => {
    const res = await request(app).get("/onboarding").set(auth);
    assert.equal(res.body.completado, false);
    assert.equal(paso(res.body, "sede").hecho, false);
    assert.equal(paso(res.body, "publicar").hecho, false);
  });

  await t.test("crear sede y publicar completa los pasos obligatorios", async () => {
    const sede = await request(app).post("/sedes").set(auth)
      .send({ nombre: "Sede 1", ciudad: "Valencia", direccion: "C/1", codigo_postal: "46001", telefono: "960000000" });
    await request(app).post("/publicaciones").set(auth)
      .send({ tipo: "oferta", ciudad: "Valencia", descripcion: "Generalista", sede_id: sede.body.id });

    const res = await request(app).get("/onboarding").set(auth);
    assert.equal(paso(res.body, "sede").hecho, true);
    assert.equal(paso(res.body, "publicar").hecho, true);
    assert.equal(res.body.completado, true);
  });
});
