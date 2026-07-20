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
    assert.ok(Array.isArray(res.body.especialidades), "incluye especialidades");
  });

  await t.test("el perfil público de una clínica incluye sus sedes completas", async () => {
    await request(app)
      .post("/sedes")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ nombre: "Sede Centro", ciudad: "Barcelona", provincia: "Barcelona", direccion: "Calle Mayor 1", codigo_postal: "08001", telefono: "931112233" });

    const res = await request(app).get(`/usuarios/${clinica.usuario.id}/publico`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.sedes), "incluye sedes");
    assert.equal(res.body.sedes.length, 1);
    const sede = res.body.sedes[0];
    assert.equal(sede.nombre, "Sede Centro");
    assert.equal(sede.direccion, "Calle Mayor 1");
    assert.equal(sede.telefono, "931112233");
    assert.equal(res.body.email, undefined);
  });

  // El equipamiento es de la clínica entera, no de cada sede: se declara una vez y
  // el perfil público lo devuelve al mismo nivel que el resto de sus datos.
  await t.test("el perfil público expone el equipamiento de la clínica", async () => {
    await request(app)
      .post("/auth/guardar-equipamiento")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ equipamiento: ["Microscopio", "CAD-CAM", "Inventado que no existe"] });

    const res = await request(app).get(`/usuarios/${clinica.usuario.id}/publico`);
    assert.deepEqual(res.body.equipamiento.sort(), ["CAD-CAM", "Microscopio"]);
    // Las sedes ya no llevan equipamiento propio
    assert.equal(res.body.sedes[0].equipamiento, undefined);
  });

  await t.test("el perfil público de un dentista no incluye sedes", async () => {
    const res = await request(app).get(`/usuarios/${dentista.usuario.id}/publico`);
    assert.equal(res.body.sedes, undefined);
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
