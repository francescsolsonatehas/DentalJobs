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

test("suplencias y turnos sueltos", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Suplencias", email: "clinica-suplencias@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Suplencias", email: "dentista-suplencias@test.com", tipo: "dentista" });

  let suplenciaId;

  await t.test("una clínica puede crear una suplencia con fecha de inicio", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({
        tipo: "suplencia", ciudad: "Reus", descripcion: "Cubrir baja de una semana",
        fecha_desde: "2026-08-01", fecha_hasta: "2026-08-07", urgente: true
      });
    assert.equal(res.status, 200);
    suplenciaId = res.body.id;
  });

  await t.test("una suplencia sin fecha_desde se rechaza", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "suplencia", ciudad: "Reus", descripcion: "Sin fecha de inicio" });
    assert.equal(res.status, 400);
  });

  await t.test("un dentista no puede crear una suplencia", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ tipo: "suplencia", ciudad: "Reus", descripcion: "Intento de dentista", fecha_desde: "2026-08-01" });
    assert.equal(res.status, 403);
  });

  await t.test("la suplencia se puede filtrar por tipo y ordenar por fecha/urgencia", async () => {
    await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "suplencia", ciudad: "Reus", descripcion: "Turno suelto no urgente", fecha_desde: "2026-07-15" });

    const res = await request(app).get("/publicaciones?tipo=suplencia&sort=fecha");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
    // La urgente (fecha 08-01) debe ir primero pese a tener fecha más tardía
    assert.equal(res.body[0].urgente, 1);
  });

  await t.test("un dentista puede postularse a una suplencia como a cualquier otra publicación", async () => {
    const res = await request(app)
      .post("/candidaturas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: suplenciaId });
    assert.equal(res.status, 200);
  });

  await t.test("la suplencia cuenta en /publicaciones/usuario/:id/candidatos junto a las ofertas", async () => {
    const res = await request(app)
      .get(`/publicaciones/usuario/${clinica.usuario.id}/candidatos`)
      .set("Authorization", `Bearer ${clinica.token}`);
    const entrada = res.body.ofertas.find(o => o.publicacion_id === suplenciaId);
    assert.ok(entrada);
    assert.equal(entrada.candidatos_count, 1);
  });

  await t.test("la suplencia tiene página pública con las fechas y el badge de urgencia", async () => {
    const res = await request(app).get(`/oferta/${suplenciaId}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /2026-08-01/);
    assert.match(res.text, /Urgente/);
  });

  await t.test("el sitemap incluye tanto ofertas como suplencias", async () => {
    const oferta = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Reus", descripcion: "Oferta normal de control" });

    const res = await request(app).get("/sitemap.xml");
    assert.ok(res.text.includes(`/oferta/${suplenciaId}</loc>`));
    assert.ok(res.text.includes(`/oferta/${oferta.body.id}</loc>`));
  });

  await t.test("'Mis publicaciones' de una clínica devuelve tanto ofertas como suplencias sin filtrar por tipo", async () => {
    const res = await request(app).get(`/publicaciones?usuario_id=${clinica.usuario.id}&limit=100`);
    const tipos = new Set(res.body.map(p => p.tipo));
    assert.ok(tipos.has("oferta"));
    assert.ok(tipos.has("suplencia"));
  });
});
