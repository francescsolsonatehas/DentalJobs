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

test("resenyas", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Res", email: "clinica-res@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Res", email: "dentista-res@test.com", tipo: "dentista" });
  const intruso = await registrarYLoguear(app, { nombre: "Dentista Intruso", email: "intruso-res@test.com", tipo: "dentista" });

  const oferta = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Barcelona", descripcion: "Oferta con reseñas" });
  const ofertaId = oferta.body.id;

  const candidatura = await request(app)
    .post("/candidaturas")
    .set("Authorization", `Bearer ${dentista.token}`)
    .send({ publicacion_id: ofertaId });
  const candidaturaId = candidatura.body.candidatura_id;

  await t.test("no se puede valorar una candidatura no aceptada", async () => {
    const res = await request(app)
      .post("/resenyas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ candidatura_id: candidaturaId, puntuacion: 5 });

    assert.equal(res.status, 400);
  });

  await request(app)
    .put(`/candidaturas/${candidaturaId}`)
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ estado: "aceptada" });

  await t.test("un tercero ajeno a la candidatura no puede valorar", async () => {
    const res = await request(app)
      .post("/resenyas")
      .set("Authorization", `Bearer ${intruso.token}`)
      .send({ candidatura_id: candidaturaId, puntuacion: 5 });

    assert.equal(res.status, 403);
  });

  await t.test("la puntuación debe estar entre 1 y 5", async () => {
    const res = await request(app)
      .post("/resenyas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ candidatura_id: candidaturaId, puntuacion: 7 });

    assert.equal(res.status, 400);
  });

  await t.test("el dentista puede valorar a la clínica tras ser aceptado", async () => {
    const res = await request(app)
      .post("/resenyas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ candidatura_id: candidaturaId, puntuacion: 5, comentario: "Gran equipo" });

    assert.equal(res.status, 200);
  });

  await t.test("no se puede valorar dos veces la misma candidatura", async () => {
    const res = await request(app)
      .post("/resenyas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ candidatura_id: candidaturaId, puntuacion: 3 });

    assert.equal(res.status, 400);
  });

  await t.test("la clínica puede valorar al dentista (bidireccional)", async () => {
    const res = await request(app)
      .post("/resenyas")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ candidatura_id: candidaturaId, puntuacion: 4, comentario: "Muy profesional" });

    assert.equal(res.status, 200);
  });

  await t.test("las reseñas recibidas y la media se consultan por usuario", async () => {
    const deClinica = await request(app).get(`/resenyas/usuario/${clinica.usuario.id}`);
    assert.equal(deClinica.status, 200);
    assert.equal(deClinica.body.total, 1);
    assert.equal(deClinica.body.media, 5);
    assert.equal(deClinica.body.resenyas[0].autor_nombre, "Dentista Res");

    const deDentista = await request(app).get(`/resenyas/usuario/${dentista.usuario.id}`);
    assert.equal(deDentista.body.total, 1);
    assert.equal(deDentista.body.media, 4);
    assert.equal(deDentista.body.resenyas[0].comentario, "Muy profesional");
  });
});
