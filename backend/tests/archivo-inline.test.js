const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");

test("descarga de archivo: inline vs adjunto", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const reg = await request(app)
    .post("/auth/registro")
    .send({ nombre: "Dentista Inline", email: "inline@test.com", password: "secreto123", tipo: "dentista", aceptaTerminos: true });
  const token = reg.body.token;

  const subida = await request(app)
    .post("/archivos/upload")
    .set("Authorization", `Bearer ${token}`)
    .field("tipo", "portfolio")
    .attach("archivo", Buffer.from("%PDF-1.4 book"), "caso.pdf");
  const id = subida.body.id;

  await t.test("por defecto se descarga (attachment)", async () => {
    const res = await request(app).get(`/archivos/${id}/download`);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /^attachment;/);
  });

  await t.test("con ?inline=1 se muestra (inline)", async () => {
    const res = await request(app).get(`/archivos/${id}/download?inline=1`);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /^inline;/);
  });
});
