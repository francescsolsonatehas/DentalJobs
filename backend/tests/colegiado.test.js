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

test("verificación de nº de colegiado", async (t) => {
  process.env.ADMIN_TOKEN = "token-de-prueba-admin";
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const dentista = await registrarYLoguear(app, { nombre: "Dentista Colegiado", email: "dentista-colegiado@test.com", tipo: "dentista" });
  const clinica = await registrarYLoguear(app, { nombre: "Clínica Colegiado", email: "clinica-colegiado@test.com", tipo: "clinica" });

  await t.test("por defecto el estado es 'sin_indicar' y no aparece en el perfil público", async () => {
    const perfil = await request(app)
      .get("/auth/mi-perfil")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(perfil.body.colegiado_estado, "sin_indicar");

    const publico = await request(app).get(`/usuarios/${dentista.usuario.id}/publico`);
    assert.equal(publico.body.num_colegiado, null);
  });

  await t.test("al indicar un nº de colegiado, el estado pasa a 'pendiente'", async () => {
    const res = await request(app)
      .put("/auth/actualizar-perfil")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ nombre: "Dentista Colegiado", num_colegiado: "12345", colegio: "Colegio de Odontólogos de Barcelona" });
    assert.equal(res.status, 200);

    const perfil = await request(app)
      .get("/auth/mi-perfil")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(perfil.body.colegiado_estado, "pendiente");
    assert.equal(perfil.body.num_colegiado, "12345");
  });

  await t.test("una clínica no puede indicar nº de colegiado (se ignora silenciosamente)", async () => {
    await request(app)
      .put("/auth/actualizar-perfil")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ nombre: "Clínica Colegiado", num_colegiado: "99999", colegio: "Intento clínica" });

    const perfil = await request(app)
      .get("/auth/mi-perfil")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(perfil.body.num_colegiado, null);
  });

  await t.test("los endpoints /admin/* exigen el token correcto", async () => {
    const sinToken = await request(app).get("/admin/verificaciones-pendientes");
    assert.equal(sinToken.status, 401);

    const tokenMalo = await request(app)
      .get("/admin/verificaciones-pendientes")
      .set("X-Admin-Token", "incorrecto");
    assert.equal(tokenMalo.status, 401);
  });

  await t.test("el admin ve la solicitud pendiente del dentista", async () => {
    const res = await request(app)
      .get("/admin/verificaciones-pendientes")
      .set("X-Admin-Token", "token-de-prueba-admin");
    assert.equal(res.status, 200);
    const encontrado = res.body.pendientes.find(p => p.id === dentista.usuario.id);
    assert.ok(encontrado);
    assert.equal(encontrado.num_colegiado, "12345");
  });

  await t.test("el admin puede verificar la colegiación", async () => {
    const res = await request(app)
      .put(`/admin/verificaciones/${dentista.usuario.id}`)
      .set("X-Admin-Token", "token-de-prueba-admin")
      .send({ estado: "verificado" });
    assert.equal(res.status, 200);

    const publico = await request(app).get(`/usuarios/${dentista.usuario.id}/publico`);
    assert.equal(publico.body.colegiado_estado, "verificado");
    assert.equal(publico.body.num_colegiado, "12345");
    assert.equal(publico.body.colegio, "Colegio de Odontólogos de Barcelona");
  });

  await t.test("ya verificado, deja de aparecer en la lista de pendientes", async () => {
    const res = await request(app)
      .get("/admin/verificaciones-pendientes")
      .set("X-Admin-Token", "token-de-prueba-admin");
    assert.ok(!res.body.pendientes.find(p => p.id === dentista.usuario.id));
  });

  await t.test("si el dentista cambia el número, la verificación se reinicia a 'pendiente'", async () => {
    await request(app)
      .put("/auth/actualizar-perfil")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ nombre: "Dentista Colegiado", num_colegiado: "67890", colegio: "Colegio de Odontólogos de Barcelona" });

    const perfil = await request(app)
      .get("/auth/mi-perfil")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(perfil.body.colegiado_estado, "pendiente");

    // Y ya no se muestra como verificado públicamente hasta que se revise de nuevo
    const publico = await request(app).get(`/usuarios/${dentista.usuario.id}/publico`);
    assert.equal(publico.body.num_colegiado, null);
  });

  await t.test("el admin puede rechazar una verificación", async () => {
    const res = await request(app)
      .put(`/admin/verificaciones/${dentista.usuario.id}`)
      .set("X-Admin-Token", "token-de-prueba-admin")
      .send({ estado: "rechazado" });
    assert.equal(res.status, 200);

    const perfil = await request(app)
      .get("/auth/mi-perfil")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(perfil.body.colegiado_estado, "rechazado");
  });

  await t.test("un estado inválido en /admin/verificaciones se rechaza", async () => {
    const res = await request(app)
      .put(`/admin/verificaciones/${dentista.usuario.id}`)
      .set("X-Admin-Token", "token-de-prueba-admin")
      .send({ estado: "loquesea" });
    assert.equal(res.status, 400);
  });

  await t.test("borrar la cuenta limpia también los datos de colegiación", async () => {
    await request(app)
      .delete("/auth/mi-cuenta")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ password: "secreto123" });

    const publico = await request(app).get(`/usuarios/${dentista.usuario.id}/publico`);
    assert.equal(publico.body.colegiado_estado, "sin_indicar");
  });
});
