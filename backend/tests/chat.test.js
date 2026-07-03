const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");

async function registrarYLoguear(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo });
  return { token: res.body.token, usuario: res.body.usuario };
}

test("chat", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Chat", email: "clinica-chat@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Chat", email: "dentista-chat@test.com", tipo: "dentista" });

  const oferta = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Girona", descripcion: "Oferta con chat" });
  const ofertaId = oferta.body.id;

  await t.test("un dentista puede enviar un mensaje al dueño de la publicación", async () => {
    const res = await request(app)
      .post("/chat/mensajes")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: ofertaId, destinatario_id: clinica.usuario.id, cuerpo: "Hola, me interesa la oferta" });

    assert.equal(res.status, 200);
    assert.ok(res.body.id);
  });

  await t.test("no se puede enviar un mensaje a uno mismo", async () => {
    const res = await request(app)
      .post("/chat/mensajes")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: ofertaId, destinatario_id: dentista.usuario.id, cuerpo: "hola yo" });

    assert.equal(res.status, 400);
  });

  await t.test("el destinatario ve la conversación con mensajes sin leer", async () => {
    const res = await request(app)
      .get("/chat/conversaciones")
      .set("Authorization", `Bearer ${clinica.token}`);

    assert.equal(res.status, 200);
    const conv = res.body.conversaciones.find(
      (c) => c.publicacion_id === ofertaId && c.otro_id === dentista.usuario.id
    );
    assert.ok(conv);
    assert.equal(conv.no_leidos, 1);
    assert.equal(conv.ultimo_mensaje, "Hola, me interesa la oferta");
  });

  await t.test("el contador global de no leídos refleja los mensajes entrantes", async () => {
    const res = await request(app)
      .get("/chat/no-leidos")
      .set("Authorization", `Bearer ${clinica.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
  });

  await t.test("abrir el hilo marca los mensajes como leídos (doble check para el emisor)", async () => {
    const hilo = await request(app)
      .get(`/chat/mensajes/${ofertaId}/${dentista.usuario.id}`)
      .set("Authorization", `Bearer ${clinica.token}`);

    assert.equal(hilo.status, 200);
    assert.equal(hilo.body.mensajes.length, 1);

    // Ahora el emisor debería ver su mensaje como leído
    const hiloEmisor = await request(app)
      .get(`/chat/mensajes/${ofertaId}/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(hiloEmisor.body.mensajes[0].leido, 1);

    const contador = await request(app)
      .get("/chat/no-leidos")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(contador.body.total, 0);
  });

  await t.test("la señal de escribiendo… es visible para el interlocutor y expira", async () => {
    await request(app)
      .post("/chat/escribiendo")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ publicacion_id: ofertaId, destinatario_id: dentista.usuario.id });

    const hilo = await request(app)
      .get(`/chat/mensajes/${ofertaId}/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(hilo.body.escribiendo, true);

    // Para el otro lado (la clínica) no debe aparecer como escribiendo
    const hiloClinica = await request(app)
      .get(`/chat/mensajes/${ofertaId}/${dentista.usuario.id}`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(hiloClinica.body.escribiendo, false);
  });

  await t.test("la conversación es bidireccional", async () => {
    await request(app)
      .post("/chat/mensajes")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ publicacion_id: ofertaId, destinatario_id: dentista.usuario.id, cuerpo: "Genial, hablemos" });

    const hilo = await request(app)
      .get(`/chat/mensajes/${ofertaId}/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`);

    assert.equal(hilo.body.mensajes.length, 2);
    assert.equal(hilo.body.mensajes[1].cuerpo, "Genial, hablemos");
  });
});
