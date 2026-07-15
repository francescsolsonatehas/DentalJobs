const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");
const { calcularCompatibilidad, DIMENSIONES_CUESTIONARIO } = require("../compatibilidad");

async function registrar(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo, aceptaTerminos: true });
  return { token: res.body.token, usuario: res.body.usuario };
}

// Respuestas al cuestionario que casan al 100% en las 5 dimensiones nuevas.
const RESPUESTAS = {
  filosofia: "Mínimamente invasiva: preservar todo lo posible",
  pacientes: ["Familias y niños", "Ortodoncia"],
  ambiente: "Clínica pequeña y familiar",
  formacion_continua: "Formación pagada y frecuente",
  objetivos: ["Estabilidad a largo plazo", "Especializarme"]
};

// Perfil y oferta con las 3 dimensiones de la Fase 1 en coincidencia perfecta,
// para poder aislar el efecto de las 5 del cuestionario.
const BASE_PERFIL = {
  salario_pretendido: 40000,
  jornada_buscada: "Completa",
  disponibilidad: [],
  certificaciones: ["Invisalign"]
};
const BASE_OFERTA = {
  tipo: "oferta",
  jornada: "Completa",
  salario_min: 40000,
  salario_max: 45000,
  equipamiento: ["Escáner intraoral", "CAD-CAM"]
};

test("motor: dimensiones del cuestionario (unitario)", async (t) => {
  await t.test("responder lo mismo en las 8 dimensiones da 100%", () => {
    const r = calcularCompatibilidad(
      { ...BASE_PERFIL, preferencias: RESPUESTAS },
      { ...BASE_OFERTA, preferencias: RESPUESTAS }
    );
    assert.equal(r.porcentaje, 100);
    assert.equal(r.cobertura, 1);
    assert.equal(r.dimensiones.length, 8);
  });

  await t.test("el eje puntúa por cercanía, no por igualdad", () => {
    const contiguo = calcularCompatibilidad(
      { ...BASE_PERFIL, preferencias: { ...RESPUESTAS, ambiente: "Clínica pequeña y familiar" } },
      { ...BASE_OFERTA, preferencias: { ...RESPUESTAS, ambiente: "Equipo mediano" } }
    );
    const opuesto = calcularCompatibilidad(
      { ...BASE_PERFIL, preferencias: { ...RESPUESTAS, ambiente: "Clínica pequeña y familiar" } },
      { ...BASE_OFERTA, preferencias: { ...RESPUESTAS, ambiente: "Grupo grande y estructurado" } }
    );
    const dimContigua = contiguo.dimensiones.find(d => d.clave === "ambiente");
    const dimOpuesta = opuesto.dimensiones.find(d => d.clave === "ambiente");

    // A un paso: media tabla. En el extremo opuesto: cero.
    assert.equal(dimContigua.puntuacion, 0.5);
    assert.equal(dimContigua.estado, "parcial");
    assert.equal(dimOpuesta.puntuacion, 0);
    assert.equal(dimOpuesta.estado, "discrepa");
  });

  await t.test("la multiselección mide qué fracción de lo que buscas cubre la clínica", () => {
    const r = calcularCompatibilidad(
      { ...BASE_PERFIL, preferencias: { ...RESPUESTAS, pacientes: ["Familias y niños", "Ortodoncia", "Estética"] } },
      { ...BASE_OFERTA, preferencias: { ...RESPUESTAS, pacientes: ["Familias y niños", "Urgencias"] } }
    );
    const dim = r.dimensiones.find(d => d.clave === "pacientes");
    // Buscas 3 tipos y la clínica cubre 1 → 1/3. Que además atienda urgencias
    // (que no buscas) no resta: solo no suma.
    assert.equal(dim.puntuacion, 1 / 3);
    assert.deepEqual(dim.coincidencias, ["Familias y niños"]);
  });

  await t.test("que la clínica ofrezca de más no penaliza", () => {
    const justo = calcularCompatibilidad(
      { ...BASE_PERFIL, preferencias: { ...RESPUESTAS, objetivos: ["Especializarme"] } },
      { ...BASE_OFERTA, preferencias: { ...RESPUESTAS, objetivos: ["Especializarme"] } }
    );
    const deMas = calcularCompatibilidad(
      { ...BASE_PERFIL, preferencias: { ...RESPUESTAS, objetivos: ["Especializarme"] } },
      { ...BASE_OFERTA, preferencias: { ...RESPUESTAS, objetivos: ["Especializarme", "Maximizar ingresos", "Casos complejos"] } }
    );
    assert.equal(justo.dimensiones.find(d => d.clave === "objetivos").puntuacion, 1);
    assert.equal(deMas.dimensiones.find(d => d.clave === "objetivos").puntuacion, 1);
  });

  await t.test("una pregunta sin responder sale del denominador y dice a quién le falta", () => {
    const soloClinica = { ...RESPUESTAS };
    const sinFilosofia = { ...RESPUESTAS };
    delete sinFilosofia.filosofia;

    const r = calcularCompatibilidad(
      { ...BASE_PERFIL, preferencias: sinFilosofia },
      { ...BASE_OFERTA, preferencias: soloClinica }
    );
    const dim = r.dimensiones.find(d => d.clave === "filosofia");
    assert.equal(dim.estado, "sin_datos");
    assert.equal(dim.falta, "dentista");
    // El resto casa perfecto, así que el hueco no arrastra el resultado
    assert.equal(r.porcentaje, 100);
    assert.ok(r.cobertura < 1);
  });

  await t.test("una clínica que no ha respondido el cuestionario NO pierde su porcentaje", () => {
    // Es el caso de todas las ofertas que ya existían al añadir el cuestionario.
    // Las 3 dimensiones derivadas (8 de 19 de peso) tienen que bastar por sí solas:
    // si no, añadir preguntas nuevas dejaría sin número a toda la plataforma.
    const r = calcularCompatibilidad(
      { ...BASE_PERFIL, preferencias: RESPUESTAS },
      { ...BASE_OFERTA, preferencias: {} }
    );
    assert.equal(r.porcentaje, 100);
    assert.ok(r.cobertura >= 0.4 && r.cobertura < 0.5);

    // Y las 5 sin responder señalan a la clínica, para poder pedírselas
    const delCuestionario = r.dimensiones.filter(d => DIMENSIONES_CUESTIONARIO.some(c => c.clave === d.clave));
    assert.equal(delCuestionario.length, 5);
    assert.ok(delCuestionario.every(d => d.estado === "sin_datos" && d.falta === "clinica"));
  });

  await t.test("pero una o dos dimensiones sueltas siguen sin dar porcentaje", () => {
    // Perfil vacío salvo certificaciones: solo puntúa tecnología (2 de 19 = 0,1)
    const r = calcularCompatibilidad(
      { certificaciones: ["Invisalign"] },
      { ...BASE_OFERTA, preferencias: {} }
    );
    assert.equal(r.porcentaje, null);
    assert.equal(r.suficiente, false);
  });

  await t.test("respuestas fuera del catálogo no puntúan (no se inventa un 0)", () => {
    const r = calcularCompatibilidad(
      { ...BASE_PERFIL, preferencias: { ...RESPUESTAS, filosofia: "Opción que ya no existe" } },
      { ...BASE_OFERTA, preferencias: RESPUESTAS }
    );
    const dim = r.dimensiones.find(d => d.clave === "filosofia");
    assert.equal(dim.estado, "sin_datos");
    assert.equal(dim.puntuacion, null);
  });
});

test("endpoints del cuestionario", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Cuest", email: "clinica-cuest@test.com", tipo: "clinica" });
  const dentista = await registrar(app, { nombre: "Dani Cuest", email: "dentista-cuest@test.com", tipo: "dentista" });

  await t.test("el catálogo expone las 5 dimensiones con sus opciones", async () => {
    const res = await request(app).get("/compatibilidad/catalogo");
    assert.equal(res.status, 200);
    assert.equal(res.body.dimensiones.length, 5);
    const filosofia = res.body.dimensiones.find(d => d.clave === "filosofia");
    assert.equal(filosofia.tipo, "eje");
    assert.ok(filosofia.opciones.length >= 2);
    assert.ok(filosofia.pregunta_dentista && filosofia.pregunta_clinica);
  });

  await t.test("se guardan y se releen las respuestas", async () => {
    const guardar = await request(app)
      .put("/preferencias")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ preferencias: RESPUESTAS });
    assert.equal(guardar.status, 200);

    const leer = await request(app)
      .get("/preferencias")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(leer.body.preferencias.filosofia, RESPUESTAS.filosofia);
    assert.deepEqual(leer.body.preferencias.pacientes.sort(), [...RESPUESTAS.pacientes].sort());
  });

  await t.test("guardar reemplaza por completo, no acumula", async () => {
    await request(app)
      .put("/preferencias")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ preferencias: { ...RESPUESTAS, pacientes: ["Urgencias"] } });

    const leer = await request(app)
      .get("/preferencias")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.deepEqual(leer.body.preferencias.pacientes, ["Urgencias"]);

    // Se restauran para el resto de los tests
    await request(app)
      .put("/preferencias")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ preferencias: RESPUESTAS });
  });

  await t.test("los valores fuera del catálogo se descartan", async () => {
    await request(app)
      .put("/preferencias")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ preferencias: { ...RESPUESTAS, ambiente: "Inventado", clave_inventada: "x" } });

    const leer = await request(app)
      .get("/preferencias")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(leer.body.preferencias.ambiente, undefined);
    assert.equal(leer.body.preferencias.clave_inventada, undefined);
    assert.equal(leer.body.preferencias.filosofia, RESPUESTAS.filosofia); // lo válido sí entra

    await request(app)
      .put("/preferencias")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ preferencias: RESPUESTAS });
  });

  await t.test("sin sesión no se pueden guardar preferencias", async () => {
    const res = await request(app).put("/preferencias").send({ preferencias: RESPUESTAS });
    assert.equal(res.status, 401);
  });

  await t.test("la oferta hereda las respuestas de su clínica en el cálculo", async () => {
    // La clínica responde el cuestionario UNA vez, en su perfil
    await request(app)
      .put("/preferencias")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({ preferencias: RESPUESTAS });

    // Y publica una oferta sin decir nada del cuestionario en el formulario
    const oferta = await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${clinica.token}`)
      .send({
        tipo: "oferta", ciudad: "Valencia", descripcion: "Ortodoncista", jornada: "Completa",
        salarioDesde: 40000, salarioHasta: 45000, equipamiento: ["Escáner intraoral", "CAD-CAM"],
        nombre_contacto: "Clínica Cuest", email_contacto: "clinica-cuest@test.com"
      });

    // El dentista necesita su solicitud para las dimensiones de la Fase 1
    await request(app)
      .post("/publicaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({
        tipo: "solicitud", ciudad: "Valencia", descripcion: "Busco", jornada: "Completa", salarioDesde: 40000,
        nombre_contacto: "Dani Cuest", email_contacto: "dentista-cuest@test.com"
      });
    await request(app)
      .post("/auth/guardar-certificaciones")
      .set("Authorization", `Bearer ${dentista.token}`)
      .send({ certificaciones: ["Invisalign"] });

    const res = await request(app)
      .get(`/publicaciones/${oferta.body.id}/compatibilidad`)
      .set("Authorization", `Bearer ${dentista.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.dimensiones.length, 8);
    assert.equal(res.body.cobertura, 1); // las 8 evaluadas, sin preguntar nada en la oferta
    assert.equal(res.body.porcentaje, 100);
  });

  await t.test("el onboarding pide el test mientras no esté respondido", async () => {
    const nuevo = await registrar(app, { nombre: "Nuevo", email: "nuevo-cuest@test.com", tipo: "dentista" });

    const antes = await request(app).get("/onboarding").set("Authorization", `Bearer ${nuevo.token}`);
    const pasoAntes = antes.body.pasos.find(p => p.id === "compatibilidad");
    assert.equal(pasoAntes.hecho, false);

    await request(app)
      .put("/preferencias")
      .set("Authorization", `Bearer ${nuevo.token}`)
      .send({ preferencias: RESPUESTAS });

    const despues = await request(app).get("/onboarding").set("Authorization", `Bearer ${nuevo.token}`);
    assert.equal(despues.body.pasos.find(p => p.id === "compatibilidad").hecho, true);
  });
});
