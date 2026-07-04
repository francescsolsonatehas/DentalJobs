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

test("legal: consentimiento y borrado de cuenta", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const bd = createClient({ url: "file:" + dbPath, intMode: "number" });

  await t.test("sin aceptar los términos no hay registro", async () => {
    const res = await request(app)
      .post("/auth/registro")
      .send({ nombre: "Sin Términos", email: "sinterminos@test.com", password: "secreto123", tipo: "dentista" });
    assert.equal(res.status, 400);
  });

  await t.test("al aceptar, queda registrada la fecha de consentimiento", async () => {
    const dentista = await registrarYLoguear(app, { nombre: "Con Términos", email: "conterminos@test.com", tipo: "dentista" });

    const fila = await bd.execute({
      sql: "SELECT acepto_terminos_en FROM usuarios WHERE id = ?",
      args: [dentista.usuario.id]
    });
    assert.ok(fila.rows[0].acepto_terminos_en, "debe guardarse la fecha de aceptación");
  });

  await t.test("borrado de cuenta: anonimiza sin romper el historial de otros", async () => {
    const clinica = await registrarYLoguear(app, { nombre: "Clínica Legal", email: "clinica-legal@test.com", tipo: "clinica" });
    const dentista = await registrarYLoguear(app, { nombre: "Dentista Legal", email: "dentista-legal@test.com", tipo: "dentista" });

    // Flujo completo: oferta → candidatura aceptada → reseña del dentista a la clínica
    const oferta = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Lleida", descripcion: "Oferta legal" });

    const candidatura = await request(app)
      .post("/candidaturas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: oferta.body.id });

    await request(app)
      .put(`/candidaturas/${candidatura.body.candidatura_id}`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ estado: "aceptada" });

    await request(app)
      .post("/resenyas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ candidatura_id: candidatura.body.candidatura_id, puntuacion: 5, comentario: "Muy buena clínica" });

    // Contraseña incorrecta → no se borra
    const mal = await request(app)
      .delete("/auth/mi-cuenta")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ password: "incorrecta" });
    assert.equal(mal.status, 403);

    // Borrado correcto
    const bien = await request(app)
      .delete("/auth/mi-cuenta")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ password: "secreto123" });
    assert.equal(bien.status, 200);

    // Ya no se puede iniciar sesión
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "dentista-legal@test.com", password: "secreto123" });
    assert.equal(login.status, 400);

    // El perfil público queda anonimizado
    const publico = await request(app).get(`/usuarios/${dentista.usuario.id}/publico`);
    assert.equal(publico.body.nombre, "Usuario eliminado");
    assert.equal(publico.body.ciudad, null);

    // La reseña que recibió la clínica sigue, con autor anonimizado
    const resenyas = await request(app).get(`/resenyas/usuario/${clinica.usuario.id}`);
    assert.equal(resenyas.body.total, 1);
    assert.equal(resenyas.body.resenyas[0].autor_nombre, "Usuario eliminado");
    assert.equal(resenyas.body.resenyas[0].comentario, "Muy buena clínica");

    // La candidatura con reseña se conserva (la referencia la reseña),
    // pero sin el mensaje personal
    const candidaturas = await bd.execute({
      sql: "SELECT mensaje FROM candidaturas WHERE usuario_id = ?",
      args: [dentista.usuario.id]
    });
    assert.equal(candidaturas.rows.length, 1);
    assert.equal(candidaturas.rows[0].mensaje, null);
  });
});
