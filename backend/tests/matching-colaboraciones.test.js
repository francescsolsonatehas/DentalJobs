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

async function especialidadId(app, nombre) {
  const res = await request(app).get("/especialidades");
  return res.body.find(e => e.nombre === nombre).id;
}

test("disponibilidad semanal del dentista", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const dentista = await registrar(app, { nombre: "Dentista Semanal", email: "dentista-semanal@test.com", tipo: "dentista" });

  await t.test("una clínica no puede guardar disponibilidad semanal", async () => {
    const clinica = await registrar(app, { nombre: "Clínica X", email: "clinica-x-semanal@test.com", tipo: "clinica" });
    const res = await request(app).put("/disponibilidad-semanal").set("Authorization", `Bearer ${clinica.token}`).send({ dias: [{ dia: 1, turno: "manana" }] });
    assert.equal(res.status, 403);
  });

  await t.test("guardar y releer la disponibilidad semanal", async () => {
    const put = await request(app).put("/disponibilidad-semanal").set("Authorization", `Bearer ${dentista.token}`)
      .send({ dias: [{ dia: 1, turno: "manana" }, { dia: 3, turno: "ambos" }, { dia: 9, turno: "tarde" }, { dia: 2, turno: "raro" }] });
    assert.equal(put.status, 200);
    // día 9 (fuera de 1-6) y turno "raro" se descartan
    assert.deepEqual(put.body.dias, [{ dia: 1, turno: "manana" }, { dia: 3, turno: "ambos" }]);

    const get = await request(app).get("/disponibilidad-semanal").set("Authorization", `Bearer ${dentista.token}`);
    assert.deepEqual(get.body.dias, [{ dia: 1, turno: "manana" }, { dia: 3, turno: "ambos" }]);
  });

  await t.test("guardar de nuevo reemplaza el conjunto anterior por completo", async () => {
    await request(app).put("/disponibilidad-semanal").set("Authorization", `Bearer ${dentista.token}`)
      .send({ dias: [{ dia: 6, turno: "tarde" }] });
    const get = await request(app).get("/disponibilidad-semanal").set("Authorization", `Bearer ${dentista.token}`);
    assert.deepEqual(get.body.dias, [{ dia: 6, turno: "tarde" }]);
  });
});

test("matching de colaboraciones (M1: surfacing por día de la semana + turno)", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Match Colab", email: "clinica-match-colab@test.com", tipo: "clinica" });
  const ortodoncia = await especialidadId(app, "Ortodoncia");
  const endodoncia = await especialidadId(app, "Endodoncia");

  // Colaboración en Valencia, Ortodoncia, lunes mañana y miércoles (ambos)
  const colab = await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "colaboracion", ciudad: "Valencia", descripcion: "Ortodoncia recurrente", especialidades: [ortodoncia], diasSemana: [{ dia: 1, turno: "manana" }, { dia: 3, turno: "ambos" }] });
  const colabId = colab.body.id;

  // Dentista A: Valencia, ortodoncista, disponible lunes mañana → CASA (día 1)
  const denA = await registrar(app, { nombre: "Ana Casa", email: "denA-colab@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${denA.token}`).send({ nombre: "Ana Casa", ciudad: "Valencia" });
  await request(app).post("/auth/guardar-especialidades").set("Authorization", `Bearer ${denA.token}`).send({ especialidades: [ortodoncia] });
  await request(app).put("/disponibilidad-semanal").set("Authorization", `Bearer ${denA.token}`).send({ dias: [{ dia: 1, turno: "manana" }] });

  // Dentista B: Valencia, ortodoncista, disponible miércoles solo TARDE → NO casa el miércoles
  // (la colaboración pide "ambos" ese día), pero tampoco tiene el lunes → no casa en absoluto
  const denB = await registrar(app, { nombre: "Beto Turno", email: "denB-colab@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${denB.token}`).send({ nombre: "Beto Turno", ciudad: "Valencia" });
  await request(app).post("/auth/guardar-especialidades").set("Authorization", `Bearer ${denB.token}`).send({ especialidades: [ortodoncia] });
  await request(app).put("/disponibilidad-semanal").set("Authorization", `Bearer ${denB.token}`).send({ dias: [{ dia: 3, turno: "tarde" }] });

  // Dentista C: Valencia, ortodoncista, disponible miércoles "ambos" → CASA (cubre el "ambos" pedido)
  const denC = await registrar(app, { nombre: "Carla Ambos", email: "denC-colab@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${denC.token}`).send({ nombre: "Carla Ambos", ciudad: "Valencia" });
  await request(app).post("/auth/guardar-especialidades").set("Authorization", `Bearer ${denC.token}`).send({ especialidades: [ortodoncia] });
  await request(app).put("/disponibilidad-semanal").set("Authorization", `Bearer ${denC.token}`).send({ dias: [{ dia: 3, turno: "ambos" }] });

  // Dentista D: Madrid (lejos), ortodoncista, lunes mañana → NO casa (ciudad)
  const denD = await registrar(app, { nombre: "David Lejos", email: "denD-colab@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${denD.token}`).send({ nombre: "David Lejos", ciudad: "Madrid" });
  await request(app).post("/auth/guardar-especialidades").set("Authorization", `Bearer ${denD.token}`).send({ especialidades: [ortodoncia] });
  await request(app).put("/disponibilidad-semanal").set("Authorization", `Bearer ${denD.token}`).send({ dias: [{ dia: 1, turno: "manana" }] });

  // Dentista E: Valencia, endodoncista (especialidad distinta), lunes mañana → NO casa (especialidad)
  const denE = await registrar(app, { nombre: "Elena Especialidad", email: "denE-colab@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${denE.token}`).send({ nombre: "Elena Especialidad", ciudad: "Valencia" });
  await request(app).post("/auth/guardar-especialidades").set("Authorization", `Bearer ${denE.token}`).send({ especialidades: [endodoncia] });
  await request(app).put("/disponibilidad-semanal").set("Authorization", `Bearer ${denE.token}`).send({ dias: [{ dia: 1, turno: "manana" }] });

  await t.test("solo casan los dentistas con día+turno, ciudad y especialidad correctos", async () => {
    const res = await request(app)
      .get(`/colaboraciones/${colabId}/dentistas-disponibles`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 200);
    const ids = res.body.dentistas.map(d => d.id).sort();
    assert.deepEqual(ids, [denA.usuario.id, denC.usuario.id].sort());
  });

  await t.test("un tercero no puede ver los dentistas disponibles", async () => {
    const res = await request(app)
      .get(`/colaboraciones/${colabId}/dentistas-disponibles`)
      .set("Authorization", `Bearer ${denA.token}`);
    assert.equal(res.status, 403);
  });

  await t.test("el dentista filtra colaboraciones por su disponibilidad semanal", async () => {
    const casan = await request(app).get("/publicaciones").query({ tipo: "colaboracion", disponibleUsuarioId: denA.usuario.id });
    assert.ok(casan.body.map(p => p.id).includes(colabId));

    const noCasan = await request(app).get("/publicaciones").query({ tipo: "colaboracion", disponibleUsuarioId: denB.usuario.id });
    assert.ok(!noCasan.body.map(p => p.id).includes(colabId));
  });

  await t.test("filtrar por día de la semana concreto", async () => {
    const lunes = await request(app).get("/publicaciones").query({ tipo: "colaboracion", diaSemana: 1 });
    assert.ok(lunes.body.map(p => p.id).includes(colabId));
    const sabado = await request(app).get("/publicaciones").query({ tipo: "colaboracion", diaSemana: 6 });
    assert.ok(!sabado.body.map(p => p.id).includes(colabId));
  });
});

test("digest diario de matching de colaboraciones", async (t) => {
  process.env.ADMIN_TOKEN = "token-de-prueba-admin-colab";
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Digest Colab", email: "clinica-digest-colab@test.com", tipo: "clinica" });

  const colab = await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "colaboracion", ciudad: "Valencia", descripcion: "Recurrente", diasSemana: [{ dia: 2, turno: "manana" }] });

  const den = await registrar(app, { nombre: "Dentista Digest Colab", email: "dentista-digest-colab@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${den.token}`).send({ nombre: "Dentista Digest Colab", ciudad: "Valencia" });
  await request(app).put("/disponibilidad-semanal").set("Authorization", `Bearer ${den.token}`).send({ dias: [{ dia: 2, turno: "ambos" }] });

  const lejos = await registrar(app, { nombre: "Dentista Lejos Colab", email: "dentista-lejos-colab@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${lejos.token}`).send({ nombre: "Dentista Lejos Colab", ciudad: "Sevilla" });
  await request(app).put("/disponibilidad-semanal").set("Authorization", `Bearer ${lejos.token}`).send({ dias: [{ dia: 2, turno: "manana" }] });

  await t.test("exige el token de admin", async () => {
    const r = await request(app).post("/admin/matching-colaboraciones");
    assert.equal(r.status, 401);
  });

  await t.test("primer paso: avisa al dentista que casa (una vez), ignora la ciudad distinta", async () => {
    const r = await request(app).post("/admin/matching-colaboraciones").set("X-Admin-Token", "token-de-prueba-admin-colab");
    assert.equal(r.status, 200);
    assert.equal(r.body.dentistasAvisados, 1);
    assert.equal(r.body.avisos, 1);
  });

  await t.test("segundo paso: dedup, no se repite el aviso", async () => {
    const r = await request(app).post("/admin/matching-colaboraciones").set("X-Admin-Token", "token-de-prueba-admin-colab");
    assert.equal(r.body.dentistasAvisados, 0);
    assert.equal(r.body.avisos, 0);
  });

  await t.test("una colaboración nueva sí genera un aviso nuevo", async () => {
    await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "colaboracion", ciudad: "Valencia", descripcion: "Otra recurrente", diasSemana: [{ dia: 2, turno: "manana" }] });
    const r = await request(app).post("/admin/matching-colaboraciones").set("X-Admin-Token", "token-de-prueba-admin-colab");
    assert.equal(r.body.avisos, 1);
  });

  await t.test("una colaboración publicada por un dentista no genera matching (no hay candidato-dentista que ofrecer)", async () => {
    const denPublica = await registrar(app, { nombre: "Dentista Publica Colab", email: "dentista-publica-colab@test.com", tipo: "dentista" });
    await request(app).post("/publicaciones").set("Authorization", `Bearer ${denPublica.token}`)
      .send({ tipo: "colaboracion", descripcion: "Ofrezco mi especialidad", diasSemana: [{ dia: 2, turno: "manana" }] });
    const r = await request(app).post("/admin/matching-colaboraciones").set("X-Admin-Token", "token-de-prueba-admin-colab");
    assert.equal(r.body.avisos, 0);
  });
});
