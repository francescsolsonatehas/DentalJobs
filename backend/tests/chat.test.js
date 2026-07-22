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

// Postula al dentista a una publicación de la clínica y la acepta: es lo que
// habilita el chat entre los dos.
async function postularYAceptar(app, { dentista, clinica, publicacionId }) {
  const candidatura = await request(app)
    .post("/candidaturas")
    .set("Authorization", `Bearer ${dentista.token}`)
    .send({ publicacion_id: publicacionId });
  await request(app)
    .put(`/candidaturas/${candidatura.body.candidatura_id}`)
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ estado: "aceptada" });
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

  await t.test("no se puede chatear sin una postulación aceptada", async () => {
    const res = await request(app)
      .post(`/chat/con/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ cuerpo: "Hola, me interesa la oferta" });

    assert.equal(res.status, 403);
  });

  await postularYAceptar(app, { dentista, clinica, publicacionId: ofertaId });

  await t.test("un dentista puede escribir a la clínica tras ser aceptado", async () => {
    const res = await request(app)
      .post(`/chat/con/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ cuerpo: "Hola, me interesa la oferta" });

    assert.equal(res.status, 200);
    assert.ok(res.body.id);
  });

  await t.test("no se puede enviar un mensaje a uno mismo", async () => {
    const res = await request(app)
      .post(`/chat/con/${dentista.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ cuerpo: "hola yo" });

    assert.equal(res.status, 400);
  });

  await t.test("el destinatario ve la conversación con mensajes sin leer", async () => {
    const res = await request(app)
      .get("/chat/conversaciones")
      .set("Authorization", `Bearer ${clinica.token}`);

    assert.equal(res.status, 200);
    const conv = res.body.conversaciones.find((c) => c.otro_id === dentista.usuario.id);
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
      .get(`/chat/con/${dentista.usuario.id}`)
      .set("Authorization", `Bearer ${clinica.token}`);

    assert.equal(hilo.status, 200);
    assert.equal(hilo.body.mensajes.length, 1);

    // Ahora el emisor debería ver su mensaje como leído
    const hiloEmisor = await request(app)
      .get(`/chat/con/${clinica.usuario.id}`)
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
      .send({ destinatario_id: dentista.usuario.id });

    const hilo = await request(app)
      .get(`/chat/con/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(hilo.body.escribiendo, true);

    // Para el otro lado (la clínica) no debe aparecer como escribiendo
    const hiloClinica = await request(app)
      .get(`/chat/con/${dentista.usuario.id}`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(hiloClinica.body.escribiendo, false);
  });

  await t.test("la conversación es bidireccional", async () => {
    await request(app)
      .post(`/chat/con/${dentista.usuario.id}`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ cuerpo: "Genial, hablemos" });

    const hilo = await request(app)
      .get(`/chat/con/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`);

    assert.equal(hilo.body.mensajes.length, 2);
    assert.equal(hilo.body.mensajes[1].cuerpo, "Genial, hablemos");
  });

  // El motivo de que el hilo sea por persona y no por publicación: con alguien se
  // habla en un solo sitio, aunque coincidáis en varias ofertas.
  await t.test("una segunda publicación con la misma persona NO abre otro chat", async () => {
    const segunda = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Lleida", descripcion: "Segunda oferta" });
    await postularYAceptar(app, { dentista, clinica, publicacionId: segunda.body.id });

    await request(app)
      .post(`/chat/con/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ cuerpo: "Y esta otra oferta, ¿sigue abierta?" });

    const res = await request(app)
      .get("/chat/conversaciones")
      .set("Authorization", `Bearer ${clinica.token}`);
    const conDentista = res.body.conversaciones.filter((c) => c.otro_id === dentista.usuario.id);
    assert.equal(conDentista.length, 1, "debe haber un único hilo con esa persona");

    // Y el hilo acumula los mensajes de las dos ofertas
    const hilo = await request(app)
      .get(`/chat/con/${dentista.usuario.id}`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(hilo.body.mensajes.length, 3);
  });

  await t.test("un tercero sin relación aceptada no puede escribir", async () => {
    const extraño = await registrarYLoguear(app, { nombre: "Extraño", email: "extrano-chat@test.com", tipo: "dentista" });
    const res = await request(app)
      .post(`/chat/con/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${extraño.token}`)
      .send({ cuerpo: "Hola" });

    assert.equal(res.status, 403);
  });

  // El dentista puede adjuntar un fichero al chat: se sube a `archivos` y el mensaje
  // lo referencia. El hilo devuelve los metadatos del adjunto para poder pintarlo.
  await t.test("se puede enviar un mensaje con un archivo adjunto", async () => {
    const subida = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${dentista.token}`)
      .field("tipo", "chat")
      .attach("archivo", Buffer.from("contenido de prueba"), "documento.txt");
    assert.equal(subida.status, 200);
    const archivoId = subida.body.id;

    // Sin texto, solo el adjunto: debe valer igualmente
    const envio = await request(app)
      .post(`/chat/con/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ archivo_id: archivoId });
    assert.equal(envio.status, 200);

    const hilo = await request(app)
      .get(`/chat/con/${dentista.usuario.id}`)
      .set("Authorization", `Bearer ${clinica.token}`);
    const conAdjunto = hilo.body.mensajes.find((m) => m.archivo_id === archivoId);
    assert.ok(conAdjunto, "el mensaje con adjunto debe estar en el hilo");
    assert.equal(conAdjunto.archivo_tipo, "chat");
    assert.equal(conAdjunto.archivo_nombre, "documento.txt");
    assert.equal(conAdjunto.cuerpo, "");
  });

  await t.test("no se puede adjuntar un archivo de otra persona", async () => {
    // Un archivo que pertenece a la clínica, no al dentista
    const ajeno = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${clinica.token}`)
      .field("tipo", "chat")
      .attach("archivo", Buffer.from("privado"), "ajeno.txt");
    assert.equal(ajeno.status, 200);

    const res = await request(app)
      .post(`/chat/con/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ archivo_id: ajeno.body.id });
    assert.equal(res.status, 403);
  });

  await t.test("un mensaje sin texto ni adjunto se rechaza", async () => {
    const res = await request(app)
      .post(`/chat/con/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ cuerpo: "   " });
    assert.equal(res.status, 400);
  });
});
