const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");

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

// El aviso instantáneo (solo urgentes) registra el dedup en el momento de crear la
// suplencia, así que el digest diario ya no vuelve a avisar de ella; una suplencia
// no urgente, en cambio, queda para el digest.
test("aviso instantáneo de suplencias urgentes (M2)", async (t) => {
  process.env.ADMIN_TOKEN = "token-de-prueba-admin";
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const D10 = diaRelativo(10), D20 = diaRelativo(20);

  const clinica = await registrar(app, { nombre: "Clínica Inst", email: "clinica-inst@test.com", tipo: "clinica" });

  // Dentista que casa: Valencia, disponible D10 y D20
  const den = await registrar(app, { nombre: "Dentista Inst", email: "dentista-inst@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${den.token}`).send({ nombre: "Dentista Inst", ciudad: "Valencia" });
  await request(app).put("/disponibilidad").set("Authorization", `Bearer ${den.token}`).send({ dias: [D10, D20] });

  await t.test("una suplencia URGENTE que casa se avisa al instante y el digest ya no la repite", async () => {
    const sup = await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "suplencia", ciudad: "Valencia", descripcion: "Urgente", urgente: true, dias: [D10] });
    assert.equal(sup.status, 200);

    // El digest no debe encontrar nada nuevo: ya se avisó al crearla
    const digest = await request(app).post("/admin/matching-suplencias").set("X-Admin-Token", "token-de-prueba-admin");
    assert.equal(digest.body.avisos, 0);
  });

  await t.test("una suplencia NO urgente que casa la coge el digest (no hubo aviso instantáneo)", async () => {
    await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "suplencia", ciudad: "Valencia", descripcion: "Normal", urgente: false, dias: [D20] });

    const digest = await request(app).post("/admin/matching-suplencias").set("X-Admin-Token", "token-de-prueba-admin");
    assert.equal(digest.body.avisos, 1);
    assert.equal(digest.body.dentistasAvisados, 1);
  });

  await t.test("una suplencia urgente sin dentistas que casen no falla y responde 200", async () => {
    const sup = await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
      .send({ tipo: "suplencia", ciudad: "Bilbao", descripcion: "Urgente lejos", urgente: true, dias: [D10] });
    assert.equal(sup.status, 200);
  });
});
