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

test("colaboraciones (publicables por clínica o dentista, días de la semana)", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Colab", email: "clinica-colab@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Colab", email: "dentista-colab@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${dentista.token}`)
    .send({ nombre: "Dentista Colab", ciudad: "Reus" });

  let colabClinicaId, colabDentistaId;

  await t.test("una clínica puede crear una colaboración con días de la semana", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({
        tipo: "colaboracion", ciudad: "Reus", descripcion: "Ortodoncista un par de días",
        diasSemana: [{ dia: 1, turno: "manana" }, { dia: 3, turno: "ambos" }]
      });
    assert.equal(res.status, 200);
    colabClinicaId = res.body.id;
  });

  await t.test("un dentista puede crear una colaboración (ciudad heredada de su perfil)", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ tipo: "colaboracion", descripcion: "Especialista disponible para clínicas", diasSemana: [{ dia: 2, turno: "tarde" }] });
    assert.equal(res.status, 200);
    colabDentistaId = res.body.id;
    const detalle = await request(app).get(`/publicaciones/${colabDentistaId}`);
    assert.equal(detalle.body.ciudad, "Reus");
  });

  await t.test("una colaboración sin ningún día se rechaza", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "colaboracion", ciudad: "Reus", descripcion: "Sin días" });
    assert.equal(res.status, 400);
  });

  await t.test("un día fuera de 1-6 o un turno inválido se descarta, y si no queda ninguno se rechaza", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "colaboracion", ciudad: "Reus", descripcion: "Domingo no vale", diasSemana: [{ dia: 7, turno: "manana" }, { dia: 2, turno: "invalido" }] });
    assert.equal(res.status, 400);
  });

  await t.test("ni una clínica ni un dentista pueden crear un tipo que no les corresponde", async () => {
    const clinicaSolicitud = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "solicitud", descripcion: "x" });
    assert.equal(clinicaSolicitud.status, 403);

    const dentistaSuplencia = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ tipo: "suplencia", ciudad: "Reus", descripcion: "x", dias: ["2026-08-01"] });
    assert.equal(dentistaSuplencia.status, 403);
  });

  await t.test("el detalle de una colaboración trae los días de la semana con turno", async () => {
    const res = await request(app).get(`/publicaciones/${colabClinicaId}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.diasSemana, [{ dia: 1, turno: "manana" }, { dia: 3, turno: "ambos" }]);
  });

  await t.test("editar los días de la semana reemplaza el conjunto anterior", async () => {
    const res = await request(app)
      .put(`/publicaciones/${colabClinicaId}`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ descripcion: "Ortodoncista, ahora otros días", ciudad: "Reus", especialidades: [], diasSemana: [{ dia: 5, turno: "tarde" }] });
    assert.equal(res.status, 200);
    const detalle = await request(app).get(`/publicaciones/${colabClinicaId}`);
    assert.deepEqual(detalle.body.diasSemana, [{ dia: 5, turno: "tarde" }]);
  });

  await t.test("el tipo contrario a quien publica se postula: un dentista se postula a la de la clínica", async () => {
    const res = await request(app)
      .post("/candidaturas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: colabClinicaId });
    assert.equal(res.status, 200);
  });

  await t.test("y una clínica se postula a la del dentista", async () => {
    const res = await request(app)
      .post("/candidaturas")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ publicacion_id: colabDentistaId });
    assert.equal(res.status, 200);
  });

  await t.test("la clínica ve la candidatura recibida en 'Postulaciones Recibidas' (candidatos interesados)", async () => {
    const res = await request(app)
      .get(`/stats/candidatos-interesados-lista/${clinica.usuario.id}`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.ok(res.body.some(c => c.publicacion_id === colabClinicaId && c.usuario_id === dentista.usuario.id));
  });

  await t.test("el dentista ve la candidatura recibida en su lista equivalente", async () => {
    const res = await request(app)
      .get(`/stats/postulaciones-recibidas-dentista-lista/${dentista.usuario.id}`)
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.ok(res.body.some(c => c.publicacion_id === colabDentistaId && c.usuario_id === clinica.usuario.id));
  });

  await t.test("la colaboración de la clínica cuenta en /publicaciones/usuario/:id/candidatos", async () => {
    const res = await request(app)
      .get(`/publicaciones/usuario/${clinica.usuario.id}/candidatos`)
      .set("Authorization", `Bearer ${clinica.token}`);
    const entrada = res.body.ofertas.find(o => o.publicacion_id === colabClinicaId);
    assert.ok(entrada);
    assert.equal(entrada.candidatos_count, 1);
  });

  await t.test("'Mis publicaciones' de la clínica incluye la colaboración junto a oferta/suplencia", async () => {
    await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Reus", descripcion: "Oferta de control" });
    const res = await request(app).get(`/publicaciones?usuario_id=${clinica.usuario.id}&sort=tipo&limit=100`);
    const tipos = new Set(res.body.map(p => p.tipo));
    assert.ok(tipos.has("oferta"));
    assert.ok(tipos.has("colaboracion"));
  });

  await t.test("filtrar el listado general por tipo=colaboracion devuelve las de ambos roles", async () => {
    const res = await request(app).get("/publicaciones?tipo=colaboracion");
    const ids = res.body.map(p => p.id);
    assert.ok(ids.includes(colabClinicaId));
    assert.ok(ids.includes(colabDentistaId));
  });
});
