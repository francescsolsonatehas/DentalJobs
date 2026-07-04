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

test("plantillas de publicación", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Plant", email: "clinica-plant@test.com", tipo: "clinica" });
  const otra = await registrarYLoguear(app, { nombre: "Otra Clínica", email: "otra-plant@test.com", tipo: "clinica" });

  let plantillaId;

  await t.test("se puede guardar una plantilla con especialidades", async () => {
    const res = await request(app)
      .post("/plantillas")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({
        nombre: "Ortodoncia BCN",
        tipo: "oferta",
        ciudad: "Barcelona",
        contrato: "Indefinido",
        jornada: "Completa",
        salario: "2500€/mes",
        descripcion: "Buscamos ortodoncista",
        especialidades: [6]
      });

    assert.equal(res.status, 200);
    plantillaId = res.body.id;
    assert.ok(plantillaId);
  });

  await t.test("la plantilla necesita nombre y tipo válido", async () => {
    const sinNombre = await request(app)
      .post("/plantillas")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Madrid" });
    assert.equal(sinNombre.status, 400);

    const tipoMalo = await request(app)
      .post("/plantillas")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ nombre: "X", tipo: "otro" });
    assert.equal(tipoMalo.status, 400);
  });

  await t.test("cada usuario solo ve sus plantillas (especialidades ya parseadas)", async () => {
    const propias = await request(app)
      .get("/plantillas")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(propias.body.plantillas.length, 1);
    assert.deepEqual(propias.body.plantillas[0].especialidades, [6]);
    assert.equal(propias.body.plantillas[0].ciudad, "Barcelona");

    const ajenas = await request(app)
      .get("/plantillas")
      .set("Authorization", `Bearer ${otra.token}`);
    assert.equal(ajenas.body.plantillas.length, 0);
  });

  await t.test("no se puede eliminar una plantilla ajena", async () => {
    const res = await request(app)
      .delete(`/plantillas/${plantillaId}`)
      .set("Authorization", `Bearer ${otra.token}`);
    assert.equal(res.status, 403);
  });

  await t.test("el dueño puede eliminar su plantilla", async () => {
    const res = await request(app)
      .delete(`/plantillas/${plantillaId}`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 200);

    const restantes = await request(app)
      .get("/plantillas")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(restantes.body.plantillas.length, 0);
  });
});
