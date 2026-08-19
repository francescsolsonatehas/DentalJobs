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

// Un archivo (CV, Book…) adjuntado a un mensaje de chat queda referenciado por
// mensajes.archivo_id. Con PRAGMA foreign_keys = ON, borrar el archivo sin
// desvincular antes esos mensajes hace fallar el borrado (bug real: "Error al
// eliminar archivo").
test("eliminar/actualizar un archivo adjuntado en el chat no debe romperse por la clave foránea", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const dentista = await registrarYLoguear(app, { nombre: "Dentista Adjunto", email: "dentista-adjunto@test.com", tipo: "dentista" });
  const clinica = await registrarYLoguear(app, { nombre: "Clínica Adjunto", email: "clinica-adjunto@test.com", tipo: "clinica" });

  async function subirCv(nombreArchivo) {
    const res = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${dentista.token}`)
      .field("tipo", "cv")
      .attach("archivo", Buffer.from("%PDF-1.4 cv"), nombreArchivo);
    return res.body.id;
  }

  async function adjuntarEnChat(archivoId) {
    const res = await request(app)
      .post(`/chat/con/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ archivo_id: archivoId });
    return res.body.id;
  }

  await t.test("eliminar un CV adjuntado en un mensaje no falla, y el mensaje sobrevive sin el adjunto", async () => {
    const cvId = await subirCv("cv-1.pdf");
    const mensajeId = await adjuntarEnChat(cvId);
    assert.ok(mensajeId);

    const res = await request(app)
      .delete(`/archivos/${cvId}`)
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.status, 200);

    const hilo = await request(app)
      .get(`/chat/con/${dentista.usuario.id}`)
      .set("Authorization", `Bearer ${clinica.token}`);
    const mensaje = hilo.body.mensajes.find((m) => m.id === mensajeId);
    assert.ok(mensaje, "el mensaje debe seguir existiendo");
    assert.equal(mensaje.archivo_id, null);
  });

  await t.test("actualizar (subir un CV nuevo) cuando el anterior está adjuntado en el chat no falla", async () => {
    const cvViejo = await subirCv("cv-2.pdf");
    await adjuntarEnChat(cvViejo);

    const subida = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${dentista.token}`)
      .field("tipo", "cv")
      .attach("archivo", Buffer.from("%PDF-1.4 cv nuevo"), "cv-3.pdf");
    assert.equal(subida.status, 200);

    const lista = await request(app).get(`/archivos/usuario/${dentista.usuario.id}`);
    const cvs = lista.body.filter((a) => a.tipo === "cv");
    assert.equal(cvs.length, 1, "el CV viejo debe haberse borrado, no quedar huérfano");
    assert.equal(cvs[0].nombre_archivo, "cv-3.pdf");
  });

  await t.test("borrar la cuenta con un CV adjuntado en el chat no falla", async () => {
    const otroDentista = await registrarYLoguear(app, { nombre: "Otro Dentista Adjunto", email: "otro-dentista-adjunto@test.com", tipo: "dentista" });
    const subida = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${otroDentista.token}`)
      .field("tipo", "cv")
      .attach("archivo", Buffer.from("%PDF-1.4 cv"), "cv-4.pdf");
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
