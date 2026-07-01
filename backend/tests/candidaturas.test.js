const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");

async function registrarYLoguear(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo });
  return { token: res.body.token, usuario: res.body.usuario };
}

test("candidaturas", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Test", email: "clinica@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Test", email: "dentista@test.com", tipo: "dentista" });

  const oferta = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Lleida", descripcion: "Oferta de prueba" });
  const ofertaId = oferta.body.id;

  await t.test("un dentista puede postularse a una oferta", async () => {
    const res = await request(app)
      .post("/candidaturas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: ofertaId });

    assert.equal(res.status, 200);
    assert.ok(res.body.candidatura_id);
  });

  await t.test("no se puede postular dos veces a la misma oferta", async () => {
    const res = await request(app)
      .post("/candidaturas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: ofertaId });

    assert.equal(res.status, 400);
  });

  await t.test("/candidaturas/mis-postulaciones devuelve publicacion_tipo", async () => {
    const res = await request(app)
      .get("/candidaturas/mis-postulaciones")
      .set("Authorization", `Bearer ${dentista.token}`);

    const postulacion = res.body.candidaturas.find((c) => c.publicacion_id === ofertaId);
    assert.ok(postulacion);
    assert.equal(postulacion.publicacion_tipo, "oferta");
  });

  await t.test("la clínica puede aceptar y luego deshacer (poner pendiente) la candidatura", async () => {
    const candidatos = await request(app)
      .get(`/publicaciones/${ofertaId}/candidatos`)
      .set("Authorization", `Bearer ${clinica.token}`);
    const candidaturaId = candidatos.body.candidatos[0].id;

    const aceptar = await request(app)
      .put(`/candidaturas/${candidaturaId}`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ estado: "aceptada" });
    assert.equal(aceptar.status, 200);

    const deshacer = await request(app)
      .put(`/candidaturas/${candidaturaId}`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ estado: "pendiente" });
    assert.equal(deshacer.status, 200);

    const listado = await request(app)
      .get(`/publicaciones/${ofertaId}/candidatos`)
      .set("Authorization", `Bearer ${clinica.token}`);
    const actualizada = listado.body.candidatos.find((c) => c.id === candidaturaId);
    assert.equal(actualizada.estado, "pendiente");
  });

  await t.test("el dentista puede retirar su propia postulación", async () => {
    const antes = await request(app)
      .get("/candidaturas/mis-postulaciones")
      .set("Authorization", `Bearer ${dentista.token}`);
    const candidaturaId = antes.body.candidaturas.find((c) => c.publicacion_id === ofertaId).id;

    const retirar = await request(app)
      .delete(`/candidaturas/${candidaturaId}`)
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(retirar.status, 200);

    const despues = await request(app)
      .get("/candidaturas/mis-postulaciones")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.ok(!despues.body.candidaturas.some((c) => c.publicacion_id === ofertaId));
  });
});
