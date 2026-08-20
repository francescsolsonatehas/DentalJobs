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

test("páginas públicas de colaboración y hubs /empleo/...", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Endo", email: "clinica-endo@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Reus", email: "dentista-reus@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${dentista.token}`)
    .send({ nombre: "Dentista Reus", ciudad: "Reus" });

  const especialidades = await request(app).get("/especialidades");
  const endodoncia = especialidades.body.find(e => e.nombre === "Endodoncia").id;

  let colabClinicaId, colabDentistaId;

  await t.test("una colaboración de clínica es pública, con días de la semana y JobPosting", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({
        tipo: "colaboracion", ciudad: "Alcalá de Henares", especialidades: [endodoncia],
        diasSemana: [{ dia: 1, turno: "manana" }, { dia: 3, turno: "tarde" }],
        descripcion: "Buscamos endodoncista para colaborar",
      });
    colabClinicaId = res.body.id;

    const pagina = await request(app).get(`/oferta/${colabClinicaId}`);
    assert.equal(pagina.status, 200);
    assert.match(pagina.text, /Alcalá de Henares/);
    assert.match(pagina.text, /Lunes \(mañana\)/);
    assert.match(pagina.text, /Miércoles \(tarde\)/);

    const jsonLd = JSON.parse(pagina.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(jsonLd["@type"], "JobPosting");
    assert.deepEqual(jsonLd.employmentType, ["PER_DIEM"]);
  });

  await t.test("una colaboración de dentista NO es pública", async () => {
    const res = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ tipo: "colaboracion", diasSemana: [{ dia: 2, turno: "ambos" }], descripcion: "Disponible para colaborar" });
    colabDentistaId = res.body.id;

    const pagina = await request(app).get(`/oferta/${colabDentistaId}`);
    assert.equal(pagina.status, 404);
  });

  await t.test("/empleo/dentista lista la colaboración de clínica pero no la del dentista", async () => {
    const res = await request(app).get("/empleo/dentista");
    assert.equal(res.status, 200);
    assert.match(res.text, /Alcalá de Henares/);
    assert.doesNotMatch(res.text, /Reus/);
  });

  await t.test("/empleo/dentista/:ciudad filtra por slug de ciudad (sin acentos)", async () => {
    const res = await request(app).get("/empleo/dentista/alcala-de-henares");
    assert.equal(res.status, 200);
    assert.match(res.text, /Empleo para dentistas en Alcalá de Henares/);
    assert.match(res.text, new RegExp(`/oferta/${colabClinicaId}"`));
  });

  await t.test("/empleo/dentista/:ciudad sin coincidencias responde 200 con noindex", async () => {
    const res = await request(app).get("/empleo/dentista/almeria");
    assert.equal(res.status, 200);
    assert.match(res.text, /noindex/);
  });

  await t.test("/empleo/especialidad/:slug acepta el término profesional (endodoncista → Endodoncia)", async () => {
    const res = await request(app).get("/empleo/especialidad/endodoncista");
    assert.equal(res.status, 200);
    assert.match(res.text, new RegExp(`/oferta/${colabClinicaId}"`));
  });

  await t.test("/empleo/especialidad/:slug con un slug desconocido da 404", async () => {
    const res = await request(app).get("/empleo/especialidad/no-existe");
    assert.equal(res.status, 404);
  });

  await t.test("el sitemap incluye los hubs y la colaboración de clínica, no la del dentista", async () => {
    const res = await request(app).get("/sitemap.xml");
    assert.match(res.text, /\/empleo\/dentista<\/loc>/);
    assert.match(res.text, /\/empleo\/dentista\/alcala-de-henares<\/loc>/);
    assert.match(res.text, /\/empleo\/especialidad\/endodoncista<\/loc>/);
    assert.ok(res.text.includes(`/oferta/${colabClinicaId}</loc>`));
    assert.ok(!res.text.includes(`/oferta/${colabDentistaId}</loc>`));
  });
});
