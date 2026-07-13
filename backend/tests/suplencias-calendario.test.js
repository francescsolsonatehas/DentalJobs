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

test("calendario mensual de suplencias", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Cal", email: "clinica-cal@test.com", tipo: "clinica" });

  const crearSuplencia = (descripcion, dias, urgente = false) =>
    request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "suplencia", ciudad: "Bilbao", descripcion, dias, urgente });

  const s1 = await crearSuplencia("Agosto normal", ["2026-08-07", "2026-08-21"]);
  const s2 = await crearSuplencia("Agosto urgente", ["2026-08-07"], true);
  await crearSuplencia("Septiembre", ["2026-09-03"]);

  await t.test("agrupa las suplencias de agosto por día", async () => {
    const res = await request(app).get("/suplencias/calendario").query({ anyo: 2026, mes: 8 });
    assert.equal(res.status, 200);
    const dias = res.body.dias;
    // El 7 tiene dos suplencias (una urgente), el 21 una, y no aparece septiembre
    assert.equal(dias["2026-08-07"].length, 2);
    assert.ok(dias["2026-08-07"].some(x => x.urgente === true));
    assert.equal(dias["2026-08-21"].length, 1);
    assert.equal(dias["2026-09-03"], undefined);
    const ids = dias["2026-08-07"].map(x => x.id).sort();
    assert.deepEqual(ids, [s1.body.id, s2.body.id].sort());
  });

  await t.test("otro mes devuelve solo lo suyo", async () => {
    const res = await request(app).get("/suplencias/calendario").query({ anyo: 2026, mes: 9 });
    assert.deepEqual(Object.keys(res.body.dias), ["2026-09-03"]);
  });

  await t.test("una suplencia retirada desaparece del calendario", async () => {
    await request(app).delete(`/publicaciones/${s1.body.id}`).set("Authorization", `Bearer ${clinica.token}`);
    const res = await request(app).get("/suplencias/calendario").query({ anyo: 2026, mes: 8 });
    // El 21 era solo de s1 → desaparece; el 7 queda solo con s2
    assert.equal(res.body.dias["2026-08-21"], undefined);
    assert.equal(res.body.dias["2026-08-07"].length, 1);
    assert.equal(res.body.dias["2026-08-07"][0].id, s2.body.id);
  });

  await t.test("mes inválido → 400", async () => {
    const res = await request(app).get("/suplencias/calendario").query({ anyo: 2026, mes: 13 });
    assert.equal(res.status, 400);
  });
});
