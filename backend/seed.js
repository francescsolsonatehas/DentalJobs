// Rellena la base de datos con datos de demostración para desarrollo.
// Uso:  node seed.js          (solo si la BD está vacía)
//       node seed.js --force  (añade los datos aunque haya usuarios)
const bcrypt = require("bcryptjs");
const db = require("./db");

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { err ? reject(err) : resolve(row); });
});

const PASSWORD_DEMO = "demo1234";

async function seed() {
  const { count } = await get("SELECT COUNT(*) as count FROM usuarios");
  if (count > 0 && !process.argv.includes("--force")) {
    console.log(`La BD ya tiene ${count} usuarios. Usa --force para añadir los datos de demo igualmente.`);
    process.exit(0);
  }

  const hash = bcrypt.hashSync(PASSWORD_DEMO, 10);

  const usuarios = [
    { nombre: "Clínica Dental Sonrisa", email: "clinica.sonrisa@demo.com", tipo: "clinica", ciudad: "Barcelona", descripcion: "Clínica familiar con 20 años de trayectoria y equipo CAD-CAM." },
    { nombre: "Centro Odontológico Ponent", email: "clinica.ponent@demo.com", tipo: "clinica", ciudad: "Lleida", descripcion: "Centro moderno especializado en implantología." },
    { nombre: "Laura Martínez", email: "laura.dentista@demo.com", tipo: "dentista", ciudad: "Barcelona", anyos: 6, descripcion: "Ortodoncista con certificación Invisalign." },
    { nombre: "Marc Puig", email: "marc.dentista@demo.com", tipo: "dentista", ciudad: "Girona", anyos: 3, descripcion: "Generalista con interés en endodoncia." },
    { nombre: "Aina Ferrer", email: "aina.dentista@demo.com", tipo: "dentista", ciudad: "Lleida", anyos: 10, descripcion: "Implantóloga senior." }
  ];

  const ids = {};
  for (const u of usuarios) {
    const r = await run(
      "INSERT INTO usuarios (nombre, email, password, tipo, ciudad, anyos_experiencia, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [u.nombre, u.email, hash, u.tipo, u.ciudad, u.anyos || null, u.descripcion]
    );
    ids[u.email] = r.lastID;
  }

  // Especialidades de usuario (ids de especialidades: ver db.js — 6=Ortodoncia, 3=Implantología, 4=Endodoncia, 1=Generalista)
  await run("INSERT INTO usuario_especialidades (usuario_id, especialidad_id) VALUES (?, ?)", [ids["laura.dentista@demo.com"], 6]);
  await run("INSERT INTO usuario_especialidades (usuario_id, especialidad_id) VALUES (?, ?)", [ids["marc.dentista@demo.com"], 1]);
  await run("INSERT INTO usuario_especialidades (usuario_id, especialidad_id) VALUES (?, ?)", [ids["aina.dentista@demo.com"], 3]);

  const publicaciones = [
    { tipo: "oferta", email: "clinica.sonrisa@demo.com", ciudad: "Barcelona", contrato: "Indefinido", jornada: "Completa", salario: "2500-3000€/mes", esp: 6, descripcion: "Buscamos ortodoncista para consulta consolidada. Agenda completa desde el primer día." },
    { tipo: "oferta", email: "clinica.ponent@demo.com", ciudad: "Lleida", contrato: "Autónomo", jornada: "Parcial", salario: "40% facturación", esp: 3, descripcion: "Implantólogo/a para 2 días por semana con posibilidad de ampliar." },
    { tipo: "solicitud", email: "laura.dentista@demo.com", ciudad: "Barcelona", contrato: "Indefinido", jornada: "Completa", esp: 6, descripcion: "Ortodoncista con 6 años de experiencia busca clínica en Barcelona o alrededores." },
    { tipo: "solicitud", email: "marc.dentista@demo.com", ciudad: "Girona", jornada: "Flexible", esp: 1, descripcion: "Dentista generalista disponible para sustituciones y jornadas parciales." }
  ];

  const pubIds = [];
  for (const p of publicaciones) {
    const salarioMatch = (p.salario || "").match(/\d+/);
    const r = await run(
      `INSERT INTO publicaciones (tipo, descripcion, ciudad, contrato, jornada, salario, salario_min, usuario_id, nombre_contacto, email_contacto)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.tipo, p.descripcion, p.ciudad, p.contrato || null, p.jornada || null, p.salario || null,
       salarioMatch ? parseInt(salarioMatch[0]) : null, ids[p.email],
       usuarios.find(u => u.email === p.email).nombre, p.email]
    );
    pubIds.push(r.lastID);
    await run("INSERT INTO publicacion_especialidades (publicacion_id, especialidad_id) VALUES (?, ?)", [r.lastID, p.esp]);
  }

  // Una candidatura aceptada (Laura → oferta de Sonrisa) y una pendiente (Aina → oferta de Ponent)
  await run(
    "INSERT INTO candidaturas (publicacion_id, usuario_id, estado, mensaje) VALUES (?, ?, 'aceptada', ?)",
    [pubIds[0], ids["laura.dentista@demo.com"], "Me encajaría perfectamente, tengo certificación Invisalign."]
  );
  await run(
    "INSERT INTO candidaturas (publicacion_id, usuario_id, estado, mensaje) VALUES (?, ?, 'pendiente', ?)",
    [pubIds[1], ids["aina.dentista@demo.com"], "Disponible martes y jueves."]
  );

  console.log("✅ Datos de demo creados.");
  console.log(`   ${usuarios.length} usuarios (contraseña de todos: ${PASSWORD_DEMO})`);
  console.log(`   Clínicas: clinica.sonrisa@demo.com, clinica.ponent@demo.com`);
  console.log(`   Dentistas: laura.dentista@demo.com, marc.dentista@demo.com, aina.dentista@demo.com`);
  process.exit(0);
}

// Esperar a que db.js termine de crear el esquema antes de sembrar
setTimeout(() => {
  seed().catch(err => {
    console.error("Error al sembrar datos:", err);
    process.exit(1);
  });
}, 500);
