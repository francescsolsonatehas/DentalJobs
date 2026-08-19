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

test("digest diario de matching de publicaciones (ofertas y solicitudes)", async (t) => {
  process.env.ADMIN_TOKEN = "token-de-prueba-admin-pub";
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const ortodoncia = await especialidadId(app, "Ortodoncia");
  const endodoncia = await especialidadId(app, "Endodoncia");

  const clinica = await registrar(app, { nombre: "Clínica Digest Pub", email: "clinica-digest-pub@test.com", tipo: "clinica" });
  const oferta = await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Valencia", descripcion: "Se busca ortodoncista", especialidades: [ortodoncia] });
  assert.equal(oferta.status, 200);

  // Dentista A: Valencia, ortodoncista → CASA
  const denA = await registrar(app, { nombre: "Ana Casa", email: "denA-pub@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${denA.token}`).send({ nombre: "Ana Casa", ciudad: "Valencia" });
  await request(app).post("/auth/guardar-especialidades").set("Authorization", `Bearer ${denA.token}`).send({ especialidades: [ortodoncia] });

  // Dentista B: Madrid (lejos), ortodoncista → NO casa (ciudad)
  const denB = await registrar(app, { nombre: "Beto Lejos", email: "denB-pub@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${denB.token}`).send({ nombre: "Beto Lejos", ciudad: "Madrid" });
  await request(app).post("/auth/guardar-especialidades").set("Authorization", `Bearer ${denB.token}`).send({ especialidades: [ortodoncia] });

  // Dentista C: Valencia, endodoncista → NO casa (especialidad)
  const denC = await registrar(app, { nombre: "Carla Especialidad", email: "denC-pub@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${denC.token}`).send({ nombre: "Carla Especialidad", ciudad: "Valencia" });
  await request(app).post("/auth/guardar-especialidades").set("Authorization", `Bearer ${denC.token}`).send({ especialidades: [endodoncia] });

  await t.test("exige el token de admin", async () => {
    const r = await request(app).post("/admin/matching-publicaciones");
    assert.equal(r.status, 401);
  });

  await t.test("primer paso: avisa solo al dentista que casa (ciudad + especialidad)", async () => {
    const r = await request(app).post("/admin/matching-publicaciones").set("X-Admin-Token", "token-de-prueba-admin-pub");
    assert.equal(r.status, 200);
    assert.equal(r.body.usuariosAvisados, 1);
    assert.equal(r.body.avisos, 1);

    const notifs = await request(app).get("/notificaciones").set("Authorization", `Bearer ${denA.token}`);
    const n = notifs.body.notificaciones.find(x => x.tipo === "oferta");
    assert.ok(n, "el dentista que casa recibe una notificación de tipo oferta");
    assert.equal(n.enlace, `#publicacion=${oferta.body.id}`);
  });

  await t.test("segundo paso: dedup, no se repite el aviso", async () => {
    const r = await request(app).post("/admin/matching-publicaciones").set("X-Admin-Token", "token-de-prueba-admin-pub");
    assert.equal(r.body.usuariosAvisados, 0);
    assert.equal(r.body.avisos, 0);
  });

  await t.test("una solicitud nueva de dentista avisa a la clínica que casa", async () => {
    const clinicaB = await registrar(app, { nombre: "Clínica B Pub", email: "clinicab-pub@test.com", tipo: "clinica" });
    await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${clinicaB.token}`).send({ nombre: "Clínica B Pub", ciudad: "Sevilla" });

    const denSolicita = await registrar(app, { nombre: "Dentista Solicita", email: "densolicita-pub@test.com", tipo: "dentista" });
    await request(app).post("/publicaciones").set("Authorization", `Bearer ${denSolicita.token}`)
      .send({ tipo: "solicitud", ciudad: "Sevilla", descripcion: "Busco empleo" });

    const r = await request(app).post("/admin/matching-publicaciones").set("X-Admin-Token", "token-de-prueba-admin-pub");
    assert.equal(r.body.usuariosAvisados, 1);

    const notifs = await request(app).get("/notificaciones").set("Authorization", `Bearer ${clinicaB.token}`);
    const n = notifs.body.notificaciones.find(x => x.tipo === "solicitud");
    assert.ok(n, "la clínica que casa recibe una notificación de tipo solicitud");
  });

  await t.test("varias coincidencias a la vez enlazan a la lista, no a una sola", async () => {
    const clinicaMulti = await registrar(app, { nombre: "Clínica Multi Pub", email: "clinicamulti-pub@test.com", tipo: "clinica" });
    await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${clinicaMulti.token}`).send({ nombre: "Clínica Multi Pub", ciudad: "Bilbao" });
    await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinicaMulti.token}`)
      .send({ tipo: "oferta", ciudad: "Bilbao", descripcion: "Oferta 1" });

    const denMulti = await registrar(app, { nombre: "Dentista Multi", email: "denmulti-pub@test.com", tipo: "dentista" });
    await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${denMulti.token}`).send({ nombre: "Dentista Multi", ciudad: "Bilbao" });
    await request(app).post("/publicaciones").set("Authorization", `Bearer ${denMulti.token}`)
      .send({ tipo: "solicitud", ciudad: "Bilbao", descripcion: "Solicitud 1" });
    await request(app).post("/publicaciones").set("Authorization", `Bearer ${denMulti.token}`)
      .send({ tipo: "solicitud", ciudad: "Bilbao", descripcion: "Solicitud 2" });

    await request(app).post("/admin/matching-publicaciones").set("X-Admin-Token", "token-de-prueba-admin-pub");
    const notifs = await request(app).get("/notificaciones").set("Authorization", `Bearer ${clinicaMulti.token}`);
    const n = notifs.body.notificaciones.find(x => x.enlace && x.enlace.startsWith("#publicaciones="));
    assert.ok(n, "con dos coincidencias, el enlace agrupa ambas");
  });
});
