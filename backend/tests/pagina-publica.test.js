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

test("página pública de oferta y sitemap", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Pública", email: "clinica-publica@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Pública", email: "dentista-publica@test.com", tipo: "dentista" });

  const oferta = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Girona", descripcion: "Buscamos <b>ortodoncista</b> con experiencia", salario: "2800€/mes" });
  const ofertaId = oferta.body.id;

  const solicitud = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${dentista.token}`)
    .send({ tipo: "solicitud", ciudad: "Girona", descripcion: "Dentista busca trabajo" });

  await t.test("la oferta tiene página pública sin necesidad de cuenta", async () => {
    const res = await request(app).get(`/oferta/${ofertaId}`);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /Girona/);
    assert.match(res.text, /2800€\/mes/);
    assert.match(res.text, /Clínica Pública/);
    // El HTML del usuario va escapado
    assert.ok(!res.text.includes("<b>ortodoncista</b>"));
    assert.ok(res.text.includes("&lt;b&gt;ortodoncista&lt;/b&gt;"));
  });

  await t.test("las solicitudes de dentistas NO tienen página pública", async () => {
    const res = await request(app).get(`/oferta/${solicitud.body.id}`);
    assert.equal(res.status, 404);
  });

  await t.test("una oferta retirada deja de ser pública", async () => {
    const otra = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Vic", descripcion: "Oferta temporal" });

    await request(app)
      .delete(`/publicaciones/${otra.body.id}`)
      .set("Authorization", `Bearer ${clinica.token}`);

    const res = await request(app).get(`/oferta/${otra.body.id}`);
    assert.equal(res.status, 404);
  });

  await t.test("el sitemap lista las ofertas activas (y solo las ofertas)", async () => {
    const res = await request(app).get("/sitemap.xml");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /xml/);
    assert.ok(res.text.includes(`/oferta/${ofertaId}</loc>`));
    assert.ok(!res.text.includes(`/oferta/${solicitud.body.id}</loc>`));
  });

  await t.test("robots.txt apunta al sitemap", async () => {
    const res = await request(app).get("/robots.txt");
    assert.equal(res.status, 200);
    assert.match(res.text, /Sitemap: .*\/sitemap\.xml/);
  });
});
