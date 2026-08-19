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

test("salas de chat compartidas", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinicaA = await registrar(app, { nombre: "Clínica A", email: "sala-clinica-a@test.com", tipo: "clinica" });
  const clinicaB = await registrar(app, { nombre: "Clínica B", email: "sala-clinica-b@test.com", tipo: "clinica" });
  const dentistaA = await registrar(app, { nombre: "Dentista A", email: "sala-dentista-a@test.com", tipo: "dentista" });
  const dentistaB = await registrar(app, { nombre: "Dentista B", email: "sala-dentista-b@test.com", tipo: "dentista" });

  await t.test("exige sesión", async () => {
    const res = await request(app).get("/chat/sala/todos");
    assert.equal(res.status, 401);
  });

  await t.test("una sala inexistente da 404", async () => {
    const res = await request(app)
      .get("/chat/sala/inventada")
      .set("Authorization", `Bearer ${clinicaA.token}`);
    assert.equal(res.status, 404);
  });

  await t.test("cualquiera puede leer y escribir en la sala 'todos'", async () => {
    const envio = await request(app)
      .post("/chat/sala/todos")
      .set("Authorization", `Bearer ${dentistaA.token}`)
      .send({ cuerpo: "Hola a todos" });
    assert.equal(envio.status, 200);

    const lectura = await request(app)
      .get("/chat/sala/todos")
      .set("Authorization", `Bearer ${clinicaA.token}`);
    assert.equal(lectura.status, 200);
    assert.equal(lectura.body.mensajes.length, 1);
    assert.equal(lectura.body.mensajes[0].cuerpo, "Hola a todos");
  });

  await t.test("una clínica no tiene acceso a la sala 'dentistas'", async () => {
    const lectura = await request(app)
      .get("/chat/sala/dentistas")
      .set("Authorization", `Bearer ${clinicaA.token}`);
    assert.equal(lectura.status, 403);

    const escritura = await request(app)
      .post("/chat/sala/dentistas")
      .set("Authorization", `Bearer ${clinicaA.token}`)
      .send({ cuerpo: "Colándome" });
    assert.equal(escritura.status, 403);
  });

  await t.test("un dentista no tiene acceso a la sala 'clinicas'", async () => {
    const lectura = await request(app)
      .get("/chat/sala/clinicas")
      .set("Authorization", `Bearer ${dentistaA.token}`);
    assert.equal(lectura.status, 403);

    const escritura = await request(app)
      .post("/chat/sala/clinicas")
      .set("Authorization", `Bearer ${dentistaA.token}`)
      .send({ cuerpo: "Colándome" });
    assert.equal(escritura.status, 403);
  });

  await t.test("dos clínicas comparten el mismo hilo en la sala 'clinicas'", async () => {
    await request(app)
      .post("/chat/sala/clinicas")
      .set("Authorization", `Bearer ${clinicaA.token}`)
      .send({ cuerpo: "¿Alguien lleva sedación en Girona?" });
    await request(app)
      .post("/chat/sala/clinicas")
      .set("Authorization", `Bearer ${clinicaB.token}`)
      .send({ cuerpo: "Nosotros sí" });

    const res = await request(app)
      .get("/chat/sala/clinicas")
      .set("Authorization", `Bearer ${clinicaA.token}`);
    assert.equal(res.body.mensajes.length, 2);
    assert.equal(res.body.mensajes[0].remitente_nombre_usuario, "Clínica A");
    assert.equal(res.body.mensajes[1].remitente_nombre_usuario, "Clínica B");
  });

  await t.test("dos dentistas comparten el mismo hilo en la sala 'dentistas'", async () => {
    await request(app)
      .post("/chat/sala/dentistas")
      .set("Authorization", `Bearer ${dentistaA.token}`)
      .send({ cuerpo: "¿Alguna suplencia por Tarragona?" });
    await request(app)
      .post("/chat/sala/dentistas")
      .set("Authorization", `Bearer ${dentistaB.token}`)
      .send({ cuerpo: "Yo vi una la semana pasada" });

    const res = await request(app)
      .get("/chat/sala/dentistas")
      .set("Authorization", `Bearer ${dentistaB.token}`);
    assert.equal(res.body.mensajes.length, 2);
  });

  await t.test("un mensaje sin texto ni adjunto se rechaza", async () => {
    const res = await request(app)
      .post("/chat/sala/todos")
      .set("Authorization", `Bearer ${clinicaA.token}`)
      .send({ cuerpo: "   " });
    assert.equal(res.status, 400);
  });

  await t.test("los mensajes de sala no aparecen en la bandeja 1:1 ni en el contador de no leídos", async () => {
    const conversaciones = await request(app)
      .get("/chat/conversaciones")
      .set("Authorization", `Bearer ${clinicaB.token}`);
    assert.deepEqual(conversaciones.body.conversaciones, []);

    const noLeidos = await request(app)
      .get("/chat/no-leidos")
      .set("Authorization", `Bearer ${clinicaB.token}`);
    assert.equal(noLeidos.body.total, 0);
  });
});
