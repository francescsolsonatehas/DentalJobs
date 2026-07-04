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

test("recordatorios", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Rec", email: "clinica-rec@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Rec", email: "dentista-rec@test.com", tipo: "dentista" });

  const oferta = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Tarragona", descripcion: "Oferta con recordatorios" });
  const ofertaId = oferta.body.id;

  await request(app)
    .post("/candidaturas")
    .set("Authorization", `Bearer ${dentista.token}`)
    .send({ publicacion_id: ofertaId });

  await t.test("con el umbral por defecto (3 días) una candidatura recién creada no genera recordatorio", async () => {
    const res = await request(app)
      .get("/recordatorios/pendientes")
      .set("Authorization", `Bearer ${clinica.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.pendientes.length, 0);
  });

  await t.test("con umbral 0 la candidatura pendiente aparece como recordatorio para el dueño", async () => {
    const res = await request(app)
      .get("/recordatorios/pendientes?dias=0")
      .set("Authorization", `Bearer ${clinica.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.pendientes.length, 1);
    assert.equal(res.body.pendientes[0].publicacion_id, ofertaId);
    assert.equal(res.body.pendientes[0].candidato_nombre, "Dentista Rec");
  });

  await t.test("el candidato no ve recordatorios de publicaciones ajenas", async () => {
    const res = await request(app)
      .get("/recordatorios/pendientes?dias=0")
      .set("Authorization", `Bearer ${dentista.token}`);

    assert.equal(res.body.pendientes.length, 0);
  });

  await t.test("al responder (aceptar) la candidatura desaparece el recordatorio", async () => {
    const candidatos = await request(app)
      .get(`/publicaciones/${ofertaId}/candidatos`)
      .set("Authorization", `Bearer ${clinica.token}`);
    const candidaturaId = candidatos.body.candidatos[0].id;

    await request(app)
      .put(`/candidaturas/${candidaturaId}`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ estado: "aceptada" });

    const res = await request(app)
      .get("/recordatorios/pendientes?dias=0")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.body.pendientes.length, 0);
  });
});
