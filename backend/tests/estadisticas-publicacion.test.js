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

test("estadísticas por publicación", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Stats", email: "clinica-stats@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Stats", email: "dentista-stats@test.com", tipo: "dentista" });

  const oferta = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Valencia", descripcion: "Oferta con estadísticas" });
  const ofertaId = oferta.body.id;

  await t.test("las vistas se acumulan", async () => {
    await request(app).post(`/publicaciones/${ofertaId}/vista`);
    await request(app).post(`/publicaciones/${ofertaId}/vista`);

    const res = await request(app)
      .get(`/publicaciones/${ofertaId}/estadisticas`)
      .set("Authorization", `Bearer ${clinica.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.vistas, 2);
  });

  await t.test("solo el dueño puede ver las estadísticas", async () => {
    const res = await request(app)
      .get(`/publicaciones/${ofertaId}/estadisticas`)
      .set("Authorization", `Bearer ${dentista.token}`);

    assert.equal(res.status, 403);
  });

  await t.test("el panel refleja postulantes por estado y tiempo de respuesta", async () => {
    const candidatura = await request(app)
      .post("/candidaturas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: ofertaId });

    let res = await request(app)
      .get(`/publicaciones/${ofertaId}/estadisticas`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.body.postulantes.total, 1);
    assert.equal(res.body.postulantes.pendientes, 1);
    assert.equal(res.body.tiempo_medio_respuesta_dias, null);

    await request(app)
      .put(`/candidaturas/${candidatura.body.candidatura_id}`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ estado: "aceptada" });

    res = await request(app)
      .get(`/publicaciones/${ofertaId}/estadisticas`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.body.postulantes.aceptadas, 1);
    assert.equal(res.body.postulantes.pendientes, 0);
  });
});
