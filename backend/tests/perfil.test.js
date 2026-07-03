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

test("perfil enriquecido", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const dentista = await registrarYLoguear(app, { nombre: "Dentista Perfil", email: "dentista-perfil@test.com", tipo: "dentista" });
  const clinica = await registrarYLoguear(app, { nombre: "Clínica Perfil", email: "clinica-perfil@test.com", tipo: "clinica" });

  await t.test("se pueden guardar años de experiencia y descripción", async () => {
    const res = await request(app)
      .put("/auth/actualizar-perfil")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ nombre: "Dentista Perfil", anyos_experiencia: 7, descripcion: "Endodoncista con 7 años de experiencia" });
    assert.equal(res.status, 200);

    const perfil = await request(app)
      .get("/auth/mi-perfil")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(perfil.body.anyos_experiencia, 7);
    assert.equal(perfil.body.descripcion, "Endodoncista con 7 años de experiencia");
  });

  await t.test("el perfil público expone experiencia y descripción pero no el email", async () => {
    const res = await request(app).get(`/usuarios/${dentista.usuario.id}/publico`);
    assert.equal(res.status, 200);
    assert.equal(res.body.anyos_experiencia, 7);
    assert.equal(res.body.descripcion, "Endodoncista con 7 años de experiencia");
    assert.equal(res.body.email, undefined);
  });

  await t.test("una clínica puede subir fotos (tipo 'foto')", async () => {
    const res = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${clinica.token}`)
      .field("tipo", "foto")
      .attach("archivo", Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]), { filename: "clinica.jpg", contentType: "image/jpeg" });

    assert.equal(res.status, 200);
    assert.ok(res.body.id);

    const archivos = await request(app).get(`/archivos/usuario/${clinica.usuario.id}`);
    const fotos = archivos.body.filter((a) => a.tipo === "foto");
    assert.equal(fotos.length, 1);
  });

  await t.test("una foto que no es imagen se rechaza", async () => {
    const res = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${clinica.token}`)
      .field("tipo", "foto")
      .attach("archivo", Buffer.from("no soy una imagen"), { filename: "doc.pdf", contentType: "application/pdf" });

    assert.equal(res.status, 400);
  });
});
