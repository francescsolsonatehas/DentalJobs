// Comprime PDFs (CV, Book, adjuntos de chat) con la API de iLovePDF antes de
// guardarlos. Se usa un servicio HTTP en vez de un binario local (Ghostscript):
// el runtime de Render no trae herramientas de sistema instalables sin pasar a
// un despliegue Docker — mismo motivo por el que el correo va por la API HTTP
// de Brevo en vez de SMTP (ver email.js).
//
// Sin ILOVEPDF_PUBLIC_KEY/ILOVEPDF_SECRET_KEY configuradas (ver .env.example),
// no se llama a la API y se guarda el PDF original sin tocar. Cuenta gratuita
// en https://developer.ilovepdf.com para conseguir esas dos claves.
const ILovePDFApi = require("@ilovepdf/ilovepdf-nodejs");
const ILovePDFFile = require("@ilovepdf/ilovepdf-nodejs/ILovePDFFile");

function habilitado() {
  return !!(process.env.ILOVEPDF_PUBLIC_KEY && process.env.ILOVEPDF_SECRET_KEY);
}

// Evita dejar la subida colgada si la API tarda o no responde.
function conTimeout(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout comprimiendo PDF")), ms))
  ]);
}

async function comprimirPdf(buffer, nombreArchivo) {
  if (!habilitado()) return buffer;

  try {
    const instance = new ILovePDFApi(process.env.ILOVEPDF_PUBLIC_KEY, process.env.ILOVEPDF_SECRET_KEY);
    const task = instance.newTask("compress");

    const resultado = await conTimeout((async () => {
      await task.start();
      await task.addFile(ILovePDFFile.fromArray(buffer, nombreArchivo || "archivo.pdf"));
      await task.process({ compression_level: "recommended" });
      return task.download();
    })(), 20000);

    const comprimido = Buffer.from(resultado);
    // Un PDF solo de texto puede no reducirse (o incluso pesar más); quedarse
    // siempre con el que pese menos, igual que con las imágenes si sharp no
    // puede procesarlas.
    const esPdfValido = comprimido.slice(0, 5).toString("latin1") === "%PDF-";
    return esPdfValido && comprimido.length > 0 && comprimido.length < buffer.length
      ? comprimido
      : buffer;
  } catch (e) {
    console.error("Error al comprimir PDF con iLovePDF:", e.message);
    return buffer;
  }
}

module.exports = { habilitado, comprimirPdf };
