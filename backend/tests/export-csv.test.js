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

test("exportar postulaciones a CSV", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica CSV", email: "clinica-csv@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista CSV", email: "dentista-csv@test.com", tipo: "dentista" });

  const oferta = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Bilbao", descripcion: "Oferta exportable" });

  await request(app)
    .post("/candidaturas")
    .set("Authorization", `Bearer ${dentista.token}`)
    .send({ publicacion_id: oferta.body.id, mensaje: "Mensaje con \"comillas\"; y punto y coma" });

  await t.test("la clínica exporta las postulaciones recibidas", async () => {
    const res = await request(app)
      .get("/candidaturas/export.csv")
      .set("Authorization", `Bearer ${clinica.token}`);

    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/csv/);
    assert.match(res.headers["content-disposition"], /postulaciones-recibidas-.*\.csv/);

    const cuerpo = res.text;
    assert.ok(cuerpo.startsWith("﻿"), "debe empezar con BOM UTF-8");
    const lineas = cuerpo.replace("﻿", "").split("\n");
    assert.match(lineas[0], /Candidato/);
    assert.equal(lineas.length, 2);
    assert.match(lineas[1], /Dentista CSV/);
    assert.match(lineas[1], /pendiente/);
    // Las comillas del mensaje deben ir escapadas como ""
    assert.match(lineas[1], /""comillas""/);
  });

  await t.test("el dentista exporta sus postulaciones enviadas", async () => {
    const res = await request(app)
      .get("/candidaturas/export.csv")
      .set("Authorization", `Bearer ${dentista.token}`);

    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /postulaciones-enviadas-.*\.csv/);

    const lineas = res.text.replace("﻿", "").split("\n");
    assert.match(lineas[0], /Publicado por/);
    assert.match(lineas[1], /Clínica CSV/);
  });

  await t.test("un tipo de exportación inválido devuelve 400", async () => {
    const res = await request(app)
      .get("/candidaturas/export.csv?tipo=otro")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 400);
  });
});
