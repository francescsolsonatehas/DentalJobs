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

// El estado de colegiación viaja en la lista de candidatos para que la clínica
// vea el sello de "verificado" justo cuando revisa a quién ha postulado.
test("la lista de candidatos expone el estado de colegiación", async (t) => {
  process.env.ADMIN_TOKEN = "token-de-prueba-admin";
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Cand", email: "clinica-cand@test.com", tipo: "clinica" });
  const dentista = await registrar(app, { nombre: "Dentista Cand", email: "dentista-cand@test.com", tipo: "dentista" });

  // El dentista indica su nº de colegiado (queda 'pendiente') y el admin lo verifica
  await request(app)
    .put("/auth/actualizar-perfil")
    .set("Authorization", `Bearer ${dentista.token}`)
    .send({ nombre: "Dentista Cand", num_colegiado: "54321", colegio: "Colegio de Odontólogos de Madrid" });
  await request(app)
    .put(`/admin/verificaciones/${dentista.usuario.id}`)
    .set("X-Admin-Token", "token-de-prueba-admin")
    .send({ estado: "verificado" });

  const oferta = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Madrid", descripcion: "Odontólogo generalista" });

  await request(app)
    .post("/candidaturas")
    .set("Authorization", `Bearer ${dentista.token}`)
    .send({ publicacion_id: oferta.body.id });

  await t.test("el candidato verificado llega con colegiado_estado = 'verificado'", async () => {
    const res = await request(app)
      .get(`/publicaciones/${oferta.body.id}/candidatos`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 200);
    const candidato = res.body.candidatos.find(c => c.usuario_id === dentista.usuario.id);
    assert.ok(candidato, "el dentista debe aparecer entre los candidatos");
    assert.equal(candidato.colegiado_estado, "verificado");
  });
});
