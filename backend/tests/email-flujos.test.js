const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createClient } = require("@libsql/client");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");

async function registrarYLoguear(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo, aceptaTerminos: true });
  return { token: res.body.token, usuario: res.body.usuario };
}

// Los emails van en modo consola durante los tests: el token se lee
// directamente de la BD temporal, igual que haría el enlace del correo.
function abrirBd(dbPath) {
  return createClient({ url: "file:" + dbPath, intMode: "number" });
}

test("flujos de email (recuperación y verificación)", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const dentista = await registrarYLoguear(app, { nombre: "Dentista Email", email: "dentista-email@test.com", tipo: "dentista" });
  const bd = abrirBd(dbPath);

  await t.test("el registro crea un token de verificación y el email queda sin verificar", async () => {
    const perfil = await request(app)
      .get("/auth/mi-perfil")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(perfil.body.email_verificado, 0);

    const tokens = await bd.execute({
      sql: "SELECT token FROM tokens_verificacion WHERE usuario_id = ? AND tipo = 'verificacion'",
      args: [dentista.usuario.id]
    });
    assert.equal(tokens.rows.length, 1);
  });

  await t.test("el enlace de verificación marca el email como verificado", async () => {
    const tokens = await bd.execute({
      sql: "SELECT token FROM tokens_verificacion WHERE usuario_id = ? AND tipo = 'verificacion'",
      args: [dentista.usuario.id]
    });

    const res = await request(app).get(`/auth/verificar-email/${tokens.rows[0].token}`);
    assert.equal(res.status, 200);

    const perfil = await request(app)
      .get("/auth/mi-perfil")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(perfil.body.email_verificado, 1);

    // El token se consume: segundo uso falla
    const reuso = await request(app).get(`/auth/verificar-email/${tokens.rows[0].token}`);
    assert.equal(reuso.status, 400);
  });

  await t.test("olvide-password responde igual exista o no el email", async () => {
    const existe = await request(app)
      .post("/auth/olvide-password")
      .send({ email: "dentista-email@test.com" });
    const noExiste = await request(app)
      .post("/auth/olvide-password")
      .send({ email: "nadie@test.com" });

    assert.equal(existe.status, 200);
    assert.equal(noExiste.status, 200);
    assert.deepEqual(existe.body, noExiste.body);
  });

  await t.test("el token de recuperación permite crear una contraseña nueva (una sola vez)", async () => {
    const tokens = await bd.execute({
      sql: "SELECT token FROM tokens_verificacion WHERE usuario_id = ? AND tipo = 'password'",
      args: [dentista.usuario.id]
    });
    assert.equal(tokens.rows.length, 1);
    const token = tokens.rows[0].token;

    const corta = await request(app)
      .post("/auth/restablecer-password")
      .send({ token, passwordNueva: "corta" });
    assert.equal(corta.status, 400);

    const ok = await request(app)
      .post("/auth/restablecer-password")
      .send({ token, passwordNueva: "nuevaSegura123" });
    assert.equal(ok.status, 200);

    // Login con la nueva funciona, con la antigua no
    const loginNuevo = await request(app)
      .post("/auth/login")
      .send({ email: "dentista-email@test.com", password: "nuevaSegura123" });
    assert.equal(loginNuevo.status, 200);

    const loginViejo = await request(app)
      .post("/auth/login")
      .send({ email: "dentista-email@test.com", password: "secreto123" });
    assert.equal(loginViejo.status, 400);

    // El token ya está consumido
    const reuso = await request(app)
      .post("/auth/restablecer-password")
      .send({ token, passwordNueva: "otraMas12345" });
    assert.equal(reuso.status, 400);
  });

  await t.test("un token inventado no restablece nada", async () => {
    const res = await request(app)
      .post("/auth/restablecer-password")
      .send({ token: "inventado", passwordNueva: "loquesea123" });
    assert.equal(res.status, 400);
  });
});
