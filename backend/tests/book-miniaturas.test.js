const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const PDFDocument = require("pdfkit");
const { createTestApp, cleanupTestApp } = require("./helpers/testApp");
const { generarHojaMiniaturas } = require("../bookMiniaturas");

function crearPdfMultipagina(n) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    for (let i = 0; i < n; i++) {
      doc.addPage({ size: "A4" });
      doc.rect(50, 50, 400, 600).fill(i % 2 === 0 ? "#e63946" : "#2a9d8f");
      doc.fillColor("white").fontSize(30).text(`Página ${i + 1}`, 100, 300);
    }
    doc.end();
  });
}

// Cuenta las páginas de un PDF rasterizando cada una a PNG (con Ghostscript, que ya es
// una dependencia del proyecto para comprimirPdf) y contando los ficheros producidos.
async function contarPaginas(bufferPdf) {
  const dirTmp = await fs.mkdtemp(path.join(os.tmpdir(), "contar-"));
  const entrada = path.join(dirTmp, "in.pdf");
  const patron = path.join(dirTmp, "p-%d.png");
  try {
    await fs.writeFile(entrada, bufferPdf);
    await new Promise((resolve, reject) => {
      execFile(
        "gs",
        ["-sDEVICE=png16m", "-r30", "-dBATCH", "-dNOPAUSE", "-dQUIET", `-sOutputFile=${patron}`, entrada],
        { timeout: 20000 },
        (err) => (err ? reject(err) : resolve())
      );
    });
    return (await fs.readdir(dirTmp)).filter((f) => f.startsWith("p-")).length;
  } finally {
    await fs.rm(dirTmp, { recursive: true, force: true }).catch(() => {});
  }
}

test("generarHojaMiniaturas (unitario)", async (t) => {
  await t.test("reduce un PDF de varias páginas a una única página con todas las miniaturas", async () => {
    const original = await crearPdfMultipagina(7);
    const hoja = await generarHojaMiniaturas(original);
    assert.ok(hoja, "debe generar la hoja");
    assert.equal(hoja.slice(0, 5).toString("latin1"), "%PDF-");
    assert.equal(await contarPaginas(hoja), 1, "la hoja debe tener una única página");
  });

  await t.test("un PDF de una sola página también produce una hoja de una página", async () => {
    const original = await crearPdfMultipagina(1);
    const hoja = await generarHojaMiniaturas(original);
    assert.ok(hoja);
    assert.equal(await contarPaginas(hoja), 1);
  });

  await t.test("con un PDF ilegible devuelve null (para que quien llama pueda rechazar la subida)", async () => {
    const hoja = await generarHojaMiniaturas(Buffer.from("esto no es un pdf de verdad"));
    assert.equal(hoja, null);
  });
});

async function registrar(app, { nombre, email, tipo }) {
  const res = await request(app)
    .post("/auth/registro")
    .send({ nombre, email, password: "secreto123", tipo, aceptaTerminos: true });
  return { token: res.body.token, usuario: res.body.usuario };
}

test("subir un Book en PDF a través del endpoint", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const dentista = await registrar(app, { nombre: "Dentista Book Miniaturas", email: "dentista-book-miniaturas@test.com", tipo: "dentista" });

  await t.test("un PDF de varias páginas se guarda como una única página comprimida", async () => {
    const original = await crearPdfMultipagina(9);
    const subida = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${dentista.token}`)
      .field("tipo", "portfolio")
      .attach("archivo", original, { filename: "book.pdf", contentType: "application/pdf" });

    assert.equal(subida.status, 200);
    assert.ok(subida.body.archivo.tamanyo <= 10 * 1024 * 1024, "no debe superar los 10 MB");

    const descarga = await request(app)
      .get(`/archivos/${subida.body.id}/download`)
      .buffer(true)
      .parse((res, cb) => {
        const trozos = [];
        res.on("data", (c) => trozos.push(c));
        res.on("end", () => cb(null, Buffer.concat(trozos)));
      });
    assert.equal(descarga.status, 200);
    assert.equal(await contarPaginas(descarga.body), 1, "el Book guardado debe tener una única página");
  });

  await t.test("un PDF ilegible se rechaza en vez de guardarse sin más", async () => {
    const res = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${dentista.token}`)
      .field("tipo", "portfolio")
      .attach("archivo", Buffer.from("%PDF-1.4 esto no es un pdf de verdad"), "roto.pdf");
    assert.equal(res.status, 400);
  });
});
