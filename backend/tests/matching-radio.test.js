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

const auth = t => ({ Authorization: `Bearer ${t}` });

// Prepara un dentista en una ciudad, disponible un día, con un radio opcional.
async function prepararDentista(app, { nombre, email, ciudad, dia, radio_km }) {
  const den = await registrar(app, { nombre, email, tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set(auth(den.token)).send({ nombre, ciudad });
  const cuerpo = { dias: [dia] };
  if (radio_km !== undefined) cuerpo.radio_km = radio_km;
  await request(app).put("/disponibilidad").set(auth(den.token)).send(cuerpo);
  return den;
}

test("matching de suplencias por radio en km", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Radio", email: "clin-radio@test.com", tipo: "clinica" });
  const DIA = "2026-08-10";

  // Suplencia en Valencia, sin especialidad concreta, un día
  const sup = await request(app).post("/publicaciones").set(auth(clinica.token))
    .send({ tipo: "suplencia", ciudad: "Valencia", descripcion: "Suplencia agosto", dias: [DIA] });
  const supId = sup.body.id;

  // Torrent está a ~8 km de Valencia: con el radio por defecto (25 km), casa aunque
  // sea otra ciudad. Antes del matching por radio, no habría casado.
  const denCerca = await prepararDentista(app, { nombre: "Cerca Torrent", email: "cerca@test.com", ciudad: "Torrent", dia: DIA });
  // Madrid está a ~300 km: fuera de cualquier radio razonable.
  const denLejos = await prepararDentista(app, { nombre: "Lejos Madrid", email: "lejos@test.com", ciudad: "Madrid", dia: DIA });
  // En Torrent pero con radio 0 ("solo mi ciudad"): no debe casar con Valencia.
  const denSoloCiudad = await prepararDentista(app, { nombre: "Solo Ciudad", email: "solo@test.com", ciudad: "Torrent", dia: DIA, radio_km: 0 });

  await t.test("casa el de la población cercana (dentro del radio), no el lejano", async () => {
    const res = await request(app).get(`/suplencias/${supId}/dentistas-disponibles`).set(auth(clinica.token));
    assert.equal(res.status, 200);
    const ids = res.body.dentistas.map(d => d.id);
    assert.ok(ids.includes(denCerca.usuario.id), "el de Torrent debería casar");
    assert.ok(!ids.includes(denLejos.usuario.id), "el de Madrid no debería casar");
  });

  await t.test("con radio 0 (solo mi ciudad) no casa con una ciudad distinta", async () => {
    const res = await request(app).get(`/suplencias/${supId}/dentistas-disponibles`).set(auth(clinica.token));
    const ids = res.body.dentistas.map(d => d.id);
    assert.ok(!ids.includes(denSoloCiudad.usuario.id), "con radio 0 no debería casar con Valencia");
  });

  await t.test("cada dentista trae la distancia en km a la suplencia", async () => {
    const res = await request(app).get(`/suplencias/${supId}/dentistas-disponibles`).set(auth(clinica.token));
    const cerca = res.body.dentistas.find(d => d.id === denCerca.usuario.id);
    assert.ok(cerca.km >= 5 && cerca.km <= 15, `Torrent→Valencia debería rondar 8 km, fue ${cerca.km}`);
    // No se filtran los campos internos de geo al cliente
    assert.equal(cerca.u_lat, undefined);
    assert.equal(cerca.ciudad_coincide, undefined);
  });

  await t.test("misma ciudad sigue casando aunque no haya coordenadas (red de seguridad)", async () => {
    // Ciudad inventada (no geocodificable) en ambos lados: sin coords, cae en la
    // coincidencia textual de ciudad de siempre.
    const sup2 = await request(app).post("/publicaciones").set(auth(clinica.token))
      .send({ tipo: "suplencia", ciudad: "Villaficticia del Test", descripcion: "Rara", dias: [DIA] });
    const den = await prepararDentista(app, { nombre: "Mismo Pueblo", email: "pueblo@test.com", ciudad: "Villaficticia del Test", dia: DIA });
    const res = await request(app).get(`/suplencias/${sup2.body.id}/dentistas-disponibles`).set(auth(clinica.token));
    const ids = res.body.dentistas.map(d => d.id);
    assert.ok(ids.includes(den.usuario.id), "misma ciudad sin coords debería casar");
    assert.equal(res.body.dentistas.find(d => d.id === den.usuario.id).km, null);
  });
});

test("radio de desplazamiento: persistencia", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const den = await registrar(app, { nombre: "Den Radio", email: "den-radio@test.com", tipo: "dentista" });

  await t.test("de inicio no hay radio propio, pero sí el valor por defecto", async () => {
    const res = await request(app).get("/disponibilidad").set(auth(den.token));
    assert.equal(res.body.radio_km, null);
    assert.equal(res.body.radio_km_defecto, 25);
  });

  await t.test("se guarda y se relee, acotado a [0, 500]", async () => {
    await request(app).put("/disponibilidad").set(auth(den.token)).send({ dias: [], radio_km: 900 });
    const res = await request(app).get("/disponibilidad").set(auth(den.token));
    assert.equal(res.body.radio_km, 500);
  });

  await t.test("guardar el calendario sin enviar radio_km no lo pisa", async () => {
    await request(app).put("/disponibilidad").set(auth(den.token)).send({ dias: ["2026-09-01"], radio_km: 40 });
    await request(app).put("/disponibilidad").set(auth(den.token)).send({ dias: ["2026-09-02"] }); // sin radio_km
    const res = await request(app).get("/disponibilidad").set(auth(den.token));
    assert.equal(res.body.radio_km, 40);
    assert.deepEqual(res.body.dias, ["2026-09-02"]);
  });

  await t.test("radio_km vacío vuelve al valor por defecto (null)", async () => {
    await request(app).put("/disponibilidad").set(auth(den.token)).send({ dias: [], radio_km: "" });
    const res = await request(app).get("/disponibilidad").set(auth(den.token));
    assert.equal(res.body.radio_km, null);
  });
});
