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

test("favoritos", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Test", email: "clinica@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Test", email: "dentista@test.com", tipo: "dentista" });

  const oferta = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Lleida", descripcion: "Oferta de prueba" });
  const ofertaId = oferta.body.id;

  await t.test("un dentista puede añadir una publicación a favoritos", async () => {
    const res = await request(app)
      .post("/favoritos")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: ofertaId });

    assert.equal(res.status, 200);
  });

  await t.test("GET /favoritos devuelve la publicación guardada", async () => {
    const res = await request(app)
      .get("/favoritos")
      .set("Authorization", `Bearer ${dentista.token}`);

    assert.equal(res.status, 200);
    assert.ok(res.body.some((f) => f.id === ofertaId));
  });

  await t.test("no se puede añadir la misma publicación dos veces", async () => {
    const res = await request(app)
      .post("/favoritos")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: ofertaId });

    assert.equal(res.status, 400);
  });

  await t.test("DELETE /favoritos/:id la quita de la lista", async () => {
    const eliminar = await request(app)
      .delete(`/favoritos/${ofertaId}`)
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(eliminar.status, 200);

    const listado = await request(app)
      .get("/favoritos")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.ok(!listado.body.some((f) => f.id === ofertaId));
  });
});

test("busquedas guardadas y alertas", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Test", email: "clinica@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Test", email: "dentista@test.com", tipo: "dentista" });

  await t.test("un dentista guarda una búsqueda de ofertas en una ciudad", async () => {
    const res = await request(app)
      .post("/busquedas-guardadas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ tipo: "oferta", ciudad: "Tarragona" });

    assert.equal(res.status, 200);
  });

  await t.test("no hay alertas antes de publicar nada que coincida", async () => {
    const res = await request(app)
      .get("/alertas/no-leidas/count")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.body.total, 0);
  });

  await t.test("al publicar una oferta que coincide, se genera una alerta", async () => {
    await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Tarragona", descripcion: "Oferta que coincide" });

    const res = await request(app)
      .get("/alertas/no-leidas/count")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.body.total, 1);
  });

  await t.test("una oferta en otra ciudad no genera alerta", async () => {
    await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Bilbao", descripcion: "Oferta que no coincide" });

    const res = await request(app)
      .get("/alertas/no-leidas/count")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.body.total, 1); // sigue siendo 1, no ha subido
  });

  await t.test("GET /alertas marca las alertas como leídas", async () => {
    const listado = await request(app)
      .get("/alertas")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(listado.body.length, 1);
    assert.equal(listado.body[0].ciudad, "Tarragona");

    const contador = await request(app)
      .get("/alertas/no-leidas/count")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(contador.body.total, 0);
  });
});
