const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");
const { expandirRango, sanearDias } = require("../fechas");

async function registrar(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo, aceptaTerminos: true });
  return { token: res.body.token, usuario: res.body.usuario };
}

test("helper de fechas: expandirRango y sanearDias", () => {
  assert.deepEqual(expandirRango("2026-08-01", "2026-08-03"), ["2026-08-01", "2026-08-02", "2026-08-03"]);
  assert.deepEqual(expandirRango("2026-08-10", null), ["2026-08-10"]);
  assert.deepEqual(expandirRango("2026-08-05", "2026-08-01"), ["2026-08-05"]); // rango invertido → solo el inicio
  assert.deepEqual(expandirRango(null, "2026-08-01"), []);

  assert.deepEqual(sanearDias(["2026-08-02", "2026-08-01", "2026-08-01", "basura"]), ["2026-08-01", "2026-08-02"]);
  assert.deepEqual(sanearDias("no-es-array"), []);
});

test("suplencias por días concretos + filtro por fecha", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Días", email: "clinica-dias@test.com", tipo: "clinica" });
  const dentista = await registrar(app, { nombre: "Dentista Días", email: "dentista-dias@test.com", tipo: "dentista" });

  let suplenciaSueltosId, suplenciaLegacyId;

  await t.test("crea una suplencia con días sueltos y calcula fecha_desde/hasta", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "suplencia", ciudad: "Valencia", descripcion: "Viernes de agosto", dias: ["2026-08-21", "2026-08-07", "2026-08-14"] });
    assert.equal(res.status, 200);
    suplenciaSueltosId = res.body.id;

    const det = await request(app).get(`/publicaciones/${suplenciaSueltosId}`);
    assert.deepEqual(det.body.dias, ["2026-08-07", "2026-08-14", "2026-08-21"]);
    assert.equal(det.body.fecha_desde, "2026-08-07");
    assert.equal(det.body.fecha_hasta, "2026-08-21");
  });

  await t.test("crea una suplencia con rango legacy y lo expande a días", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "suplencia", ciudad: "Valencia", descripcion: "Semana", fecha_desde: "2026-09-01", fecha_hasta: "2026-09-03" });
    assert.equal(res.status, 200);
    suplenciaLegacyId = res.body.id;

    const det = await request(app).get(`/publicaciones/${suplenciaLegacyId}`);
    assert.deepEqual(det.body.dias, ["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  await t.test("rechaza una suplencia sin ningún día", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "suplencia", ciudad: "Valencia", descripcion: "Sin fechas" });
    assert.equal(res.status, 400);
  });

  await t.test("filtra suplencias por un día concreto", async () => {
    const res = await request(app).get("/publicaciones").query({ tipo: "suplencia", fecha: "2026-08-14" });
    const ids = res.body.map(p => p.id);
    assert.ok(ids.includes(suplenciaSueltosId));
    assert.ok(!ids.includes(suplenciaLegacyId));
  });

  await t.test("filtra suplencias por rango de fechas", async () => {
    const res = await request(app).get("/publicaciones").query({ tipo: "suplencia", fechaDesde: "2026-09-02", fechaHasta: "2026-09-30" });
    const ids = res.body.map(p => p.id);
    assert.ok(ids.includes(suplenciaLegacyId));
    assert.ok(!ids.includes(suplenciaSueltosId));
  });

  await t.test("editar los días reemplaza el conjunto y recalcula fecha_desde/hasta", async () => {
    const res = await request(app)
      .put(`/publicaciones/${suplenciaSueltosId}`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ descripcion: "Viernes de agosto", ciudad: "Valencia", dias: ["2026-08-28"] });
    assert.equal(res.status, 200);

    const det = await request(app).get(`/publicaciones/${suplenciaSueltosId}`);
    assert.deepEqual(det.body.dias, ["2026-08-28"]);
    assert.equal(det.body.fecha_desde, "2026-08-28");
    assert.equal(det.body.fecha_hasta, "2026-08-28");

    // El día viejo ya no casa en el filtro
    const viejo = await request(app).get("/publicaciones").query({ tipo: "suplencia", fecha: "2026-08-14" });
    assert.ok(!viejo.body.map(p => p.id).includes(suplenciaSueltosId));
  });

  await t.test("disponibilidad del dentista: guardar y releer", async () => {
    const put = await request(app)
      .put("/disponibilidad")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ dias: ["2026-08-14", "2026-08-07", "2026-08-14"] });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.dias, ["2026-08-07", "2026-08-14"]);

    const get = await request(app)
      .get("/disponibilidad")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.deepEqual(get.body.dias, ["2026-08-07", "2026-08-14"]);
  });

  await t.test("una clínica no tiene disponibilidad", async () => {
    const res = await request(app)
      .put("/disponibilidad")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ dias: ["2026-08-01"] });
    assert.equal(res.status, 403);
  });
});
