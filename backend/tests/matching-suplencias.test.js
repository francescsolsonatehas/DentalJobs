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

// Devuelve el id de una especialidad por nombre
async function especialidadId(app, nombre) {
  const res = await request(app).get("/especialidades");
  return res.body.find(e => e.nombre === nombre).id;
}

test("matching de suplencias (M1: surfacing)", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Match", email: "clinica-match@test.com", tipo: "clinica" });
  const ortodoncia = await especialidadId(app, "Ortodoncia");
  const endodoncia = await especialidadId(app, "Endodoncia");

  // Suplencia en Valencia, especialidad Ortodoncia, días 7 y 14 de agosto
  const sup = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "suplencia", ciudad: "Valencia", descripcion: "Ortodoncia agosto", especialidades: [ortodoncia], dias: ["2026-08-07", "2026-08-14"] });
  const supId = sup.body.id;

  // Dentista A: Valencia, ortodoncista, disponible el 14 (y el 20 que no casa) → CASA
  const denA = await registrar(app, { nombre: "Ana Casa", email: "denA@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${denA.token}`).send({ nombre: "Ana Casa", ciudad: "Valencia" });
  await request(app).post("/auth/guardar-especialidades").set("Authorization", `Bearer ${denA.token}`).send({ especialidades: [ortodoncia] });
  await request(app).put("/disponibilidad").set("Authorization", `Bearer ${denA.token}`).send({ dias: ["2026-08-14", "2026-08-20"] });

  // Dentista B: Valencia, ortodoncista, pero disponible solo el 21 → NO casa (fecha)
  const denB = await registrar(app, { nombre: "Beto Fecha", email: "denB@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${denB.token}`).send({ nombre: "Beto Fecha", ciudad: "Valencia" });
  await request(app).post("/auth/guardar-especialidades").set("Authorization", `Bearer ${denB.token}`).send({ especialidades: [ortodoncia] });
  await request(app).put("/disponibilidad").set("Authorization", `Bearer ${denB.token}`).send({ dias: ["2026-08-21"] });

  // Dentista C: Madrid, ortodoncista, disponible el 7 → NO casa (ciudad)
  const denC = await registrar(app, { nombre: "Carla Lejos", email: "denC@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${denC.token}`).send({ nombre: "Carla Lejos", ciudad: "Madrid" });
  await request(app).post("/auth/guardar-especialidades").set("Authorization", `Bearer ${denC.token}`).send({ especialidades: [ortodoncia] });
  await request(app).put("/disponibilidad").set("Authorization", `Bearer ${denC.token}`).send({ dias: ["2026-08-07"] });

  // Dentista D: Valencia, endodoncista, disponible el 7 → NO casa (especialidad)
  const denD = await registrar(app, { nombre: "David Esp", email: "denD@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${denD.token}`).send({ nombre: "David Esp", ciudad: "Valencia" });
  await request(app).post("/auth/guardar-especialidades").set("Authorization", `Bearer ${denD.token}`).send({ especialidades: [endodoncia] });
  await request(app).put("/disponibilidad").set("Authorization", `Bearer ${denD.token}`).send({ dias: ["2026-08-07"] });

  await t.test("solo casa el dentista con fecha+ciudad+especialidad correctas", async () => {
    const res = await request(app)
      .get(`/suplencias/${supId}/dentistas-disponibles`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 200);
    const ids = res.body.dentistas.map(d => d.id);
    assert.deepEqual(ids, [denA.usuario.id]);
    // y trae los días concretos en los que coincide (solo el 14)
    assert.deepEqual(res.body.dentistas[0].dias_coincidentes, ["2026-08-14"]);
  });

  await t.test("un tercero no puede ver los dentistas disponibles", async () => {
    const res = await request(app)
      .get(`/suplencias/${supId}/dentistas-disponibles`)
      .set("Authorization", `Bearer ${denA.token}`);
    assert.equal(res.status, 403);
  });

  await t.test("el dentista filtra suplencias por su disponibilidad", async () => {
    const casan = await request(app).get("/publicaciones").query({ tipo: "suplencia", disponibleUsuarioId: denA.usuario.id });
    assert.ok(casan.body.map(p => p.id).includes(supId));

    const noCasan = await request(app).get("/publicaciones").query({ tipo: "suplencia", disponibleUsuarioId: denB.usuario.id });
    assert.ok(!noCasan.body.map(p => p.id).includes(supId));
  });
});
