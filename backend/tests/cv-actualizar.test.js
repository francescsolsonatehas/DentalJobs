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

test("actualizar el CV (subir uno nuevo sustituye al anterior)", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const dentista = await registrarYLoguear(app, { nombre: "Dentista Actualiza", email: "dentista-actualiza-cv@test.com", tipo: "dentista" });

  const primero = await request(app)
    .post("/archivos/upload")
    .set("Authorization", `Bearer ${dentista.token}`)
    .field("tipo", "cv")
    .attach("archivo", Buffer.from("%PDF-1.4 primer cv"), "cv-viejo.pdf");
  assert.equal(primero.status, 200);
  const idPrimero = primero.body.id;

  const segundo = await request(app)
    .post("/archivos/upload")
    .set("Authorization", `Bearer ${dentista.token}`)
    .field("tipo", "cv")
    .attach("archivo", Buffer.from("%PDF-1.4 segundo cv"), "cv-nuevo.pdf");
  assert.equal(segundo.status, 200);
  const idSegundo = segundo.body.id;

  await t.test("el archivo listado es el nuevo, no el viejo", async () => {
    const res = await request(app).get(`/archivos/usuario/${dentista.usuario.id}`);
    const cvs = res.body.filter((a) => a.tipo === "cv");
    assert.equal(cvs.length, 1, "solo debe quedar un CV, no dos");
    assert.equal(cvs[0].id, idSegundo);
    assert.equal(cvs[0].nombre_archivo, "cv-nuevo.pdf");
  });

  await t.test("el archivo viejo ya no se puede descargar (fue borrado)", async () => {
    const res = await request(app).get(`/archivos/${idPrimero}/download`);
    assert.equal(res.status, 404);
  });

  await t.test("el archivo nuevo sí se puede descargar", async () => {
    const res = await request(app).get(`/archivos/${idSegundo}/download`);
    assert.equal(res.status, 200);
  });
});
