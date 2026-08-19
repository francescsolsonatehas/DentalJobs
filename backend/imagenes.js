// Comprime y redimensiona las imágenes que se suben (logo, fotos de la clínica,
// imágenes del Book, adjuntos de chat) antes de guardarlas: se ven en pantalla a
// tamaños moderados, así que no hace falta conservarlas al tamaño/calidad original
// de la cámara o el móvil de quien las sube. Los PDF (CV, Book en PDF) no pasan
// por aquí.
const sharp = require("sharp");

// Lado más largo tras el redimensionado, según dónde se usa cada imagen: el logo
// se ve pequeño (cabecera, tarjetas), el Book y las fotos de clínica se ven más grandes.
const MAX_LADO_POR_TIPO = { logo: 800, foto: 1600, portfolio: 1800, chat: 1600 };
const CALIDAD_WEBP = 82;

// Devuelve { buffer, mime } con la imagen recomprimida a WebP, o { buffer: original,
// mime: null } si no se pudo procesar (formato no reconocido, archivo corrupto...) —
// mime: null le dice a quien llama que conserve el mime/nombre originales, mejor
// eso que rechazar la subida por no poder optimizarla.
async function comprimirImagen(buffer, tipo) {
  const maxLado = MAX_LADO_POR_TIPO[tipo] || 1600;
  try {
    const salida = await sharp(buffer)
      .rotate() // aplica la orientación EXIF antes de perderla al recomprimir
      .resize({ width: maxLado, height: maxLado, fit: "inside", withoutEnlargement: true })
      .webp({ quality: CALIDAD_WEBP })
      .toBuffer();
    return { buffer: salida, mime: "image/webp" };
  } catch (e) {
    return { buffer, mime: null };
  }
}

module.exports = { comprimirImagen };
