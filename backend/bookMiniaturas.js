// Genera una única página de miniaturas con todas las páginas de un PDF del Book, para
// no guardar el PDF original entero (hasta 60 MB) sino solo esta hoja de contacto: pase
// lo que pase el original, la hoja cabe cómodamente bajo el tope de 10 MB.
//
// Usa Ghostscript (ya necesario para comprimirPdf, ver pdfs.js) para rasterizar cada
// página a JPEG y pdfkit para montarlas en una cuadrícula sobre una única página.
const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const PDFDocument = require("pdfkit");

// Por muchas páginas que tenga el original, la hoja de miniaturas no necesita más:
// acota el tiempo de proceso y el tamaño de la cuadrícula resultante.
const MAX_PAGINAS = 120;

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
// cada una para poder ubicarla en el PDF original.
function montarCuadricula(paginas) {
  const n = paginas.length;
  const columnas = Math.ceil(Math.sqrt(n));
  const filas = Math.ceil(n / columnas);

  const margen = 20, hueco = 10, cabecera = 36;
  const celdaAncho = 170, celdaImagenAlto = 210, etiquetaAlto = 14;
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

  doc.fillColor("#0f4c75").fontSize(14).font("Helvetica-Bold")
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
    doc.fillColor("#9ca3af").fontSize(8).font("Helvetica")
      .text(String(i + 1), x, y + celdaImagenAlto + 2, { width: celdaAncho, align: "center" });
  });

  doc.end();
  return listo;
}

// Devuelve el buffer de la hoja de miniaturas, o null si no se pudo generar (PDF
// corrupto, cifrado, Ghostscript no disponible...): quien llama debe quedarse entonces
// con el PDF comprimido tal cual, igual que hace comprimirPdf cuando falla.
async function generarHojaMiniaturas(bufferPdf, { dpi = 100, jpegQ = 60 } = {}) {
  try {
    const paginas = await rasterizarPaginas(bufferPdf, { dpi, jpegQ });
    if (!paginas.length) return null;
    return await montarCuadricula(paginas);
  } catch (e) {
    return null;
  }
}

module.exports = { generarHojaMiniaturas };
