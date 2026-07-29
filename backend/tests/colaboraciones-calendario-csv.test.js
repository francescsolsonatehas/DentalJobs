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

function parsearCsv(texto) {
  const lineas = texto.replace("﻿", "").split("\n");
  return { cabecera: lineas[0], filas: lineas.slice(1).filter(Boolean) };
}

// Todas las fechas 'YYYY-MM-DD' de un mes que caen en un día de la semana dado
// (1=lunes..6=sábado), para no depender de un mes/año concretos hardcodeados.
function fechasDelDiaSemana(anyo, mes, diaSemana) {
  const fechas = [];
  const diasEnMes = new Date(anyo, mes, 0).getDate();
  for (let d = 1; d <= diasEnMes; d++) {
    if (new Date(anyo, mes - 1, d).getDay() === diaSemana) {
      fechas.push(`${anyo}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
  }
  return fechas;
}

test("vista de calendario mensual de colaboraciones", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica Calendario", email: "clinica-cal-colab@test.com", tipo: "clinica" });

  // Colaboración recurrente los lunes (día 1)
  const colab = await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "colaboracion", ciudad: "Girona", descripcion: "Recurrente los lunes", diasSemana: [{ dia: 1, turno: "manana" }] });
  const colabId = colab.body.id;

  await t.test("exige año y mes válidos", async () => {
    const res = await request(app).get("/colaboraciones/calendario");
    assert.equal(res.status, 400);
  });

  await t.test("aparece en TODOS los lunes del mes, no en los demás días", async () => {
    const anyo = 2026, mes = 9; // septiembre 2026: mes de control, no depende de "hoy"
    const res = await request(app).get(`/colaboraciones/calendario?anyo=${anyo}&mes=${mes}`);
    assert.equal(res.status, 200);

    const lunes = fechasDelDiaSemana(anyo, mes, 1);
    const martes = fechasDelDiaSemana(anyo, mes, 2);

    lunes.forEach(fecha => {
      assert.ok(res.body.dias[fecha], `esperaba la colaboración en ${fecha} (lunes)`);
      assert.equal(res.body.dias[fecha][0].id, colabId);
      assert.equal(res.body.dias[fecha][0].turno, "manana");
    });
    martes.forEach(fecha => {
      assert.ok(!res.body.dias[fecha], `no esperaba nada en ${fecha} (martes)`);
    });
  });
});

test("exportación a CSV: colaboraciones y días de la semana en mis-publicaciones", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const clinica = await registrar(app, { nombre: "Clínica CSV Colab", email: "clinica-csv-colab@test.com", tipo: "clinica" });
  const dentista = await registrar(app, { nombre: "Dentista CSV Colab", email: "dentista-csv-colab@test.com", tipo: "dentista" });
  await request(app).put("/auth/actualizar-perfil").set("Authorization", `Bearer ${dentista.token}`)
    .send({ nombre: "Dentista CSV Colab", ciudad: "Girona" });

  await request(app).post("/publicaciones").set("Authorization", `Bearer ${clinica.token}`)
    .send({ tipo: "colaboracion", ciudad: "Girona", descripcion: "Ortodoncia recurrente", diasSemana: [{ dia: 1, turno: "manana" }, { dia: 3, turno: "ambos" }] });

  await request(app).post("/publicaciones").set("Authorization", `Bearer ${dentista.token}`)
    .send({ tipo: "colaboracion", descripcion: "Especialista disponible", diasSemana: [{ dia: 5, turno: "tarde" }] });

  await t.test("mis-publicaciones incluye la columna 'Días de la semana' formateada", async () => {
    const res = await request(app)
      .get("/exportar/mis-publicaciones.csv")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 200);
    const { cabecera, filas } = parsearCsv(res.text);
    assert.match(cabecera, /Días de la semana/);
    assert.equal(filas.length, 1);
    assert.match(filas[0], /Lunes \(mañana\), Miércoles \(mañana y tarde\)/);
  });

  await t.test("la vista 'colaboraciones' exporta las de los dos roles, con su tipo de cuenta", async () => {
    const res = await request(app)
      .get("/exportar/colaboraciones.csv")
      .set("Authorization", `Bearer ${dentista.token}`);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-disposition"], /colaboraciones-.*\.csv/);
    const { cabecera, filas } = parsearCsv(res.text);
    assert.match(cabecera, /Días de la semana/);
    assert.match(cabecera, /Tipo de cuenta/);
    assert.equal(filas.length, 2);
    assert.ok(filas.some(f => f.includes("Clínica CSV Colab") && f.includes("Clínica") && f.includes("Lunes (mañana), Miércoles (mañana y tarde)")));
    assert.ok(filas.some(f => f.includes("Dentista CSV Colab") && f.includes("Dentista") && f.includes("Viernes (tarde)")));
  });

  await t.test("la vista 'colaboraciones' es accesible para ambos roles (a diferencia de 'suplencias')", async () => {
    const res = await request(app)
      .get("/exportar/colaboraciones.csv")
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 200);
  });
});
