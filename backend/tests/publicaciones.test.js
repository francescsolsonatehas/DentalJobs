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

test("publicaciones", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Test", email: "clinica@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Test", email: "dentista@test.com", tipo: "dentista" });

  await t.test("una clínica no puede crear una 'solicitud'", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "solicitud", ciudad: "Lleida", descripcion: "x" });

    assert.equal(res.status, 403);
  });

  await t.test("un dentista no puede crear una 'oferta'", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ tipo: "oferta", ciudad: "Lleida", descripcion: "x" });

    assert.equal(res.status, 403);
  });

  await t.test("GET /publicaciones excluye las publicaciones borradas (activo=0)", async () => {
    const crear = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Lleida", descripcion: "Oferta de prueba" });

    const pubId = crear.body.id;

    let listado = await request(app).get("/publicaciones");
    assert.ok(listado.body.some((p) => p.id === pubId));

    await request(app)
      .delete(`/publicaciones/${pubId}`)
      .set("Authorization", `Bearer ${clinica.token}`);

    listado = await request(app).get("/publicaciones");
    assert.ok(!listado.body.some((p) => p.id === pubId));
  });

  await t.test("al borrar una publicación, las candidaturas asociadas quedan 'retirada'", async () => {
    const crear = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Lleida", descripcion: "Oferta con candidato" });

    const pubId = crear.body.id;

    await request(app)
      .post("/candidaturas")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ publicacion_id: pubId });

    await request(app)
      .delete(`/publicaciones/${pubId}`)
      .set("Authorization", `Bearer ${clinica.token}`);

    // /publicaciones/:id/candidatos no filtra por publicación activa, así que
    // expone el estado real de la candidatura tras el borrado.
    const candidatos = await request(app)
      .get(`/publicaciones/${pubId}/candidatos`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(candidatos.body.candidatos[0].estado, "retirada");

    // Y por tanto tampoco debe aparecer como postulación activa del dentista
    const misPostulaciones = await request(app)
      .get("/candidaturas/mis-postulaciones")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.ok(!misPostulaciones.body.candidaturas.some((c) => c.publicacion_id === pubId));
  });

  await t.test("GET /publicaciones respeta el límite de paginación", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/publicaciones")
        .set("Authorization", `Bearer ${clinica.token}`)
        .send({ tipo: "oferta", ciudad: `Ciudad${i}`, descripcion: "x" });
    }

    const res = await request(app).get("/publicaciones?limit=2&page=1");
    assert.equal(res.status, 200);
    assert.ok(res.body.length <= 2);
  });

  await t.test("filtro por contrato solo devuelve publicaciones con ese contrato", async () => {
    await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "FiltroContrato", descripcion: "x", contrato: "Temporal" });
    await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "FiltroContrato", descripcion: "x", contrato: "Indefinido" });

    const res = await request(app).get("/publicaciones?ciudad=FiltroContrato&contrato=Temporal");
    assert.equal(res.status, 200);
    assert.ok(res.body.length >= 1);
    assert.ok(res.body.every((p) => p.contrato === "Temporal"));
  });

  await t.test("filtro por jornada solo devuelve publicaciones con esa jornada", async () => {
    await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "FiltroJornada", descripcion: "x", jornada: "Parcial" });
    await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "FiltroJornada", descripcion: "x", jornada: "Completa" });

    const res = await request(app).get("/publicaciones?ciudad=FiltroJornada&jornada=Parcial");
    assert.equal(res.status, 200);
    assert.ok(res.body.length >= 1);
    assert.ok(res.body.every((p) => p.jornada === "Parcial"));
  });

  await t.test("salario_min se calcula a partir del texto del salario", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "TestSalario", descripcion: "x", salario: "30000-35000€" });

    const listado = await request(app).get("/publicaciones?ciudad=TestSalario");
    const pub = listado.body.find((p) => p.id === res.body.id);
    assert.equal(pub.salario_min, 30000);
  });

  await t.test("filtro salarioMin excluye publicaciones por debajo del mínimo", async () => {
    await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "TestSalarioMin", descripcion: "x", salario: "40000" });

    const conFiltroAlto = await request(app).get("/publicaciones?ciudad=TestSalarioMin&salarioMin=45000");
    assert.equal(conFiltroAlto.body.length, 0);

    const conFiltroBajo = await request(app).get("/publicaciones?ciudad=TestSalarioMin&salarioMin=35000");
    assert.equal(conFiltroBajo.body.length, 1);
  });

  await t.test("experiencia_minima se guarda y sort=salario ordena descendente", async () => {
    await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "TestOrden", descripcion: "x", salario: "20000", experiencia: 2 });
    await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "TestOrden", descripcion: "x", salario: "50000", experiencia: 4 });

    const res = await request(app).get("/publicaciones?ciudad=TestOrden&sort=salario");
    assert.equal(res.body[0].salario_min, 50000);
    assert.equal(res.body[0].experiencia_minima, 4);
  });

  await t.test("una solicitud hereda ciudad y provincia del perfil del dentista (ignora la del cuerpo)", async () => {
    // El dentista fija su ciudad/provincia en el perfil
    await request(app)
      .put("/auth/actualizar-perfil")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ nombre: "Dentista Test", ciudad: "Girona", provincia: "Girona" });

    // Publica una solicitud enviando OTRA ciudad en el cuerpo: debe ignorarse
    const crear = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ tipo: "solicitud", ciudad: "OtraCiudadIgnorada", descripcion: "Busco trabajo" });
    assert.equal(crear.status, 200);

    const listado = await request(app).get("/publicaciones?tipo=solicitud&ciudad=Girona");
    const pub = listado.body.find((p) => p.id === crear.body.id);
    assert.ok(pub, "la solicitud debería listarse por la ciudad del perfil");
    assert.equal(pub.ciudad, "Girona");
    assert.equal(pub.provincia, "Girona");
  });

  await t.test("una oferta con sede hereda ciudad, provincia, teléfono, empresa y equipamiento de la sede/perfil", async () => {
    const sede = await request(app)
      .post("/sedes")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ nombre: "Sede Centro", ciudad: "Tarragona", provincia: "Tarragona", telefono: "977000000", equipamiento: ["Microscopio", "CAD-CAM"] });
    const sedeId = sede.body.id;

    // Publica una oferta con sede, enviando en el cuerpo datos que deben ignorarse
    const crear = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", sede_id: sedeId, ciudad: "CiudadIgnorada", descripcion: "Oferta con sede", nombre_contacto: "IgnoradoContacto", equipamiento: ["Láser dental"] });
    assert.equal(crear.status, 200);

    const listado = await request(app).get("/publicaciones?tipo=oferta&ciudad=Tarragona");
    const pub = listado.body.find((p) => p.id === crear.body.id);
    assert.ok(pub, "la oferta debería listarse por la ciudad de la sede");
    assert.equal(pub.ciudad, "Tarragona");
    assert.equal(pub.provincia, "Tarragona");
    assert.equal(pub.nombre_contacto, "Clínica Test"); // del perfil, no del cuerpo
    assert.equal(pub.telefono_contacto, "977000000");  // de la sede

    // El equipamiento de la publicación es el de la sede, no el enviado en el cuerpo
    const porSede = await request(app).get("/publicaciones?tipo=oferta&ciudad=Tarragona&equipamiento=Microscopio");
    assert.ok(porSede.body.some((p) => p.id === crear.body.id), "debería encontrarse por el equipamiento de la sede");
    const porCuerpo = await request(app).get(`/publicaciones?tipo=oferta&ciudad=Tarragona&equipamiento=${encodeURIComponent("Láser dental")}`);
    assert.ok(!porCuerpo.body.some((p) => p.id === crear.body.id), "no debería tener el equipamiento enviado en el cuerpo");
  });
});
