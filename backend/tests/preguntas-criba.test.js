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

test("preguntas de criba (killer questions)", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Criba", email: "clinica-criba@test.com", tipo: "clinica" });
  const dentista = await registrar(app, { nombre: "Dentista Criba", email: "dentista-criba@test.com", tipo: "dentista" });

  const crear = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({
      tipo: "oferta",
      ciudad: "Sevilla",
      descripcion: "Ortodoncista",
      preguntas: ["¿Años de experiencia?", "  ", "¿Disponibilidad inmediata?"]
    });
  const ofertaId = crear.body.id;

  await t.test("descarta preguntas vacías al guardar", async () => {
    const res = await request(app).get(`/publicaciones/${ofertaId}`);
    const preguntas = JSON.parse(res.body.preguntas);
    assert.deepEqual(preguntas, ["¿Años de experiencia?", "¿Disponibilidad inmediata?"]);
  });

  await t.test("limita a un máximo de 3 preguntas", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Sevilla", descripcion: "Con muchas preguntas", preguntas: ["P1", "P2", "P3", "P4", "P5"] });
    const det = await request(app).get(`/publicaciones/${res.body.id}`);
    assert.deepEqual(JSON.parse(det.body.preguntas), ["P1", "P2", "P3"]);
  });

  await t.test("rechaza postularse sin responder a las preguntas", async () => {
    const res = await request(app)
      .post("/candidaturas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: ofertaId });
    assert.equal(res.status, 400);
  });

  await t.test("rechaza si alguna respuesta está vacía", async () => {
    const res = await request(app)
      .post("/candidaturas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: ofertaId, respuestas: ["5 años", "   "] });
    assert.equal(res.status, 400);
  });

  await t.test("acepta la postulación con todas las respuestas", async () => {
    const res = await request(app)
      .post("/candidaturas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: ofertaId, respuestas: ["5 años", "Sí, de inmediato"] });
    assert.equal(res.status, 200);
  });

  await t.test("la clínica ve las respuestas emparejadas con sus preguntas", async () => {
    const res = await request(app)
      .get(`/publicaciones/${ofertaId}/candidatos`)
      .set("Authorization", `Bearer ${clinica.token}`);
    const candidato = res.body.candidatos[0];
    const respuestas = JSON.parse(candidato.respuestas);
    assert.deepEqual(respuestas, [
      { pregunta: "¿Años de experiencia?", respuesta: "5 años" },
      { pregunta: "¿Disponibilidad inmediata?", respuesta: "Sí, de inmediato" }
    ]);
  });

  await t.test("una oferta sin preguntas no exige respuestas", async () => {
    const otra = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Sevilla", descripcion: "Sin criba" });
    const res = await request(app)
      .post("/candidaturas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: otra.body.id });
    assert.equal(res.status, 200);
  });

  await t.test("editar la oferta actualiza sus preguntas", async () => {
    await request(app)
      .put(`/publicaciones/${ofertaId}`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ descripcion: "Ortodoncista", ciudad: "Sevilla", preguntas: ["¿Nueva pregunta única?"] });
    const res = await request(app).get(`/publicaciones/${ofertaId}`);
    assert.deepEqual(JSON.parse(res.body.preguntas), ["¿Nueva pregunta única?"]);
  });
});
