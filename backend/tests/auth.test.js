const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");

test("auth", async (t) => {
  const { app, dbPath } = createTestApp();

  t.after(() => cleanupTestApp(dbPath));

  await t.test("registra un nuevo usuario y devuelve token", async () => {
    const res = await request(app)
      .post("/auth/registro")
      .send({
        nombre: "Clínica Uno",
        email: "clinica1@test.com",
        password: "secreto123",
        tipo: "clinica"
      });

    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.usuario.tipo, "clinica");
  });

  await t.test("rechaza email duplicado", async () => {
    await request(app)
      .post("/auth/registro")
      .send({ nombre: "Otra Clínica", email: "duplicado@test.com", password: "secreto123", tipo: "clinica" });

    const res = await request(app)
      .post("/auth/registro")
      .send({ nombre: "Otra Clínica 2", email: "duplicado@test.com", password: "secreto123", tipo: "clinica" });

    assert.equal(res.status, 400);
  });

  await t.test("rechaza contraseñas de menos de 8 caracteres o vacías", async () => {
    const corta = await request(app)
      .post("/auth/registro")
      .send({ nombre: "Clínica Corta", email: "corta@test.com", password: "corta12", tipo: "clinica" });
    assert.equal(corta.status, 400);

    const vacia = await request(app)
      .post("/auth/registro")
      .send({ nombre: "Clínica Vacía", email: "vacia@test.com", password: "", tipo: "clinica" });
    assert.equal(vacia.status, 400);
  });

  await t.test("la nueva contraseña también exige 8 caracteres al cambiarla", async () => {
    const reg = await request(app)
      .post("/auth/registro")
      .send({ nombre: "Dentista Cambio", email: "cambio@test.com", password: "original123", tipo: "dentista" });

    const res = await request(app)
      .put("/auth/cambiar-password")
      .set("Authorization", `Bearer ${reg.body.token}`)
      .send({ passwordActual: "original123", passwordNueva: "corta" });
    assert.equal(res.status, 400);
  });

  await t.test("login correcto devuelve token", async () => {
    await request(app)
      .post("/auth/registro")
      .send({ nombre: "Dentista Uno", email: "dentista1@test.com", password: "mipassword", tipo: "dentista" });

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "dentista1@test.com", password: "mipassword" });

    assert.equal(res.status, 200);
    assert.ok(res.body.token);
  });

  await t.test("login con contraseña incorrecta falla", async () => {
    await request(app)
      .post("/auth/registro")
      .send({ nombre: "Dentista Dos", email: "dentista2@test.com", password: "correcta", tipo: "dentista" });

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "dentista2@test.com", password: "incorrecta" });

    assert.equal(res.status, 400);
  });
});
