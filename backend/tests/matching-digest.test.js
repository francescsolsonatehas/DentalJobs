const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");

// Día en formato 'YYYY-MM-DD' desplazado `n` días desde hoy (para no depender de
// fechas fijas: el digest filtra por sd.fecha >= date('now')).
function diaRelativo(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function registrar(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo, aceptaTerminos: true });
  return { token: res.body.token, usuario: res.body.usuario };
}

test("digest diario de matching de suplencias", async (t) => {
  process.env.ADMIN_TOKEN = "token-de-prueba-admin";
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const D10 = diaRelativo(10), D20 = diaRelativo(20), D30 = diaRelativo(30), PASADO = diaRelativo(-5);

  const clinica = await registrar(app, { nombre: "Clínica Digest", email: "clinica-digest@test.com", tipo: "clinica" });

  // Suplencia futura en Valencia (sin especialidad exigida), días D10 y D20
  const sup = await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "suplencia", ciudad: "Valencia", descripcion: "Futura", dias: [D10, D20] });

  // Suplencia solo en un día pasado
  const supPasada = await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "suplencia", ciudad: "Valencia", descripcion: "Pasada", dias: [PASADO] });

  // Dentista que casa: Valencia, disponible D20 y D30 (D20 solapa con la futura)
  const den = await registrar(app, { nombre: "Dentista Digest", email: "dentista-digest@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${den.token}`).send({ nombre: "Dentista Digest", ciudad: "Valencia" });
  await request(app).put("/disponibilidad").set("Authorization", `Bearer ${den.token}`).send({ dias: [D20, D30, PASADO] });

  // Dentista de otra ciudad, disponible D20 → NO casa
  const lejos = await registrar(app, { nombre: "Dentista Lejos", email: "dentista-lejos@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${lejos.token}`).send({ nombre: "Dentista Lejos", ciudad: "Sevilla" });
  await request(app).put("/disponibilidad").set("Authorization", `Bearer ${lejos.token}`).send({ dias: [D20] });

  await t.test("exige el token de admin", async () => {
    const r = await request(app).post("/admin/matching-suplencias");
    assert.equal(r.status, 401);
  });

  await t.test("primer paso: avisa al dentista que casa (una vez), ignora ciudad distinta y días pasados", async () => {
    const r = await request(app).post("/admin/matching-suplencias").set("X-Admin-Token", "token-de-prueba-admin");
    assert.equal(r.status, 200);
    // Solo 1 dentista avisado, 1 aviso (la suplencia futura; la pasada no cuenta)
    assert.equal(r.body.dentistasAvisados, 1);
    assert.equal(r.body.avisos, 1);
  });

  await t.test("segundo paso: dedup, no se repite el aviso", async () => {
    const r = await request(app).post("/admin/matching-suplencias").set("X-Admin-Token", "token-de-prueba-admin");
    assert.equal(r.body.dentistasAvisados, 0);
    assert.equal(r.body.avisos, 0);
  });

  await t.test("una suplencia nueva sí genera un aviso nuevo", async () => {
    await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "suplencia", ciudad: "Valencia", descripcion: "Otra futura", dias: [D30] });
    const r = await request(app).post("/admin/matching-suplencias").set("X-Admin-Token", "token-de-prueba-admin");
    assert.equal(r.body.avisos, 1);
  });
});
