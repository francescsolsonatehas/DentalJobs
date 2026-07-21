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

test("trayectoria profesional (experiencia, formación, idiomas)", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const dentista = await registrarYLoguear(app, { nombre: "Dentista Trayectoria", email: "dentista-trayectoria@test.com", tipo: "dentista" });
  const intruso = await registrarYLoguear(app, { nombre: "Intruso", email: "intruso-trayectoria@test.com", tipo: "dentista" });

  let experienciaId, formacionId, idiomaId;

  await t.test("se puede añadir experiencia laboral con su especialidad", async () => {
    const res = await request(app)
      .post("/experiencia-laboral")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ especialidad: "Ortodoncia", lugar: "Clínica X", fecha_inicio: "2020-01", fecha_fin: "2022-06" });
    assert.equal(res.status, 200);
    experienciaId = res.body.id;
  });

  await t.test("la especialidad es obligatoria (ocupa el lugar del antiguo puesto)", async () => {
    const res = await request(app)
      .post("/experiencia-laboral")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ lugar: "Sin especialidad" });
    assert.equal(res.status, 400);
  });

  await t.test("se puede añadir formación e idiomas", async () => {
    const f = await request(app)
      .post("/formacion")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ titulo: "Grado en Odontología", centro: "Universidad de Barcelona", anyo: "2018" });
    assert.equal(f.status, 200);
    formacionId = f.body.id;

    const i = await request(app)
      .post("/idiomas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ idioma: "Inglés", nivel: "Avanzado" });
    assert.equal(i.status, 200);
    idiomaId = i.body.id;
  });

  await t.test("la trayectoria pública incluye experiencia, formación e idiomas", async () => {
    const res = await request(app).get(`/usuarios/${dentista.usuario.id}/trayectoria`);
    assert.equal(res.status, 200);
    assert.equal(res.body.experiencia.length, 1);
    assert.equal(res.body.experiencia[0].especialidad, "Ortodoncia");
    assert.equal(res.body.formacion.length, 1);
    assert.equal(res.body.idiomas.length, 1);
    assert.equal(res.body.idiomas[0].nivel, "Avanzado");
  });

  await t.test("un tercero no puede editar ni borrar experiencia ajena", async () => {
    const editar = await request(app)
      .put(`/experiencia-laboral/${experienciaId}`)
      .set("Authorization", `Bearer ${intruso.token}`)
      .send({ especialidad: "Endodoncia" });
    assert.equal(editar.status, 403);

    const borrar = await request(app)
      .delete(`/experiencia-laboral/${experienciaId}`)
      .set("Authorization", `Bearer ${intruso.token}`);
    assert.equal(borrar.status, 403);
  });

  await t.test("el dueño puede editar su experiencia", async () => {
    const res = await request(app)
      .put(`/experiencia-laboral/${experienciaId}`)
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ especialidad: "Periodoncia", actual: true });
    assert.equal(res.status, 200);

    const trayectoria = await request(app).get(`/usuarios/${dentista.usuario.id}/trayectoria`);
    assert.equal(trayectoria.body.experiencia[0].especialidad, "Periodoncia");
    assert.equal(trayectoria.body.experiencia[0].actual, 1);
    assert.equal(trayectoria.body.experiencia[0].fecha_fin, null);
  });

  await t.test("el dueño puede borrar formación e idiomas", async () => {
    const f = await request(app)
      .delete(`/formacion/${formacionId}`)
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(f.status, 200);

    const i = await request(app)
      .delete(`/idiomas/${idiomaId}`)
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(i.status, 200);

    const trayectoria = await request(app).get(`/usuarios/${dentista.usuario.id}/trayectoria`);
    assert.equal(trayectoria.body.formacion.length, 0);
    assert.equal(trayectoria.body.idiomas.length, 0);
  });

  await t.test("el CV en PDF se genera correctamente con trayectoria (o sin ella)", async () => {
    const res = await request(app)
      .get("/auth/mi-cv.pdf")
      .set("Authorization", `Bearer ${dentista.token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.slice(0, 5).toString(), "%PDF-");
  });

  await t.test("el borrado de cuenta también elimina la trayectoria", async () => {
    await request(app)
      .post("/experiencia-laboral")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ puesto: "Otro puesto" });

    const del = await request(app)
      .delete("/auth/mi-cuenta")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ password: "secreto123" });
    assert.equal(del.status, 200);

    const trayectoria = await request(app).get(`/usuarios/${dentista.usuario.id}/trayectoria`);
    assert.equal(trayectoria.body.experiencia.length, 0);
  });
});
