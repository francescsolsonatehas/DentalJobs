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

test("condiciones específicas del sector: retribución, equipamiento y certificaciones", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Condiciones", email: "clinica-condiciones@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Condiciones", email: "dentista-condiciones@test.com", tipo: "dentista" });

  await t.test("el catálogo de equipamiento y certificaciones está disponible públicamente", async () => {
    const res = await request(app).get("/catalogos");
    assert.equal(res.status, 200);
    assert.ok(res.body.equipamiento.includes("CBCT / TAC 3D"));
    assert.ok(res.body.certificaciones.includes("Invisalign"));
  });

  let ofertaPorcentajeId, ofertaFijaId;

  await t.test("una oferta puede pagarse por % de facturación con equipamiento asociado", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({
        tipo: "oferta", ciudad: "Lleida", descripcion: "Oferta con retribución variable",
        retribucionTipo: "porcentaje", retribucionPorcentaje: 40,
        equipamiento: ["CBCT / TAC 3D", "Microscopio", "Equipo inventado"]
      });
    assert.equal(res.status, 200);
    ofertaPorcentajeId = res.body.id;

    const pub = await request(app).get(`/publicaciones/${ofertaPorcentajeId}`);
    assert.equal(pub.body.retribucion_tipo, "porcentaje");
    assert.equal(pub.body.retribucion_porcentaje, 40);

    const equipo = await request(app).get(`/publicaciones/${ofertaPorcentajeId}/equipamiento`);
    // El valor inventado (fuera de catálogo) debe filtrarse silenciosamente
    assert.deepEqual(equipo.body.equipamiento.sort(), ["CBCT / TAC 3D", "Microscopio"].sort());
  });

  await t.test("por defecto la retribución es fija", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "oferta", ciudad: "Lleida", descripcion: "Oferta con salario normal", salarioDesde: 2200 });
    ofertaFijaId = res.body.id;

    const pub = await request(app).get(`/publicaciones/${ofertaFijaId}`);
    assert.equal(pub.body.retribucion_tipo, "fijo");
    assert.equal(pub.body.retribucion_porcentaje, null);
  });

  await t.test("filtro por equipamiento devuelve solo las publicaciones con ese equipo", async () => {
    const res = await request(app).get("/publicaciones?tipo=oferta&equipamiento=" + encodeURIComponent("CBCT / TAC 3D"));
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].id, ofertaPorcentajeId);
  });

  await t.test("filtro por retribucion=porcentaje / fijo", async () => {
    const porcentaje = await request(app).get("/publicaciones?tipo=oferta&retribucion=porcentaje");
    assert.equal(porcentaje.body.length, 1);
    assert.equal(porcentaje.body[0].id, ofertaPorcentajeId);

    const fijo = await request(app).get("/publicaciones?tipo=oferta&retribucion=fijo");
    assert.equal(fijo.body.length, 1);
    assert.equal(fijo.body[0].id, ofertaFijaId);
  });

  await t.test("un dentista no puede añadir equipamiento a una solicitud (se ignora)", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ tipo: "solicitud", ciudad: "Lleida", descripcion: "Busco trabajo", equipamiento: ["CBCT / TAC 3D"] });
    assert.equal(res.status, 200);

    const equipo = await request(app).get(`/publicaciones/${res.body.id}/equipamiento`);
    assert.equal(equipo.body.equipamiento.length, 0);
  });

  await t.test("un dentista puede añadir certificaciones válidas a su perfil", async () => {
    const res = await request(app)
      .post("/auth/guardar-certificaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ certificaciones: ["Invisalign", "Implantología avanzada", "Certificación inventada"] });
    assert.equal(res.status, 200);

    const mias = await request(app)
      .get("/auth/mis-certificaciones")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.deepEqual(mias.body.certificaciones.sort(), ["Implantología avanzada", "Invisalign"].sort());
  });

  await t.test("la trayectoria pública incluye las certificaciones", async () => {
    const res = await request(app).get(`/usuarios/${dentista.usuario.id}/trayectoria`);
    assert.ok(res.body.certificaciones.includes("Invisalign"));
  });

  await t.test("filtrar solicitudes por certificación del dentista que las publicó", async () => {
    await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ tipo: "solicitud", ciudad: "Girona", descripcion: "Busco trabajo con Invisalign" });

    const res = await request(app).get("/publicaciones?tipo=solicitud&certificacion=" + encodeURIComponent("Invisalign"));
    assert.ok(res.body.length >= 1);
    assert.ok(res.body.every(p => p.usuario_id === dentista.usuario.id));
  });

  await t.test("guardar certificaciones reemplaza la lista anterior por completo", async () => {
    await request(app)
      .post("/auth/guardar-certificaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ certificaciones: ["Ortodoncia lingual"] });

    const mias = await request(app)
      .get("/auth/mis-certificaciones")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.deepEqual(mias.body.certificaciones, ["Ortodoncia lingual"]);
  });

  await t.test("borrar la cuenta también elimina las certificaciones", async () => {
    await request(app)
      .delete("/auth/mi-cuenta")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ password: "secreto123" });

    const trayectoria = await request(app).get(`/usuarios/${dentista.usuario.id}/trayectoria`);
    assert.equal(trayectoria.body.certificaciones.length, 0);
  });
});
