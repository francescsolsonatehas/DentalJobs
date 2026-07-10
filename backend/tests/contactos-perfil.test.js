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

test("contactos de perfil y su chat", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Test", email: "clinica@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Test", email: "dentista@test.com", tipo: "dentista" });

  let contactoId;

  await t.test("una clínica contacta el perfil de un dentista", async () => {
    const res = await request(app)
      .post("/contactos-perfil")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ perfil_id: dentista.usuario.id, mensaje: "Nos encaja tu perfil" });
    assert.equal(res.status, 200);
    contactoId = res.body.id;
  });

  await t.test("no se puede contactar dos veces al mismo perfil", async () => {
    const res = await request(app)
      .post("/contactos-perfil")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ perfil_id: dentista.usuario.id });
    assert.equal(res.status, 400);
  });

  await t.test("el dentista ve el contacto entre los recibidos", async () => {
    const res = await request(app)
      .get("/contactos-perfil")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.recibidos.some((c) => c.id === contactoId && c.estado === "pendiente"));
  });

  await t.test("no se puede chatear antes de aceptar el contacto", async () => {
    const res = await request(app)
      .post("/chat/perfil/mensajes")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ contacto_perfil_id: contactoId, cuerpo: "Hola" });
    assert.equal(res.status, 403);
  });

  await t.test("solo el destinatario puede aceptar el contacto", async () => {
    const res = await request(app)
      .put(`/contactos-perfil/${contactoId}`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ estado: "aceptada" });
    assert.equal(res.status, 403);
  });

  await t.test("el dentista acepta y entonces ambos pueden chatear", async () => {
    const aceptar = await request(app)
      .put(`/contactos-perfil/${contactoId}`)
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ estado: "aceptada" });
    assert.equal(aceptar.status, 200);

    const enviar = await request(app)
      .post("/chat/perfil/mensajes")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ contacto_perfil_id: contactoId, cuerpo: "¡Hola! ¿Hablamos?" });
    assert.equal(enviar.status, 200);

    const hilo = await request(app)
      .get(`/chat/perfil/${contactoId}/mensajes`)
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(hilo.status, 200);
    assert.equal(hilo.body.mensajes.length, 1);
    assert.equal(hilo.body.mensajes[0].cuerpo, "¡Hola! ¿Hablamos?");
    assert.equal(hilo.body.estado, "aceptada");
  });
});
