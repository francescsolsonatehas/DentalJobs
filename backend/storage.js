// Almacenamiento externo OPCIONAL para el contenido de `archivos` (logo, fotos,
// CV, Book, adjuntos de chat). Sin configurar nada, todo sigue guardándose como
// BLOB en la propia BD, igual que siempre: es el comportamiento por defecto y el
// único que corre en desarrollo/tests.
//
// Rellenando estas cuatro variables de entorno (ver .env.example) se activa un
// backend S3-compatible (Cloudflare R2, AWS S3, etc.): el contenido se sube ahí y
// en la fila de `archivos` solo queda una referencia (storage_key). La columna
// `contenido` sigue siendo NOT NULL, así que en ese caso se deja un buffer vacío:
// nunca se lee (ver `leer`), es solo para no romper la restricción de la tabla.
//
// Por qué importa: los archivos se guardaban enteros como BLOB en SQLite/Turso, y
// Turso cobra por almacenamiento — con esto el tamaño de la BD deja de crecer con
// cada foto/CV/Book que se sube.
const crypto = require("crypto");

function habilitado() {
  return !!(
    process.env.S3_ENDPOINT &&
    process.env.S3_BUCKET &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  );
}

let _cliente = null;
let _bucket = null;
function cliente() {
  if (_cliente) return _cliente;
  const { S3Client } = require("@aws-sdk/client-s3");
  _bucket = process.env.S3_BUCKET;
  _cliente = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
    }
  });
  return _cliente;
}

// Sube `buffer` al storage externo si está configurado, y devuelve lo que hay que
// guardar en la fila de `archivos`. Sin storage externo, devuelve el propio buffer
// para que se guarde como BLOB, igual que antes de que existiera este módulo.
async function guardar(usuarioId, tipo, buffer) {
  if (!habilitado()) return { contenido: buffer, storageKey: null };

  const { PutObjectCommand } = require("@aws-sdk/client-s3");
  const key = `${usuarioId}/${tipo}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  await cliente().send(new PutObjectCommand({ Bucket: _bucket, Key: key, Body: buffer }));
  return { contenido: Buffer.alloc(0), storageKey: key };
}

// Lee el contenido real de una fila de `archivos` (con storage_key si se subió al
// storage externo, o su BLOB si no).
async function leer(fila) {
  if (!fila || !fila.storage_key) return fila ? fila.contenido : null;

  const { GetObjectCommand } = require("@aws-sdk/client-s3");
  const r = await cliente().send(new GetObjectCommand({ Bucket: _bucket, Key: fila.storage_key }));
  const trozos = [];
  for await (const trozo of r.Body) trozos.push(trozo);
  return Buffer.concat(trozos);
}

// Borra el objeto externo de una fila, si lo tiene. Best-effort: un fallo aquí no
// debe impedir borrar la fila de la BD (un objeto huérfano en el bucket no rompe
// nada; una fila que no se puede borrar sí sería un problema).
async function borrar(fila) {
  if (!fila || !fila.storage_key) return;
  try {
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    await cliente().send(new DeleteObjectCommand({ Bucket: _bucket, Key: fila.storage_key }));
  } catch (e) {
    console.error("Error al borrar del storage externo:", e.message);
  }
}

module.exports = { habilitado, guardar, leer, borrar };
