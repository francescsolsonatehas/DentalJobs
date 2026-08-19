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

test("CV en PDF", async (t) => {
  const { app, dbPath } = createTestApp();
  t.after(() => cleanupTestApp(dbPath));

  const dentista = await registrarYLoguear(app, { nombre: "Dentista PDF", email: "dentista-pdf@test.com", tipo: "dentista" });
  const clinica = await registrarYLoguear(app, { nombre: "Clínica PDF", email: "clinica-pdf@test.com", tipo: "clinica" });

  await request(app)
    .put("/auth/actualizar-perfil")
    .set("Authorization", `Bearer ${dentista.token}`)
    .send({ nombre: "Dentista PDF", anyos_experiencia: 4, descripcion: "Ortodoncista", ciudad: "Sevilla" });

  await t.test("un dentista puede descargar su CV en PDF", async () => {
    const res = await request(app)
      .get("/auth/mi-cv.pdf")
      .set("Authorization", `Bearer ${dentista.token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.match(res.headers["content-disposition"], /CV-Dentista-PDF\.pdf/);
    assert.equal(res.body.slice(0, 5).toString(), "%PDF-");
  });

  await t.test("con foto de perfil, el PDF la incrusta (pesa más y trae una imagen JPEG)", async () => {
    // JPEG 1x1 válido mínimo: pdfkit necesita poder leer sus cabeceras de verdad.
    const jpegMinimo = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64"
    );

    const subida = await request(app)
      .post("/archivos/upload")
      .set("Authorization", `Bearer ${dentista.token}`)
      .field("tipo", "logo")
      .attach("archivo", jpegMinimo, { filename: "foto.jpg", contentType: "image/jpeg" });
    assert.equal(subida.status, 200);

    const res = await request(app)
      .get("/auth/mi-cv.pdf")
      .set("Authorization", `Bearer ${dentista.token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.slice(0, 5).toString(), "%PDF-");
    assert.ok(res.body.includes("DCTDecode"), "el PDF debe traer una imagen JPEG incrustada");
  });

  await t.test("una clínica no puede generar CV", async () => {
    const res = await request(app)
      .get("/auth/mi-cv.pdf")
      .set("Authorization", `Bearer ${clinica.token}`);

    assert.equal(res.status, 403);
  });

  await t.test("sin token no hay CV", async () => {
    const res = await request(app).get("/auth/mi-cv.pdf");
    assert.equal(res.status, 401);
  });
});
