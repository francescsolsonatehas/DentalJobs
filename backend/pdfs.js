// Comprime PDFs (CV, Book, adjuntos de chat) con Ghostscript antes de guardarlos.
// Sobre todo ayuda cuando el PDF lleva imágenes incrustadas (un CV escaneado, fotos
// en el Book): Ghostscript las reduce de resolución. En un PDF solo de texto puede
// incluso pesar más que el original (reincrusta las fuentes), así que siempre se
// compara y se guarda el que pese menos.
//
// Sin `gs` en el PATH (no está instalado, o el entorno de despliegue no lo trae —
// ver nota en server.js), se guarda el original sin tocar: mismo criterio que con
// las imágenes si sharp no puede procesarlas.
const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

function ejecutarGs(args) {
  return new Promise((resolve, reject) => {
    execFile("gs", args, { timeout: 20000 }, (err) => (err ? reject(err) : resolve()));
  });
}

async function comprimirPdf(buffer) {
  const id = crypto.randomBytes(8).toString("hex");
  const entrada = path.join(os.tmpdir(), `pdf-in-${id}.pdf`);
  const salida = path.join(os.tmpdir(), `pdf-out-${id}.pdf`);
  try {
    await fs.writeFile(entrada, buffer);
    await ejecutarGs([
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      "-dPDFSETTINGS=/ebook", // ~150dpi en imágenes incrustadas: buen punto para un CV/Book
      "-dNOPAUSE",
      "-dBATCH",
      "-dQUIET",
      `-sOutputFile=${salida}`,
      entrada
    ]);
    const comprimido = await fs.readFile(salida);
    // Ghostscript puede "tener éxito" (exit 0) con una entrada que no es un PDF de
    // verdad y aun así escribir algo: comprobar la cabecera y quedarse con el que
    // pese menos evita tanto eso como el caso (real) de que comprimir no compense.
    const esPdfValido = comprimido.slice(0, 5).toString("latin1") === "%PDF-";
    return esPdfValido && comprimido.length > 0 && comprimido.length < buffer.length
      ? comprimido
      : buffer;
  } catch (e) {
    return buffer;
  } finally {
    await fs.unlink(entrada).catch(() => {});
    await fs.unlink(salida).catch(() => {});
  }
}

module.exports = { comprimirPdf };
