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

async function fijarCiudad(app, usuario, ciudad, extra = {}) {
  await request(app)
    .put("/auth/actualizar-perfil")
    .set("Authorization", `Bearer ${usuario.token}`)
    .send({ nombre: usuario.usuario.nombre, ciudad, ...extra });
}

test("directorio para elegir con quién empezar un xat", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  // Yo: dentista en Barcelona. Candidatos: clínicas en Badalona (~10 km) y
  // Girona (~85 km), más una tercera sin ciudad (queda al final, sin distancia).
  const yo = await registrar(app, { nombre: "Yo Mismo", email: "yo-directorio@test.com", tipo: "dentista" });
  await fijarCiudad(app, yo, "Barcelona");

  const clinicaZeta = await registrar(app, { nombre: "Clínica Zeta Badalona", email: "clinica-zeta@test.com", tipo: "clinica" });
  await fijarCiudad(app, clinicaZeta, "Badalona");
  const clinicaAlfa = await registrar(app, { nombre: "Clínica Alfa Badalona", email: "clinica-alfa@test.com", tipo: "clinica" });
  await fijarCiudad(app, clinicaAlfa, "Badalona");
  const clinicaGirona = await registrar(app, { nombre: "Clínica Girona", email: "clinica-girona@test.com", tipo: "clinica" });
  await fijarCiudad(app, clinicaGirona, "Girona");
  const clinicaSinCiudad = await registrar(app, { nombre: "Clínica Sin Ciudad", email: "clinica-sinciudad@test.com", tipo: "clinica" });

  const otroDentista = await registrar(app, { nombre: "Otro Dentista", email: "otro-dentista-directorio@test.com", tipo: "dentista" });
  await fijarCiudad(app, otroDentista, "Barcelona");

  await t.test("exige sesión", async () => {
    const res = await request(app).get("/chat/directorio?tipo=clinica");
    assert.equal(res.status, 401);
  });

  await t.test("ordena por cercanía y, a igualdad, por el último apellido del nombre", async () => {
    const res = await request(app)
      .get("/chat/directorio?tipo=clinica")
      .set("Authorization", `Bearer ${yo.token}`);
    assert.equal(res.status, 200);

    const nombres = res.body.perfiles.map(p => p.nombre);
    // Badalona (las dos, por apellido "Badalona" empatado -> alfabético entre "Alfa" y
    // "Zeta" no aplica: el desempate es por la ÚLTIMA palabra del nombre, que aquí es
    // "Badalona" en ambas, así que el orden entre ellas no está garantizado por nombre;
    // lo que sí es determinista es que las dos van antes que Girona, y Girona antes que
    // la que no tiene ciudad.
    assert.deepEqual(nombres.slice(0, 2).sort(), ["Clínica Alfa Badalona", "Clínica Zeta Badalona"]);
    assert.equal(nombres[2], "Clínica Girona");
    assert.equal(nombres[3], "Clínica Sin Ciudad");
  });

  await t.test("no incluye al propio usuario ni a otros tipos", async () => {
    const res = await request(app)
      .get("/chat/directorio?tipo=clinica")
      .set("Authorization", `Bearer ${yo.token}`);
    const ids = res.body.perfiles.map(p => p.id);
    assert.ok(!ids.includes(yo.usuario.id));
    assert.ok(!ids.includes(otroDentista.usuario.id));
  });

  await t.test("tipo=dentista devuelve dentistas, no clínicas", async () => {
    const res = await request(app)
      .get("/chat/directorio?tipo=dentista")
      .set("Authorization", `Bearer ${clinicaZeta.token}`);
    const nombres = res.body.perfiles.map(p => p.nombre).sort();
    assert.deepEqual(nombres, ["Otro Dentista", "Yo Mismo"]);
  });

  await t.test("un dentista con perfil oculto no aparece en el directorio", async () => {
    await request(app)
      .put("/auth/actualizar-perfil")
      .set("Authorization", `Bearer ${otroDentista.token}`)
      .send({ nombre: otroDentista.usuario.nombre, ciudad: "Barcelona", perfil_publico: false });

    const res = await request(app)
      .get("/chat/directorio?tipo=dentista")
      .set("Authorization", `Bearer ${clinicaZeta.token}`);
    const nombres = res.body.perfiles.map(p => p.nombre);
    assert.deepEqual(nombres, ["Yo Mismo"]);
  });
});
