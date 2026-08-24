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

// JPEG 1x1 válido mínimo: el endpoint de subida recomprime imágenes con sharp, que
// necesita poder leer sus cabeceras de verdad.
const JPEG_MINIMO = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64"
);

// Un archivo (foto de perfil, Book…) adjuntado a un mensaje de chat queda referenciado
// por mensajes.archivo_id. Con PRAGMA foreign_keys = ON, borrar el archivo sin
// desvincular antes esos mensajes hace fallar el borrado (bug real: "Error al
// eliminar archivo"). El logo/foto de perfil es, además, el único tipo que sustituye
// al anterior al subir uno nuevo: es el caso que ejercita la desvinculación.
test("eliminar/actualizar un archivo adjuntado en el chat no debe romperse por la clave foránea", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const dentista = await registrarYLoguear(app, { nombre: "Dentista Adjunto", email: "dentista-adjunto@test.com", tipo: "dentista" });
  const clinica = await registrarYLoguear(app, { nombre: "Clínica Adjunto", email: "clinica-adjunto@test.com", tipo: "clinica" });

  async function subirLogo(token) {
    const res = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${token}`)
      .field("tipo", "logo")
      .attach("archivo", JPEG_MINIMO, { filename: "foto.jpg", contentType: "image/jpeg" });
    return res.body.id;
  }

  async function adjuntarEnChat(archivoId) {
    const res = await request(app)
      .post(`/chat/con/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ archivo_id: archivoId });
    return res.body.id;
  }

  await t.test("eliminar un archivo adjuntado en un mensaje no falla, y el mensaje sobrevive sin el adjunto", async () => {
    const logoId = await subirLogo(dentista.token);
    const mensajeId = await adjuntarEnChat(logoId);
    assert.ok(mensajeId);

    const res = await request(app)
      .delete(`/archivos/${logoId}`)
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.status, 200);

    const hilo = await request(app)
      .get(`/chat/con/${dentista.usuario.id}`)
      .set("Authorization", `Bearer ${clinica.token}`);
    const mensaje = hilo.body.mensajes.find((m) => m.id === mensajeId);
    assert.ok(mensaje, "el mensaje debe seguir existiendo");
    assert.equal(mensaje.archivo_id, null);
  });

  await t.test("actualizar (subir un logo nuevo) cuando el anterior está adjuntado en el chat no falla", async () => {
    const logoViejo = await subirLogo(dentista.token);
    await adjuntarEnChat(logoViejo);

    const subida = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${dentista.token}`)
      .field("tipo", "logo")
      .attach("archivo", JPEG_MINIMO, { filename: "foto-nueva.jpg", contentType: "image/jpeg" });
    assert.equal(subida.status, 200);

    const lista = await request(app).get(`/archivos/usuario/${dentista.usuario.id}`);
    const logos = lista.body.filter((a) => a.tipo === "logo");
    assert.equal(logos.length, 1, "el logo viejo debe haberse borrado, no quedar huérfano");
    assert.equal(logos[0].id, subida.body.id);
  });

  await t.test("borrar la cuenta con un archivo adjuntado en el chat no falla", async () => {
    const otroDentista = await registrarYLoguear(app, { nombre: "Otro Dentista Adjunto", email: "otro-dentista-adjunto@test.com", tipo: "dentista" });
    const subida = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${otroDentista.token}`)
      .field("tipo", "logo")
      .attach("archivo", JPEG_MINIMO, { filename: "foto.jpg", contentType: "image/jpeg" });
    await request(app)
      .post(`/chat/con/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${otroDentista.token}`)
      .send({ archivo_id: subida.body.id });

    const res = await request(app)
      .delete("/auth/mi-cuenta")
      .set("Authorization", `Bearer ${otroDentista.token}`)
      .send({ password: "secreto123" });
    assert.equal(res.status, 200);
  });
});
