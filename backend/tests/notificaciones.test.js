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

// Espera a que la BD termine las escrituras en vuelo (la notificación in-app se
// crea como efecto secundario, después de responder a la petición del evento).
const esperar = (ms = 150) => new Promise(r => setTimeout(r, ms));

test("notificaciones in-app (campana)", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Notif", email: "clinica-notif@test.com", tipo: "clinica" });
  const dentista = await registrar(app, { nombre: "Dentista Notif", email: "dentista-notif@test.com", tipo: "dentista" });

  const oferta = await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Valencia", descripcion: "Generalista" });

  await t.test("de inicio no hay notificaciones", async () => {
    const res = await request(app).get("/notificaciones").set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.noLeidas, 0);
    assert.deepEqual(res.body.notificaciones, []);
  });

  await t.test("una candidatura crea una notificación in-app para la clínica", async () => {
    const post = await request(app).post("/candidaturas").set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: oferta.body.id });
    assert.equal(post.status, 200);
    await esperar();

    const res = await request(app).get("/notificaciones").set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.body.noLeidas, 1);
    assert.equal(res.body.notificaciones.length, 1);
    assert.equal(res.body.notificaciones[0].leido, 0);
    assert.ok(res.body.notificaciones[0].titulo.length > 0);
  });

  // Una notificación sin enlace es un callejón sin salida: el frontend solo la hace
  // clicable si trae uno (ver app.rutas). Y el enlace apunta al elemento concreto,
  // no a un listado donde haya que buscar de qué hablaba.
  await t.test("la notificación enlaza a la candidatura concreta", async () => {
    const candidatos = await request(app).get(`/publicaciones/${oferta.body.id}/candidatos`)
      .set("Authorization", `Bearer ${clinica.token}`);
    const candidaturaId = candidatos.body.candidatos[0].id;

    const res = await request(app).get("/notificaciones").set("Authorization", `Bearer ${clinica.token}`);
    const notif = res.body.notificaciones[0];
    assert.equal(notif.tipo, "candidatura");
    assert.equal(notif.enlace, `#candidatura=${candidaturaId}`);
  });

  await t.test("marcar todas como leídas deja el contador a 0", async () => {
    await request(app).put("/notificaciones/leer").set("Authorization", `Bearer ${clinica.token}`).send({});
    const res = await request(app).get("/notificaciones").set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.body.noLeidas, 0);
    // La notificación sigue existiendo, solo marcada como leída
    assert.equal(res.body.notificaciones[0].leido, 1);
  });

  await t.test("cada usuario solo ve sus notificaciones", async () => {
    const res = await request(app).get("/notificaciones").set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.body.noLeidas, 0);
  });

  // Al final del todo: este caso sí crea una notificación para el dentista, y antes
  // varios asertos dan por hecho que no tiene ninguna.
  await t.test("al dentista, el cambio de estado le enlaza a esa misma candidatura", async () => {
    const candidatos = await request(app).get(`/publicaciones/${oferta.body.id}/candidatos`)
      .set("Authorization", `Bearer ${clinica.token}`);
    const candidaturaId = candidatos.body.candidatos[0].id;

    await request(app).put(`/candidaturas/${candidaturaId}`).set("Authorization", `Bearer ${clinica.token}`)
      .send({ estado: "aceptada" });
    await esperar();

    const res = await request(app).get("/notificaciones").set("Authorization", `Bearer ${dentista.token}`);
    const notif = res.body.notificaciones[0];
    assert.ok(notif, "el dentista debería tener una notificación");
    assert.equal(notif.enlace, `#candidatura=${candidaturaId}`);
  });
});
