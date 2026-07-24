// Generador de ficheros ZIP mínimo, sin dependencias.
//
// Guarda las entradas con el método "store" (sin comprimir), que es lo razonable aquí:
// lo que se empaqueta son JPEG y PDF, que ya vienen comprimidos, así que comprimir de
// nuevo cuesta CPU y no baja el tamaño. Los contenidos llegan como Buffer (salen de la
// BD), de modo que no hace falta streaming ni ficheros temporales.
//
// Se emite el formato clásico de 32 bits: suficiente mientras el ZIP y cada fichero
// queden por debajo de 4 GB, muy por encima de los límites de subida de la aplicación.

const TABLA_CRC = (() => {
  const tabla = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    tabla[i] = c;
  }
  return tabla;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) {
    c = TABLA_CRC[(c ^ buffer[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

// Fecha y hora en el formato MS-DOS que usa el ZIP (segundos con precisión de 2)
function fechaDos(fecha) {
  const anyo = Math.max(1980, fecha.getFullYear());
  return {
    hora: (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | (fecha.getSeconds() >> 1),
    dia: ((anyo - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate()
  };
}

// Evita que dos entradas compartan nombre: "foto.jpg", "foto (2).jpg", …
function nombresUnicos(nombres) {
  const vistos = new Map();
  return nombres.map(nombre => {
    const n = (nombre || "archivo").replace(/[\\/]/g, "_");
    if (!vistos.has(n)) { vistos.set(n, 1); return n; }
    const veces = vistos.get(n) + 1;
    vistos.set(n, veces);
    const punto = n.lastIndexOf(".");
    return punto > 0
      ? `${n.slice(0, punto)} (${veces})${n.slice(punto)}`
      : `${n} (${veces})`;
  });
}

/**
 * Crea un ZIP en memoria.
 * @param {Array<{nombre: string, contenido: Buffer}>} entradas
 * @returns {Buffer}
 */
function crearZip(entradas, fecha = new Date()) {
  const { hora, dia } = fechaDos(fecha);
  const nombres = nombresUnicos(entradas.map(e => e.nombre));

  const trozos = [];
  const central = [];
  let desplazamiento = 0;

  entradas.forEach((entrada, i) => {
    const nombre = Buffer.from(nombres[i], "utf8");
    const datos = Buffer.isBuffer(entrada.contenido)
      ? entrada.contenido
      : Buffer.from(entrada.contenido || "");
    const crc = crc32(datos);

    // Cabecera local
    const cabecera = Buffer.alloc(30);
    cabecera.writeUInt32LE(0x04034b50, 0);   // firma
    cabecera.writeUInt16LE(20, 4);           // versión necesaria
    cabecera.writeUInt16LE(0x0800, 6);       // nombre en UTF-8
    cabecera.writeUInt16LE(0, 8);            // método: store
    cabecera.writeUInt16LE(hora, 10);
    cabecera.writeUInt16LE(dia, 12);
    cabecera.writeUInt32LE(crc, 14);
    cabecera.writeUInt32LE(datos.length, 18); // tamaño comprimido
    cabecera.writeUInt32LE(datos.length, 22); // tamaño original
    cabecera.writeUInt16LE(nombre.length, 26);
    cabecera.writeUInt16LE(0, 28);            // sin campo extra

    trozos.push(cabecera, nombre, datos);

    // Entrada equivalente en el directorio central
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);                // versión con la que se creó
    dir.writeUInt16LE(20, 6);                // versión necesaria
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(hora, 12);
    dir.writeUInt16LE(dia, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(datos.length, 20);
    dir.writeUInt32LE(datos.length, 24);
    dir.writeUInt16LE(nombre.length, 28);
    dir.writeUInt16LE(0, 30);                // extra
    dir.writeUInt16LE(0, 32);                // comentario
    dir.writeUInt16LE(0, 34);                // disco
    dir.writeUInt16LE(0, 36);                // atributos internos
    dir.writeUInt32LE(0, 38);                // atributos externos
    dir.writeUInt32LE(desplazamiento, 42);   // dónde empieza su cabecera local
    central.push(dir, nombre);

    desplazamiento += cabecera.length + nombre.length + datos.length;
  });

  const directorio = Buffer.concat(central);

  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(0, 4);                   // número de disco
  fin.writeUInt16LE(0, 6);                   // disco del directorio
  fin.writeUInt16LE(entradas.length, 8);     // entradas en este disco
  fin.writeUInt16LE(entradas.length, 10);    // entradas en total
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);     // dónde empieza el directorio
  fin.writeUInt16LE(0, 20);                  // sin comentario

  return Buffer.concat([...trozos, directorio, fin]);
}

module.exports = { crearZip, crc32 };
