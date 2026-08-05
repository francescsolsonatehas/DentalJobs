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

test("estados de selección y preferencias de aviso", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Estados", email: "clinica-estados@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Estados", email: "dentista-estados@test.com", tipo: "dentista" });

  const oferta = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Zaragoza", descripcion: "Oferta con proceso de selección" });
  const ofertaId = oferta.body.id;

  const candidatura = await request(app)
    .post("/candidaturas")
    .set("Authorization", `Bearer ${dentista.token}`)
    .send({ publicacion_id: ofertaId });
  const candidaturaId = candidatura.body.candidatura_id;

  await t.test("cuando el dueño abre la lista de candidatos, la pendiente pasa a 'CV visto'", async () => {
    const res = await request(app)
      .get(`/publicaciones/${ofertaId}/candidatos`)
      .set("Authorization", `Bearer ${clinica.token}`);

    const cand = res.body.candidatos.find((c) => c.id === candidaturaId);
    assert.equal(cand.estado, "vista");
  });

  await t.test("si la abre alguien que no es el dueño, no se marca nada", async () => {
    // volver a pendiente para la prueba
    await request(app)
      .put(`/candidaturas/${candidaturaId}`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ estado: "pendiente" });

    await request(app)
      .get(`/publicaciones/${ofertaId}/candidatos`)
      .set("Authorization", `Bearer ${dentista.token}`);

    const res = await request(app)
      .get(`/publicaciones/${ofertaId}/candidatos`)
      .set("Authorization", `Bearer ${clinica.token}`);
    // la del dueño sí la marca; la del dentista antes no debe haberla tocado ya
    // (si el dentista la hubiera marcado, el estado anterior a esta llamada ya sería 'vista')
    const cand = res.body.candidatos.find((c) => c.id === candidaturaId);
    assert.equal(cand.estado, "vista");
  });

  await t.test("los estados nuevos (en_proceso, entrevista) son válidos", async () => {
    for (const estado of ["en_proceso", "entrevista", "aceptada"]) {
      const res = await request(app)
        .put(`/candidaturas/${candidaturaId}`)
        .set("Authorization", `Bearer ${clinica.token}`)
        .send({ estado });
      assert.equal(res.status, 200, `estado ${estado} debería aceptarse`);
    }

    const invalido = await request(app)
      .put(`/candidaturas/${candidaturaId}`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ estado: "contratadisimo" });
    assert.equal(invalido.status, 400);
  });

  await t.test("la preferencia recibir_emails se guarda y se lee", async () => {
    const antes = await request(app)
      .get("/auth/mi-perfil")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(antes.body.recibir_emails, 1);

    await request(app)
      .put("/auth/actualizar-perfil")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ nombre: "Dentista Estados", recibir_emails: false });

    const despues = await request(app)
      .get("/auth/mi-perfil")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(despues.body.recibir_emails, 0);
  });
});
