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

// Captura lo que se "envía" por email (en modo consola, email.js hace console.log)
async function capturarConsola(fn) {
  const lineas = [];
  const original = console.log;
  console.log = (...args) => lineas.push(args.join(" "));
  try {
    await fn();
    // Da tiempo a que terminen las operaciones asíncronas encoladas tras responder
    await new Promise(resolve => setTimeout(resolve, 300));
  } finally {
    console.log = original;
  }
  return lineas.join("\n");
}

test("resumen semanal de coincidencias (matching proactivo)", async (t) => {
  process.env.ADMIN_TOKEN = "token-resumen-semanal";
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrarYLoguear(app, { nombre: "Clínica Resumen", email: "clinica-resumen@test.com", tipo: "clinica" });
  const dentista = await registrarYLoguear(app, { nombre: "Dentista Resumen", email: "dentista-resumen@test.com", tipo: "dentista" });
  const dentistaSinMatch = await registrarYLoguear(app, { nombre: "Dentista Sin Match", email: "dentista-sinmatch@test.com", tipo: "dentista" });

  await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "oferta", ciudad: "Manresa", descripcion: "Oferta para el resumen semanal" });

  await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${dentista.token}`)
    .send({ tipo: "solicitud", ciudad: "Manresa", descripcion: "Busco trabajo en Manresa" });

  // Este dentista publica en una ciudad sin ninguna oferta: no debería generar coincidencias
  await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${dentistaSinMatch.token}`)
    .send({ tipo: "solicitud", ciudad: "Ciudad Sin Ofertas", descripcion: "Busco trabajo" });

  await t.test("el endpoint exige el token de administración", async () => {
    const res = await request(app).post("/admin/enviar-resumen-semanal");
    assert.equal(res.status, 401);
  });

  await t.test("responde de inmediato y envía el resumen a quienes tienen coincidencias", async () => {
    const salida = await capturarConsola(async () => {
      const res = await request(app)
        .post("/admin/enviar-resumen-semanal")
        .set("X-Admin-Token", "token-resumen-semanal");
      assert.equal(res.status, 200);
    });

    assert.match(salida, /clinica-resumen@test\.com/);
    assert.match(salida, /dentista-resumen@test\.com/);
    assert.match(salida, /Resumen semanal de coincidencias/);
    // El dentista sin coincidencias no debe recibir nada
    assert.doesNotMatch(salida, /dentista-sinmatch@test\.com/);
  });

  await t.test("un usuario con recibir_emails desactivado no recibe el resumen", async () => {
    await request(app)
      .put("/auth/actualizar-perfil")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ nombre: "Dentista Resumen", recibir_emails: false });

    const salida = await capturarConsola(async () => {
      await request(app)
        .post("/admin/enviar-resumen-semanal")
        .set("X-Admin-Token", "token-resumen-semanal");
    });

    assert.doesNotMatch(salida, /dentista-resumen@test\.com/);
    // La clínica sigue recibiéndolo
    assert.match(salida, /clinica-resumen@test\.com/);
  });
});
