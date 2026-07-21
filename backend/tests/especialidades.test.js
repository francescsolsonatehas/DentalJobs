const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");

test("catálogo de especialidades", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  await t.test("'Cirugía oral' e 'Implantología' se fundieron en 'Cirugía e Implantología'", async () => {
    const res = await request(app).get("/especialidades");
    assert.equal(res.status, 200);
    const nombres = res.body.map(e => e.nombre);

    assert.ok(nombres.includes("Cirugía e Implantología"), "existe la especialidad fusionada");
    assert.ok(!nombres.includes("Cirugía oral"), "ya no existe 'Cirugía oral'");
    assert.ok(!nombres.includes("Implantología"), "ya no existe 'Implantología'");
  });

  await t.test("el resto de especialidades siguen presentes", async () => {
    const res = await request(app).get("/especialidades");
    const nombres = res.body.map(e => e.nombre);
    for (const esp of ["Generalista", "Endodoncia", "Periodoncia", "Ortodoncia", "Estética dental", "Odontopediatría"]) {
      assert.ok(nombres.includes(esp), `sigue existiendo ${esp}`);
    }
  });
});
