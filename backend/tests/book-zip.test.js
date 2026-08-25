const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");
const { crearZip } = require("../zip");

async function registrar(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo, aceptaTerminos: true });
  return { token: res.body.token, usuario: res.body.usuario };
}

// Lee un ZIP sin dependencias: basta con recorrer las cabeceras locales, que es lo
// que necesitamos para comprobar nombres y contenidos (todo va sin comprimir).
function leerZip(buffer) {
  const entradas = [];
  let i = 0;
  while (i + 4 <= buffer.length && buffer.readUInt32LE(i) === 0x04034b50) {
    const tamanyo = buffer.readUInt32LE(i + 18);
    const largoNombre = buffer.readUInt16LE(i + 26);
    const largoExtra = buffer.readUInt16LE(i + 28);
    const nombre = buffer.slice(i + 30, i + 30 + largoNombre).toString("utf8");
    const inicio = i + 30 + largoNombre + largoExtra;
    entradas.push({ nombre, contenido: buffer.slice(inicio, inicio + tamanyo).toString("utf8") });
    i = inicio + tamanyo;
  }
  return entradas;
}

test("generador de ZIP", async (t) => {
  await t.test("empaqueta los ficheros con su nombre y contenido", () => {
    const zip = crearZip([
      { nombre: "uno.txt", contenido: Buffer.from("contenido uno") },
      { nombre: "dos.pdf", contenido: Buffer.from("contenido dos") }
    ]);
    assert.deepEqual(leerZip(zip), [
      { nombre: "uno.txt", contenido: "contenido uno" },
      { nombre: "dos.pdf", contenido: "contenido dos" }
    ]);
  });

  await t.test("dos ficheros con el mismo nombre no se pisan", () => {
    const zip = crearZip([
      { nombre: "foto.jpg", contenido: Buffer.from("primera") },
      { nombre: "foto.jpg", contenido: Buffer.from("segunda") }
    ]);
    assert.deepEqual(leerZip(zip).map(e => e.nombre), ["foto.jpg", "foto (2).jpg"]);
  });

  await t.test("cierra con el marcador de fin de directorio y cuenta las entradas", () => {
    const zip = crearZip([{ nombre: "a.txt", contenido: Buffer.from("a") }]);
    const fin = zip.length - 22;
    assert.equal(zip.readUInt32LE(fin), 0x06054b50);
    assert.equal(zip.readUInt16LE(fin + 10), 1);
  });
});

test("descargar todo el Book en un ZIP", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const dentista = await registrar(app, { nombre: "Dentista Book", email: "book-d@test.com", tipo: "dentista" });
  const clinica = await registrar(app, { nombre: "Clínica Book", email: "book-c@test.com", tipo: "clinica" });

  const subir = (nombre, tipo, contenido) =>
    request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${dentista.token}`)
      .field("tipo", tipo)
      .attach("archivo", Buffer.from(contenido), nombre);

  await t.test("sin Book responde 404", async () => {
    const res = await request(app)
      .get(`/archivos/book/${dentista.usuario.id}.zip`)
      .set("Authorization", `Bearer ${clinica.token}`);
    assert.equal(res.status, 404);
  });

  // El Book solo admite un archivo (sustituye al anterior, no se acumula), así que el
  // ZIP nunca tendrá más de uno; esto comprueba igualmente que solo entra el Book, no
  // otros tipos de archivo del mismo dentista.
  await subir("caso.jpg", "portfolio", "imagen del caso");
  await subir("foto-clinica.jpg", "foto", "una foto que no es del Book");

  await t.test("hace falta sesión", async () => {
    const res = await request(app).get(`/archivos/book/${dentista.usuario.id}.zip`);
    assert.equal(res.status, 401);
  });

  await t.test("devuelve un ZIP con el archivo del Book, y solo ese", async () => {
    const res = await request(app)
      .get(`/archivos/book/${dentista.usuario.id}.zip`)
      .set("Authorization", `Bearer ${clinica.token}`)
      .buffer(true)
      .parse((res, cb) => {
        const trozos = [];
        res.on("data", c => trozos.push(c));
        res.on("end", () => cb(null, Buffer.concat(trozos)));
      });

    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "application/zip");
    assert.match(res.headers["content-disposition"], /attachment; filename=".*\.zip"/);

    const entradas = leerZip(res.body);
    assert.deepEqual(entradas.map(e => e.nombre), ["caso.jpg"]);
    assert.equal(entradas[0].contenido, "imagen del caso");
  });
});
