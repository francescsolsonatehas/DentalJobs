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

// Un dentista con las tres dimensiones cubiertas: pide 40.000 €, busca jornada
// completa, está disponible dos días y está certificado en Invisalign.
const PERFIL_COMPLETO = {
  salario_pretendido: 40000,
  jornada_buscada: "Completa",
  disponibilidad: ["2026-09-01", "2026-09-02"],
  certificaciones: ["Invisalign"]
};

test("motor de compatibilidad (unitario)", async (t) => {
  // Estos tests aíslan las tres dimensiones DERIVADAS (salario, horarios,
  // tecnología). Las cinco del cuestionario no se responden aquí, así que salen
  // como "sin datos" y no entran en el cálculo; se prueban en
  // compatibilidad-cuestionario.test.js.
  const DERIVADAS = ["salario", "horarios", "tecnologia"];
  const soloDerivadas = r => r.dimensiones.filter(d => DERIVADAS.includes(d.clave));

  await t.test("coincidencia total en las tres dimensiones derivadas da 100%", () => {
    const r = calcularCompatibilidad(PERFIL_COMPLETO, {
      tipo: "oferta",
      jornada: "Completa",
      salario_min: 40000,
      salario_max: 45000,
      equipamiento: ["Escáner intraoral", "CAD-CAM"]
    });
    assert.equal(r.porcentaje, 100);
    assert.equal(r.suficiente, true);
    assert.equal(r.cobertura, 8 / 19); // las 3 derivadas, de los 19 de peso total
    assert.ok(soloDerivadas(r).every(d => d.estado === "coincide"));
  });

  await t.test("un salario por debajo de lo pretendido baja la puntuación en proporción", () => {
    const r = calcularCompatibilidad(PERFIL_COMPLETO, {
      tipo: "oferta",
      jornada: "Completa",
      salario_max: 30000, // 75% de los 40.000 que pide
      equipamiento: ["Escáner intraoral", "CAD-CAM"]
    });
    const salario = r.dimensiones.find(d => d.clave === "salario");
    assert.equal(salario.puntuacion, 0.75);
    assert.equal(salario.estado, "parcial");
    // Las otras dos dimensiones son perfectas: (0.75*3 + 1*3 + 1*2) / 8 = 90,6%
    assert.equal(r.porcentaje, 91);
  });

  await t.test("quedarse corto de salario nunca es 'coincide', aunque puntúe alto", () => {
    // 36.000 de los 40.000 que pide es un 0,9: alto, pero NO llega a lo que busca.
    // Un ✅ aquí contradiría el propio detalle ("por debajo de lo que buscas").
    const r = calcularCompatibilidad(PERFIL_COMPLETO, {
      tipo: "oferta",
      jornada: "Completa",
      salario_max: 36000,
      equipamiento: ["Escáner intraoral", "CAD-CAM"]
    });
    const salario = r.dimensiones.find(d => d.clave === "salario");
    assert.equal(salario.puntuacion, 0.9);
    assert.equal(salario.estado, "parcial");
  });

  await t.test("en suplencias, los horarios miden el solape de días con el calendario", () => {
    const r = calcularCompatibilidad(PERFIL_COMPLETO, {
      tipo: "suplencia",
      salario_min: 40000,
      dias: ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"],
      equipamiento: ["Escáner intraoral", "CAD-CAM"]
    });
    const horarios = r.dimensiones.find(d => d.clave === "horarios");
    assert.equal(horarios.puntuacion, 0.5); // disponible 2 de los 4 días
    assert.deepEqual(horarios.dias_coincidentes, ["2026-09-01", "2026-09-02"]);
  });

  await t.test("la tecnología puntúa solo el equipamiento que aprovechan tus certificaciones", () => {
    const r = calcularCompatibilidad(PERFIL_COMPLETO, {
      tipo: "oferta",
      jornada: "Completa",
      salario_min: 40000,
      // Invisalign aprovecha Escáner intraoral + CAD-CAM: la clínica solo tiene uno.
      // El microscopio no suma: no le sirve a este dentista.
      equipamiento: ["Escáner intraoral", "Microscopio"]
    });
    const tecnologia = r.dimensiones.find(d => d.clave === "tecnologia");
    assert.equal(tecnologia.puntuacion, 0.5);
    assert.deepEqual(tecnologia.equipos_coincidentes, ["Escáner intraoral"]);
  });

  await t.test("una dimensión sin datos no suma ni resta: sale del denominador", () => {
    const r = calcularCompatibilidad(
      { ...PERFIL_COMPLETO, certificaciones: [] }, // sin certificaciones → tecnología sin datos
      { tipo: "oferta", jornada: "Completa", salario_min: 40000, equipamiento: ["CBCT / TAC 3D"] }
    );
    const tecnologia = r.dimensiones.find(d => d.clave === "tecnologia");
    assert.equal(tecnologia.estado, "sin_datos");
    assert.equal(tecnologia.falta, "dentista"); // el dato que falta es del dentista
    // Salario y horarios son perfectos, y la tecnología no arrastra el resultado
    assert.equal(r.porcentaje, 100);
    assert.equal(r.cobertura, 6 / 19); // salario (3) + horarios (3) de los 19 de peso total
  });

  await t.test("sin cobertura suficiente NO se devuelve porcentaje", () => {
    // Perfil vacío: solo se puede evaluar la tecnología (2 de los 19 de peso)
    const r = calcularCompatibilidad(
      { certificaciones: ["Invisalign"] },
      { tipo: "oferta", jornada: "Completa", salario_min: 40000, equipamiento: ["Escáner intraoral", "CAD-CAM"] }
    );
    assert.equal(r.porcentaje, null);
    assert.equal(r.suficiente, false);
    assert.equal(r.cobertura, 2 / 19);
    // Y se dice de quién es el dato que falta, para poder pedírselo
    assert.equal(r.dimensiones.find(d => d.clave === "salario").falta, "dentista");
  });

  await t.test("un porcentaje de facturación no se compara con un salario fijo", () => {
    const r = calcularCompatibilidad(PERFIL_COMPLETO, {
      tipo: "oferta",
      jornada: "Completa",
      retribucion_tipo: "porcentaje",
      retribucion_porcentaje: 40,
      equipamiento: ["Escáner intraoral", "CAD-CAM"]
    });
    const salario = r.dimensiones.find(d => d.clave === "salario");
    assert.equal(salario.estado, "sin_datos");
    assert.equal(salario.falta, "clinica");
  });
});

test("endpoint de compatibilidad", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Compat", email: "clinica-compat@test.com", tipo: "clinica" });
  const dentista = await registrar(app, { nombre: "Dani Compat", email: "dentista-compat@test.com", tipo: "dentista" });

  // La clínica publica una oferta: jornada completa, hasta 45.000 €, con escáner intraoral
  const oferta = await request(app)
    .post("/publicaciones")
    .set("Authorization", `Bearer ${clinica.token}`)
    .send({
      tipo: "oferta", ciudad: "Valencia", descripcion: "Ortodoncista", jornada: "Completa",
      salarioDesde: 38000, salarioHasta: 45000, equipamiento: ["Escáner intraoral", "CAD-CAM"],
      nombre_contacto: "Clínica Compat", email_contacto: "clinica-compat@test.com"
    });
  const ofertaId = oferta.body.id;

  await t.test("sin datos del dentista no hay porcentaje, y se dice qué falta", async () => {
    const res = await request(app)
      .get(`/publicaciones/${ofertaId}/compatibilidad`)
      .set("Authorization", `Bearer ${dentista.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.porcentaje, null);
    assert.equal(res.body.suficiente, false);
    assert.ok(res.body.dimensiones.every(d => d.estado === "sin_datos"));
    // En las derivadas el hueco es del dentista (la clínica sí publicó sus datos);
    // en las del cuestionario no ha respondido ninguno de los dos.
    const derivadas = res.body.dimensiones.filter(d => ["salario", "horarios", "tecnologia"].includes(d.clave));
    assert.ok(derivadas.every(d => d.falta === "dentista"));
  });

  await t.test("con el perfil del dentista completo devuelve el porcentaje y su desglose", async () => {
    // El dentista dice lo que busca (su solicitud) y lo que sabe hacer (certificaciones)
    await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({
        tipo: "solicitud", ciudad: "Valencia", descripcion: "Busco ortodoncia",
        jornada: "Completa", salarioDesde: 40000,
        nombre_contacto: "Dani Compat", email_contacto: "dentista-compat@test.com"
      });
    await request(app)
      .post("/auth/guardar-certificaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ certificaciones: ["Invisalign"] });

    const res = await request(app)
      .get(`/publicaciones/${ofertaId}/compatibilidad`)
      .set("Authorization", `Bearer ${dentista.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.suficiente, true);
    // Salario (45.000 ≥ 40.000), jornada (Completa) y tecnología (escáner + CAD-CAM) casan.
    // El cuestionario no lo ha respondido nadie, pero las derivadas bastan para el %.
    assert.equal(res.body.porcentaje, 100);
    assert.equal(res.body.dimensiones.length, 8);
  });

  await t.test("una clínica no tiene compatibilidad con una oferta (sería clínica↔clínica)", async () => {
    const res = await request(app)
      .get(`/publicaciones/${ofertaId}/compatibilidad`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 400);
  });

  await t.test("sin sesión no se puede pedir la compatibilidad", async () => {
    const res = await request(app).get(`/publicaciones/${ofertaId}/compatibilidad`);
    assert.equal(res.status, 401);
  });

  await t.test("una solicitud no tiene compatibilidad", async () => {
    const solicitud = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({
        tipo: "solicitud", ciudad: "Madrid", descripcion: "Otra solicitud",
        nombre_contacto: "Dani Compat", email_contacto: "dentista-compat@test.com"
      });
    const res = await request(app)
      .get(`/publicaciones/${solicitud.body.id}/compatibilidad`)
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.status, 400);
  });

  await t.test("una publicación inexistente da 404", async () => {
    const res = await request(app)
      .get("/publicaciones/999999/compatibilidad")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.status, 404);
  });
});
