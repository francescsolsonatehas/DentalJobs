const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");

async function registrar(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo, aceptaTerminos: true });
  return { token: res.body.token, usuario: res.body.usuario };
}

function parsear(texto) {
  const lineas = texto.replace("﻿", "").split("\n");
  return { cabecera: lineas[0], filas: lineas.slice(1), total: lineas.length };
}

test("exportaciones a CSV de las vistas del listado", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Norte", email: "clinica-exp@test.com", tipo: "clinica" });
  const dentista = await registrar(app, { nombre: "Ana Dentista", email: "dentista-exp@test.com", tipo: "dentista" });

  // La clínica publica una oferta y una suplencia
  const oferta = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Bilbao", descripcion: "Odontólogo general", salarioDesde: 2000, salarioHasta: 3000 });

  await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "suplencia", ciudad: "Bilbao", descripcion: "Turno sábado", fecha_desde: "2026-08-01", urgente: true });

  // El dentista publica su solicitud (perfil) y se postula a la oferta
  await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${dentista.token}`)
    .send({ tipo: "solicitud", ciudad: "Bilbao", descripcion: "Busco clínica" });

  await request(app)
    .post("/candidaturas")
    .set("Authorization", `Bearer ${dentista.token}`)
    .send({ publicacion_id: oferta.body.id, mensaje: "Me interesa" });

  await t.test("un dentista exporta las publicaciones de clínicas (oferta + suplencia juntas, no las solicitudes)", async () => {
    const res = await request(app)
      .get("/exportar/publicaciones.csv")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /publicaciones-de-clinicas-.*\.csv/);
    const { cabecera, filas } = parsear(res.text);
    assert.match(cabecera, /Publicado por/);
    assert.equal(filas.length, 2); // oferta + suplencia, no la solicitud del propio dentista
    assert.ok(filas.some(f => f.includes("Oferta de empleo")));
    assert.ok(filas.some(f => f.includes("Suplencia")));
  });

  await t.test("el dentista puede acotar la exportación a un solo tipo con ?tipo=", async () => {
    const res = await request(app)
      .get("/exportar/publicaciones.csv?tipo=oferta")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.status, 200);
    const { filas } = parsear(res.text);
    assert.equal(filas.length, 1);
    assert.match(filas[0], /Oferta de empleo/);
  });

  await t.test("una clínica exporta las publicaciones de dentistas (solicitudes)", async () => {
    const res = await request(app)
      .get("/exportar/publicaciones.csv")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /publicaciones-de-dentistas-.*\.csv/);
    const { filas } = parsear(res.text);
    assert.equal(filas.length, 1);
    assert.match(filas[0], /Solicitud de empleo/);
  });

  await t.test("los filtros de la vista se aplican al CSV", async () => {
    const res = await request(app)
      .get("/exportar/publicaciones.csv?ciudad=Madrid")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.status, 200);
    assert.equal(parsear(res.text).filas.filter(Boolean).length, 0);
  });

  await t.test("suplencias solo está disponible para dentistas", async () => {
    const ok = await request(app)
      .get("/exportar/suplencias.csv")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(ok.status, 200);
    assert.equal(parsear(ok.text).filas.length, 1);
    assert.match(ok.text, /Turno sábado/);

    const prohibido = await request(app)
      .get("/exportar/suplencias.csv")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(prohibido.status, 403);
  });

  await t.test("mis-publicaciones incluye el recuento de postulaciones", async () => {
    const res = await request(app)
      .get("/exportar/mis-publicaciones.csv")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /mis-publicaciones-.*\.csv/);
    const { cabecera, filas } = parsear(res.text);
    assert.match(cabecera, /Postulaciones recibidas/);
    assert.equal(filas.length, 2); // oferta + suplencia de la clínica
  });

  await t.test("perfiles: la clínica exporta dentistas sin email ni teléfono", async () => {
    const res = await request(app)
      .get("/exportar/perfiles.csv")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /perfiles-de-dentistas-.*\.csv/);
    const { cabecera, filas } = parsear(res.text);
    assert.doesNotMatch(cabecera, /Email/);
    assert.match(filas[0], /Ana Dentista/);
  });

  await t.test("mis-postulaciones exporta las enviadas por el dentista", async () => {
    const res = await request(app)
      .get("/exportar/mis-postulaciones.csv")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.status, 200);
    const { cabecera, filas } = parsear(res.text);
    assert.match(cabecera, /Publicado por/);
    assert.match(filas[0], /Clínica Norte/);
  });

  await t.test("una vista desconocida devuelve 400", async () => {
    const res = await request(app)
      .get("/exportar/inexistente.csv")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 400);
  });

  await t.test("sin token no se puede exportar", async () => {
    const res = await request(app).get("/exportar/publicaciones.csv");
    assert.equal(res.status, 401);
  });
});
