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

test("publicaciones", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Test", email: "clinica@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Test", email: "dentista@test.com", tipo: "dentista" });

  await t.test("una clínica no puede crear una 'solicitud'", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "solicitud", ciudad: "Lleida", descripcion: "x" });

    assert.equal(res.status, 403);
  });

  await t.test("un dentista no puede crear una 'oferta'", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ tipo: "oferta", ciudad: "Lleida", descripcion: "x" });

    assert.equal(res.status, 403);
  });

  await t.test("GET /publicaciones excluye las publicaciones borradas (activo=0)", async () => {
    const crear = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Lleida", descripcion: "Oferta de prueba" });

    const pubId = crear.body.id;

    let listado = await request(app).get("/publicaciones");
    assert.ok(listado.body.some((p) => p.id === pubId));

    await request(app)
      .delete(`/publicaciones/${pubId}`)
      .set("Authorization", `Bearer ${clinica.token}`);

    listado = await request(app).get("/publicaciones");
    assert.ok(!listado.body.some((p) => p.id === pubId));
  });

  await t.test("al borrar una publicación, las candidaturas asociadas quedan 'retirada'", async () => {
    const crear = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Lleida", descripcion: "Oferta con candidato" });

    const pubId = crear.body.id;

    await request(app)
      .post("/candidaturas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: pubId });

    await request(app)
      .delete(`/publicaciones/${pubId}`)
      .set("Authorization", `Bearer ${clinica.token}`);

    // /publicaciones/:id/candidatos no filtra por publicación activa, así que
    // expone el estado real de la candidatura tras el borrado.
    const candidatos = await request(app)
      .get(`/publicaciones/${pubId}/candidatos`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(candidatos.body.candidatos[0].estado, "retirada");

    // Y por tanto tampoco debe aparecer como postulación activa del dentista
    const misPostulaciones = await request(app)
      .get("/candidaturas/mis-postulaciones")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.ok(!misPostulaciones.body.candidaturas.some((c) => c.publicacion_id === pubId));
  });

  await t.test("GET /publicaciones respeta el límite de paginación", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/publicaciones")
        .set("Authorization", `Bearer ${clinica.token}`)
        .send({ tipo: "oferta", ciudad: `Ciudad${i}`, descripcion: "x" });
    }

    const res = await request(app).get("/publicaciones?limit=2&page=1");
    assert.equal(res.status, 200);
    assert.ok(res.body.length <= 2);
  });
});
