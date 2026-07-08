// Adaptador de @libsql/client al API de callbacks de sqlite3 que usa todo el
// proyecto (db.run / db.get / db.all / db.serialize / db.prepare).
//
// - Sin TURSO_DATABASE_URL usa un archivo local (desarrollo y tests): mismo
//   dialecto SQLite de siempre.
// - Con TURSO_DATABASE_URL + TURSO_AUTH_TOKEN se conecta a Turso (producción).
// - Todas las operaciones pasan por una cola secuencial, igual que la conexión
//   única de sqlite3, así el orden de creación de esquema y consultas se
//   mantiene.
const path = require("path");
const { createClient } = require("@libsql/client");

function crearDb() {
  // Turso solo en producción: en desarrollo y tests siempre archivo local,
  // aunque el .env tenga las credenciales (evita tocar datos reales por error).
  const usarTurso = process.env.TURSO_DATABASE_URL && process.env.NODE_ENV === "production";
  const url = usarTurso
    ? process.env.TURSO_DATABASE_URL
    : "file:" + (process.env.DB_PATH || path.join(__dirname, "dental_jobs.db"));

  console.log(
    usarTurso
      ? `💾 Conectando a Turso (persistente): ${url}`
      : `💾 Usando SQLite local (NODE_ENV="${process.env.NODE_ENV}", TURSO_DATABASE_URL=${process.env.TURSO_DATABASE_URL ? "definida" : "no definida"}) — los datos NO sobreviven al redeploy`
  );

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    intMode: "number"
  });

  // Cola secuencial de operaciones
  let cola = Promise.resolve();
  function encolar(fn) {
    const resultado = cola.then(fn);
    cola = resultado.catch(() => {}); // la cola sigue viva aunque falle una operación
    return resultado;
  }

  function normalizar(params, cb) {
    if (typeof params === "function") return [[], params];
    // sqlite3 trataba undefined como NULL; libsql lo rechaza, así que lo convertimos
    const args = (params || []).map(v => (v === undefined ? null : v));
    return [args, cb];
  }

  function filaAObjeto(columnas, fila) {
    const obj = {};
    columnas.forEach((col, i) => {
      let v = fila[i];
      if (v instanceof ArrayBuffer) v = Buffer.from(v);
      obj[col] = v;
    });
    return obj;
  }

  const db = {
    run(sql, params, cb) {
      const [args, callback] = normalizar(params, cb);
      encolar(() => client.execute({ sql, args }))
        .then(r => {
          if (callback) {
            callback.call(
              { lastID: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected ?? 0 },
              null
            );
          }
        })
        .catch(err => {
          if (callback) callback(err);
          else console.error("Error SQL sin callback:", err.message);
        });
      return db;
    },

    get(sql, params, cb) {
      const [args, callback] = normalizar(params, cb);
      encolar(() => client.execute({ sql, args }))
        .then(r => callback && callback(null, r.rows.length > 0 ? filaAObjeto(r.columns, r.rows[0]) : undefined))
        .catch(err => callback && callback(err));
      return db;
    },

    all(sql, params, cb) {
      const [args, callback] = normalizar(params, cb);
      encolar(() => client.execute({ sql, args }))
        .then(r => callback && callback(null, r.rows.map(fila => filaAObjeto(r.columns, fila))))
        .catch(err => callback && callback(err));
      return db;
    },

    // Con la cola secuencial el orden ya está garantizado
    serialize(fn) {
      if (fn) fn();
    },

    prepare(sql) {
      return {
        run(...args) {
          let cb;
          if (typeof args[args.length - 1] === "function") cb = args.pop();
          db.run(sql, args, cb);
        },
        finalize(cb) {
          // Esperar a que se vacíe la cola antes de avisar
          encolar(() => Promise.resolve())
            .then(() => cb && cb(null))
            .catch(err => cb && cb(err));
        }
      };
    },

    close(cb) {
      encolar(() => Promise.resolve())
        .then(() => { client.close(); if (cb) cb(null); })
        .catch(err => cb && cb(err));
    }
  };

  return db;
}

module.exports = { crearDb };
