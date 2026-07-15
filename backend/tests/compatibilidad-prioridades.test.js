const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");
const { calcularCompatibilidad } = require("../compatibilidad");

async function registrar(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo, aceptaTerminos: true });
  return { token: res.body.token, usuario: res.body.usuario };
}

// Dentista que pide 40.000 €, busca jornada completa y está certificado en
// Invisalign. Contra una oferta que se queda corta SOLO de salario (30.000 €, un
// 0,75) y es perfecta en jornada y tecnología. Es el caso donde la prioridad del
// dentista sobre "salario" cambia la nota sin cambiar nada más.
const PERFIL = {
  salario_pretendido: 40000,
  jornada_buscada: "Completa",
  certificaciones: ["Invisalign"]
};
const OFERTA = {
  tipo: "oferta",
  jornada: "Completa",
  salario_max: 30000,
  equipamiento: ["Escáner intraoral", "CAD-CAM"]
};

test("prioridades personales del dentista (unitario)", async (t) => {
  await t.test("sin prioridades, el resultado es el peso base de siempre", () => {
    const r = calcularCompatibilidad(PERFIL, OFERTA);
    // 0,75*3 + 1*3 + 1*2 = 7,25 sobre 8 → 90,6% → 91
    assert.equal(r.porcentaje, 91);
    assert.equal(r.dimensiones.find(d => d.clave === "salario").prioridad, "media");
  });

  await t.test("subir la prioridad de la dimensión que peor puntúa baja el %", () => {
    // salario ×2 (peso efectivo 6): 0,75*6 + 1*3 + 1*2 = 9,5 sobre 11 → 86,4% → 86
    const r = calcularCompatibilidad({ ...PERFIL, prioridades: { salario: "alta" } }, OFERTA);
    assert.equal(r.porcentaje, 86);
    assert.equal(r.dimensiones.find(d => d.clave === "salario").prioridad, "alta");
  });

  await t.test("bajar la prioridad de esa dimensión sube el %", () => {
    // salario ×0,5 (peso efectivo 1,5): 0,75*1,5 + 1*3 + 1*2 = 6,125 sobre 6,5 → 94,2% → 94
    const r = calcularCompatibilidad({ ...PERFIL, prioridades: { salario: "baja" } }, OFERTA);
    assert.equal(r.porcentaje, 94);
  });

  await t.test("las prioridades NO tocan la cobertura ni la suficiencia", () => {
    // La cobertura mide disponibilidad de datos, no lo que el dentista priorice:
    // se calcula siempre con los pesos base (aquí, las 3 derivadas = 8/19).
    const base = calcularCompatibilidad(PERFIL, OFERTA);
    const priorizado = calcularCompatibilidad({ ...PERFIL, prioridades: { salario: "alta", horarios: "baja" } }, OFERTA);
    assert.equal(priorizado.cobertura, base.cobertura);
    assert.equal(priorizado.cobertura, 8 / 19);
    assert.equal(priorizado.suficiente, base.suficiente);
  });

  await t.test("un nivel desconocido se trata como el neutro", () => {
    const r = calcularCompatibilidad({ ...PERFIL, prioridades: { salario: "carísimo" } }, OFERTA);
    assert.equal(r.porcentaje, 91); // igual que sin prioridades
    assert.equal(r.dimensiones.find(d => d.clave === "salario").prioridad, "media");
  });
});

test("endpoints de prioridades", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const dentista = await registrar(app, { nombre: "Dani Prio", email: "dani-prio@test.com", tipo: "dentista" });
  const clinica = await registrar(app, { nombre: "Clínica Prio", email: "clin-prio@test.com", tipo: "clinica" });
  const auth = { Authorization: `Bearer ${dentista.token}` };

  await t.test("de inicio no hay prioridades, pero sí el catálogo de dimensiones", async () => {
    const res = await request(app).get("/prioridades").set(auth);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.prioridades, {});
    assert.equal(res.body.dimensiones.length, 8);
    assert.deepEqual(res.body.niveles, ["alta", "media", "baja"]);
  });

  await t.test("guardar y releer solo conserva lo que se aparta del neutro", async () => {
    const put = await request(app).put("/prioridades").set(auth)
      .send({ prioridades: { salario: "alta", horarios: "media", tecnologia: "baja", inventada: "alta" } });
    assert.equal(put.status, 200);
    assert.equal(put.body.guardadas, 2); // "media" y la clave inventada se descartan

    const res = await request(app).get("/prioridades").set(auth);
    assert.deepEqual(res.body.prioridades, { salario: "alta", tecnologia: "baja" });
  });

  await t.test("guardar es una foto final: reemplaza lo anterior", async () => {
    await request(app).put("/prioridades").set(auth).send({ prioridades: { ambiente: "alta" } });
    const res = await request(app).get("/prioridades").set(auth);
    assert.deepEqual(res.body.prioridades, { ambiente: "alta" });
  });

  await t.test("una clínica no prioriza dimensiones", async () => {
    const res = await request(app).get("/prioridades").set({ Authorization: `Bearer ${clinica.token}` });
    assert.equal(res.status, 403);
  });

  await t.test("sin sesión no se puede", async () => {
    const res = await request(app).get("/prioridades");
    assert.equal(res.status, 401);
  });
});

test("orden del listado por compatibilidad", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Orden", email: "clin-orden@test.com", tipo: "clinica" });
  const dentista = await registrar(app, { nombre: "Dani Orden", email: "dani-orden@test.com", tipo: "dentista" });
  const clinAuth = { Authorization: `Bearer ${clinica.token}` };
  const denAuth = { Authorization: `Bearer ${dentista.token}` };

  // El dentista dice lo que busca y lo que sabe hacer
  await request(app).post("/publicaciones").set(denAuth).send({
    tipo: "solicitud", ciudad: "Valencia", descripcion: "Busco", jornada: "Completa", salarioDesde: 40000,
    nombre_contacto: "Dani", email_contacto: "dani-orden@test.com"
  });
  await request(app).post("/auth/guardar-certificaciones").set(denAuth).send({ certificaciones: ["Invisalign"] });

  // Oferta floja: se queda corta de salario y de jornada (≈25%)
  const floja = await request(app).post("/publicaciones").set(clinAuth).send({
    tipo: "oferta", ciudad: "Valencia", descripcion: "Floja", jornada: "Parcial", salarioDesde: 20000, salarioHasta: 20000,
    nombre_contacto: "Clínica", email_contacto: "clin-orden@test.com"
  });
  // Oferta buena: llega al salario, misma jornada y el equipamiento que aprovecha (100%)
  const buena = await request(app).post("/publicaciones").set(clinAuth).send({
    tipo: "oferta", ciudad: "Valencia", descripcion: "Buena", jornada: "Completa", salarioDesde: 42000, salarioHasta: 45000,
    equipamiento: ["Escáner intraoral", "CAD-CAM"],
    nombre_contacto: "Clínica", email_contacto: "clin-orden@test.com"
  });

  await t.test("un dentista con sesión ve las ofertas ordenadas por su % y anotadas", async () => {
    const res = await request(app).get("/publicaciones?tipo=oferta&sort=compatibilidad").set(denAuth);
    assert.equal(res.status, 200);
    const ids = res.body.map(p => p.id);
    assert.deepEqual(ids, [buena.body.id, floja.body.id]);
    assert.equal(res.body[0].compat_porcentaje, 100);
    assert.ok(res.body[1].compat_porcentaje < 50);
  });

  await t.test("sin sesión, el orden por compatibilidad se ignora (no rompe)", async () => {
    const res = await request(app).get("/publicaciones?tipo=oferta&sort=compatibilidad");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
    assert.equal(res.body[0].compat_porcentaje, undefined);
  });
});
