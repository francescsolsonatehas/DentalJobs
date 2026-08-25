// Genera una única página de miniaturas con todas las páginas de un PDF del Book, para
// no guardar el PDF original entero (hasta 60 MB) sino solo esta hoja de contacto: pase
// lo que pase el original, la hoja cabe cómodamente bajo el tope de 10 MB.
//
// Usa Ghostscript (ya necesario para comprimirPdf, ver pdfs.js) para rasterizar cada
// página a JPEG y pdfkit para montarlas en una cuadrícula sobre una única página.
// Rasteriza siempre desde el PDF ORIGINAL (no desde una versión ya comprimida con
// Ghostscript): comprimir antes de rasterizar limitaría la resolución de partida sin
// que el tamaño final se beneficie, porque el tamaño lo controla esta misma función.
const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const PDFDocument = require("pdfkit");

// Por muchas páginas que tenga el original, la hoja de miniaturas no necesita más:
// acota el tiempo de proceso y el tamaño de la cuadrícula resultante.
const MAX_PAGINAS = 120;

const MAX_BYTES_HOJA = 10 * 1024 * 1024;

// De mayor a menor calidad: se prueba en orden y se usa la primera que quepa bajo el
// tope. Un Book con pocas páginas sale así con la máxima resolución posible; uno con
// muchas solo pierde la calidad estrictamente necesaria para caber en 10 MB.
//
// El primer nivel ya está calibrado para el tamaño de celda de montarCuadricula: una
// página A4 (595pt de ancho) rasterizada a 120dpi da ~990px de ancho, y la celda solo
// mide 220pt (~3x menos) — de sobra para verse nítida en la miniatura sin gastar peso
// en detalle que nunca se llega a mostrar.
const NIVELES_CALIDAD = [
  { dpi: 120, jpegQ: 88 },
  { dpi: 100, jpegQ: 82 },
  { dpi: 80, jpegQ: 72 },
  { dpi: 65, jpegQ: 60 },
  { dpi: 50, jpegQ: 50 },
];

function ejecutarGs(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile("gs", args, { timeout: timeoutMs }, (err) => (err ? reject(err) : resolve()));
  });
}

// Rasteriza cada página del PDF a un JPEG independiente (Ghostscript sustituye el
// "%03d" del patrón de salida por el número de página) y devuelve sus buffers en orden.
async function rasterizarPaginas(bufferPdf, { dpi, jpegQ }) {
  const dirTmp = await fs.mkdtemp(path.join(os.tmpdir(), "book-"));
  const entrada = path.join(dirTmp, "entrada.pdf");
  const patron = path.join(dirTmp, "pagina-%03d.jpg");
  try {
    await fs.writeFile(entrada, bufferPdf);
    await ejecutarGs([
      "-sDEVICE=jpeg",
      `-r${dpi}`,
      `-dJPEGQ=${jpegQ}`,
      "-dFirstPage=1",
      `-dLastPage=${MAX_PAGINAS}`,
      "-dNOPAUSE",
      "-dBATCH",
      "-dQUIET",
      `-sOutputFile=${patron}`,
      entrada
    ], 60000);

    const nombres = (await fs.readdir(dirTmp))
      .filter((f) => f.startsWith("pagina-") && f.endsWith(".jpg"))
      .sort();
    const paginas = [];
    for (const nombre of nombres) {
      paginas.push(await fs.readFile(path.join(dirTmp, nombre)));
    }
    return paginas;
  } finally {
    await fs.rm(dirTmp, { recursive: true, force: true }).catch(() => {});
  }
}

// Monta las miniaturas en una cuadrícula (columnas = raíz cuadrada del total,
// redondeando hacia arriba) sobre una única página, con el número de página debajo de
// cada una para poder ubicarla en el PDF original. Las celdas son grandes a propósito:
// de nada sirve rasterizar a alta resolución si luego se encogen a un sello de correos.
function montarCuadricula(paginas) {
  const n = paginas.length;
  const columnas = Math.ceil(Math.sqrt(n));
  const filas = Math.ceil(n / columnas);

  const margen = 24, hueco = 12, cabecera = 40;
  const celdaAncho = 220, celdaImagenAlto = 290, etiquetaAlto = 16;
  const celdaAlto = celdaImagenAlto + etiquetaAlto;
  const anchoPagina = margen * 2 + columnas * celdaAncho + (columnas - 1) * hueco;
  const altoPagina = margen * 2 + cabecera + filas * celdaAlto + (filas - 1) * hueco;

  const doc = new PDFDocument({ size: [anchoPagina, altoPagina], margin: 0 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const listo = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.fillColor("#0f4c75").fontSize(16).font("Helvetica-Bold")
    .text(`Book · ${n} página${n === 1 ? "" : "s"}`, margen, margen, { width: anchoPagina - margen * 2 });

  paginas.forEach((buf, i) => {
    const col = i % columnas;
    const fila = Math.floor(i / columnas);
    const x = margen + col * (celdaAncho + hueco);
    const y = margen + cabecera + fila * (celdaAlto + hueco);
    doc.rect(x, y, celdaAncho, celdaImagenAlto).strokeColor("#e5e7eb").lineWidth(1).stroke();
    try {
      doc.image(buf, x, y, { fit: [celdaAncho, celdaImagenAlto], align: "center", valign: "center" });
    } catch (e) {
      // Una página rara (imagen corrupta) no debe tirar abajo toda la hoja: se deja
      // el recuadro vacío y se sigue con el resto.
    }
    doc.fillColor("#9ca3af").fontSize(9).font("Helvetica")
      .text(String(i + 1), x, y + celdaImagenAlto + 3, { width: celdaAncho, align: "center" });
  });

  doc.end();
  return listo;
}

// Devuelve el buffer de la hoja de miniaturas, o null si el PDF es ilegible (corrupto,
// cifrado, Ghostscript no disponible...) y ningún nivel de calidad pudo rasterizar ni
// una página. Si ningún nivel cupo bajo el tope (un Book con muchísimas páginas),
// devuelve el más ligero conseguido en vez de nada.
async function generarHojaMiniaturas(bufferPdf, { maxBytes = MAX_BYTES_HOJA } = {}) {
  let mejorIntento = null;
  for (const nivel of NIVELES_CALIDAD) {
    try {
      const paginas = await rasterizarPaginas(bufferPdf, nivel);
      if (!paginas.length) continue;
      const hoja = await montarCuadricula(paginas);
      if (!mejorIntento || hoja.length < mejorIntento.length) mejorIntento = hoja;
      if (hoja.length <= maxBytes) return hoja;
    } catch (e) {
      // Este nivel de calidad falló (gs, memoria...): se prueba el siguiente, más ligero.
    }
  }
  return mejorIntento;
}

module.exports = { generarHojaMiniaturas };
