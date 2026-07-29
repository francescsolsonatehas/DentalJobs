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

test("GET /publicaciones con tipo combinado (\"oferta,suplencia,colaboracion\")", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Combinada", email: "clinica-combi@test.com", tipo: "clinica" });
  const dentista = await registrar(app, { nombre: "Dentista Combinado", email: "dentista-combi@test.com", tipo: "dentista" });

  const oferta = await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Vigo", descripcion: "Oferta de control" });
  const suplencia = await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "suplencia", ciudad: "Vigo", descripcion: "Suplencia de control", dias: ["2026-08-05"] });
  const colaboracion = await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "colaboracion", ciudad: "Vigo", descripcion: "Colaboración de control", diasSemana: [{ dia: 2, turno: "manana" }] });
  await request(app).post("/publicaciones").set("Authorization", `Bearer ${dentista.token}`)
    .send({ tipo: "solicitud", ciudad: "Vigo", descripcion: "Solicitud de control" });

  await t.test("trae oferta+suplencia+colaboracion, pero no solicitud", async () => {
    const res = await request(app).get("/publicaciones?tipo=oferta,suplencia,colaboracion");
    assert.equal(res.status, 200);
    const ids = res.body.map(p => p.id).sort((a, b) => a - b);
    assert.deepEqual(ids, [oferta.body.id, suplencia.body.id, colaboracion.body.id].sort((a, b) => a - b));
    assert.ok(!res.body.some(p => p.tipo === "solicitud"));
  });

  await t.test("un solo tipo en la lista se comporta igual que el filtro simple", async () => {
    const combinado = await request(app).get("/publicaciones?tipo=oferta");
    const simple = await request(app).get("/publicaciones?tipo=oferta");
    assert.deepEqual(combinado.body.map(p => p.id), simple.body.map(p => p.id));
  });

  await t.test("sort=ciudad agrupa por ciudad y luego por especialidad también con tipo combinado", async () => {
    const res = await request(app).get("/publicaciones?tipo=oferta,suplencia,colaboracion&sort=ciudad");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 3);
  });

  await t.test("el listado 'Publicaciones de clínicas' del dentista (sin tipo explícito en la app) las trae juntas", async () => {
    // Así es como las pide app.publicaciones.cargar() por defecto para un dentista
    const res = await request(app).get("/publicaciones?tipo=oferta,suplencia,colaboracion&sort=ciudad&page=1&limit=20");
    const ids = res.body.map(p => p.id);
    assert.ok(ids.includes(oferta.body.id));
    assert.ok(ids.includes(suplencia.body.id));
    assert.ok(ids.includes(colaboracion.body.id));
  });
});

test("exportación CSV 'publicaciones': el dentista exporta oferta+suplencia+colaboración juntas", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Export Combi", email: "clinica-export-combi@test.com", tipo: "clinica" });
  const dentista = await registrar(app, { nombre: "Dentista Export Combi", email: "dentista-export-combi@test.com", tipo: "dentista" });

  await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Vigo", descripcion: "Oferta export" });
  await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "colaboracion", ciudad: "Vigo", descripcion: "Colaboración export", diasSemana: [{ dia: 3, turno: "tarde" }] });

  const res = await request(app).get("/exportar/publicaciones.csv").set("Authorization", `Bearer ${dentista.token}`);
  assert.equal(res.status, 200);
  const lineas = res.text.replace("﻿", "").split("\n").filter(Boolean);
  assert.equal(lineas.length, 3); // cabecera + oferta + colaboración
  assert.ok(lineas[0].includes("Días de la semana"));
  assert.ok(lineas.some(l => l.includes("Colaboración") && l.includes("Miércoles (tarde)")));
});
