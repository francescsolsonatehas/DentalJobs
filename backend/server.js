const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const path = require("path");
const db = require("./db");
const { verifyToken, generateToken } = require("./middleware/auth");

const app = express();

// Detrás de un proxy (Render, Caddy…) la IP real llega en X-Forwarded-For
app.set("trust proxy", 1);

// CSP desactivada: el frontend actual usa estilos y manejadores onclick inline
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json());
app.use(cors());
app.use(morgan("short"));
app.use(express.static(path.join(__dirname, "../frontend")));

// Rate limiting: estricto en login/registro (anti fuerza bruta), laxo global.
// En tests se desactiva para no interferir con las ráfagas de peticiones.
const esEntornoTest = () => process.env.NODE_ENV === "test";
const limiterAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: esEntornoTest,
  message: { error: "Demasiados intentos. Espera unos minutos y vuelve a probar." }
});
const limiterGlobal = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: esEntornoTest,
  message: { error: "Demasiadas peticiones. Espera un momento." }
});
app.use(limiterGlobal);
app.use("/auth/login", limiterAuth);
app.use("/auth/registro", limiterAuth);

// Configurar multer para uploads en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB máximo
  }
});

/* ===========================
   🔹 AUTH
=========================== */

app.post("/auth/registro", (req, res) => {
  const { nombre, email, password, tipo, telefono, direccion, codigo_postal, pais } = req.body;

  if (!nombre || !email || !tipo) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  if (!["clinica", "dentista"].includes(tipo)) {
    return res.status(400).json({ error: "Tipo de usuario inválido" });
  }

  if (!password || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
  }

  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.run(
      "INSERT INTO usuarios (nombre, email, password, tipo, telefono, direccion, codigo_postal, pais) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [nombre, email, hashedPassword, tipo, telefono || null, direccion || null, codigo_postal || null, pais || null],
      function(err) {
        if (err) {
          if (err.message.includes("UNIQUE")) {
            return res.status(400).json({ error: "Email ya registrado" });
          }
          console.error(err);
          return res.status(500).json({ error: "Error al registrar usuario" });
        }

        const usuario = {
          id: this.lastID,
          nombre,
          email,
          tipo
        };
        const token = generateToken(usuario);

        res.json({ mensaje: "Usuario registrado", token, usuario });
      }
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar usuario" });
  }
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email requerido" });
  }

  // password puede ser vacía (string vacío "")

  db.get("SELECT * FROM usuarios WHERE email = ?", [email], (err, usuario) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error en login" });
    }

    if (!usuario) {
      return res.status(400).json({ error: "Email o contraseña incorrectos" });
    }

    // Si la contraseña guardada es vacía, solo permitir login con contraseña vacía
    const esValido = usuario.password === ""
      ? password === ""
      : bcrypt.compareSync(password, usuario.password);

    if (!esValido) {
      return res.status(400).json({ error: "Email o contraseña incorrectos" });
    }

    const token = generateToken(usuario);
    res.json({
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, tipo: usuario.tipo }
    });
  });
});

app.put("/auth/actualizar-perfil", verifyToken, (req, res) => {
  const { nombre, telefono, movil, direccion, codigo_postal, pais, ciudad, descripcion, anyos_experiencia } = req.body;
  const usuarioId = req.usuario.id;

  if (!nombre) {
    return res.status(400).json({ error: "El nombre es obligatorio" });
  }

  const experiencia = anyos_experiencia !== undefined && anyos_experiencia !== null && anyos_experiencia !== ''
    ? parseInt(anyos_experiencia)
    : null;

  db.run(
    "UPDATE usuarios SET nombre = ?, telefono = ?, movil = ?, direccion = ?, codigo_postal = ?, pais = ?, ciudad = ?, descripcion = ?, anyos_experiencia = ? WHERE id = ?",
    [nombre, telefono || null, movil || null, direccion || null, codigo_postal || null, pais || null, ciudad || null, (descripcion || "").trim() || null, experiencia, usuarioId],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al actualizar perfil" });
      }

      res.json({
        success: true,
        message: "Perfil actualizado correctamente"
      });
    }
  );
});

app.get("/auth/mi-especialidades", verifyToken, (req, res) => {
  const usuarioId = req.usuario.id;

  db.all(
    "SELECT especialidad_id FROM usuario_especialidades WHERE usuario_id = ?",
    [usuarioId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener especialidades" });
      }

      const especialidadIds = rows.map(r => r.especialidad_id);
      res.json({ especialidades: especialidadIds });
    }
  );
});

app.post("/auth/guardar-especialidades", verifyToken, (req, res) => {
  const { especialidades } = req.body;
  const usuarioId = req.usuario.id;

  if (!Array.isArray(especialidades)) {
    return res.status(400).json({ error: "Especialidades debe ser un array" });
  }

  // Eliminar todas las especialidades actuales
  db.run(
    "DELETE FROM usuario_especialidades WHERE usuario_id = ?",
    [usuarioId],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al guardar especialidades" });
      }

      // Insertar las nuevas especialidades
      if (especialidades.length === 0) {
        return res.json({ success: true, message: "Especialidades guardadas" });
      }

      const stmt = db.prepare(
        "INSERT INTO usuario_especialidades (usuario_id, especialidad_id) VALUES (?, ?)"
      );

      especialidades.forEach(espId => {
        stmt.run(usuarioId, espId);
      });

      stmt.finalize((err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al guardar especialidades" });
        }

        res.json({ success: true, message: "Especialidades guardadas correctamente" });
      });
    }
  );
});

app.put("/auth/cambiar-password", verifyToken, (req, res) => {
  const { passwordActual, passwordNueva } = req.body;
  const usuarioId = req.usuario.id;

  if (!passwordNueva || typeof passwordNueva !== "string" || passwordNueva.length < 8) {
    return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres" });
  }

  // passwordActual puede ser vacía (cuentas antiguas creadas sin contraseña)

  // Obtener usuario actual
  db.get("SELECT password FROM usuarios WHERE id = ?", [usuarioId], (err, usuario) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al cambiar contraseña" });
    }

    if (!usuario) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // Verificar contraseña actual
    // Si password guardada es vacía, solo permite si passwordActual también es vacío
    const esValida = usuario.password === ""
      ? passwordActual === ""
      : bcrypt.compareSync(passwordActual, usuario.password);

    if (!esValida) {
      return res.status(400).json({ error: "Contraseña actual incorrecta" });
    }

    const hashedPassword = bcrypt.hashSync(passwordNueva, 10);

    // Actualizar contraseña
    db.run(
      "UPDATE usuarios SET password = ? WHERE id = ?",
      [hashedPassword, usuarioId],
      (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al cambiar contraseña" });
        }

        res.json({ success: true, message: "Contraseña actualizada correctamente" });
      }
    );
  });
});

app.post("/auth/solicitar-cambio-email", verifyToken, (req, res) => {
  const { nuevoEmail, datos } = req.body;
  const usuarioId = req.usuario.id;

  if (!nuevoEmail) {
    return res.status(400).json({ error: "Email requerido" });
  }

  // Verificar que el nuevo email no esté en uso
  db.get("SELECT id FROM usuarios WHERE email = ? AND id != ?", [nuevoEmail, usuarioId], (err, usuario) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al verificar email" });
    }

    if (usuario) {
      return res.status(400).json({ error: "Este email ya está registrado" });
    }

    // Generar token de confirmación
    const token = require('crypto').randomBytes(32).toString('hex');
    const expiracion = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    // Guardar token en BD
    db.run(
      "INSERT INTO confirmacion_email (usuario_id, nuevo_email, token, expiracion, datos) VALUES (?, ?, ?, ?, ?)",
      [usuarioId, nuevoEmail, token, expiracion.toISOString(), JSON.stringify(datos)],
      function(err) {
        if (err) {
          console.error("Error al insertar token:", err);
          // Intentar crear la tabla si no existe
          db.run(`
            CREATE TABLE IF NOT EXISTS confirmacion_email (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              usuario_id INTEGER REFERENCES usuarios(id),
              nuevo_email TEXT NOT NULL,
              token TEXT UNIQUE NOT NULL,
              datos TEXT,
              expiracion DATETIME NOT NULL,
              creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `, (createErr) => {
            if (createErr) {
              console.error(createErr);
              return res.status(500).json({ error: "Error al procesar cambio de email" });
            }

            // Reintentar insert
            db.run(
              "INSERT INTO confirmacion_email (usuario_id, nuevo_email, token, expiracion, datos) VALUES (?, ?, ?, ?, ?)",
              [usuarioId, nuevoEmail, token, expiracion.toISOString(), JSON.stringify(datos)],
              function(err) {
                if (err) {
                  console.error(err);
                  return res.status(500).json({ error: "Error al procesar cambio de email" });
                }

                res.json({
                  success: true,
                  message: "Email de confirmación enviado",
                  token: token // Retornar token para desarrollo
                });
              }
            );
          });
        } else {
          res.json({
            success: true,
            message: "Email de confirmación enviado",
            token: token // Retornar token para desarrollo
          });
        }
      }
    );
  });
});

app.get("/auth/mi-perfil", verifyToken, (req, res) => {
  const usuarioId = req.usuario.id;

  db.get(
    "SELECT id, nombre, email, tipo, telefono, movil, direccion, codigo_postal, pais, ciudad, descripcion, anyos_experiencia, creado_en FROM usuarios WHERE id = ?",
    [usuarioId],
    (err, usuario) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener perfil" });
      }

      if (!usuario) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      res.json(usuario);
    }
  );
});

// CV del dentista en PDF, generado a partir de su perfil
app.get("/auth/mi-cv.pdf", verifyToken, async (req, res) => {
  if (req.usuario.tipo !== "dentista") {
    return res.status(403).json({ error: "El CV en PDF solo está disponible para dentistas" });
  }

  const get = (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (e, r) => e ? reject(e) : resolve(r)));
  const all = (sql, params) => new Promise((resolve, reject) => db.all(sql, params, (e, r) => e ? reject(e) : resolve(r)));

  try {
    const usuario = await get(
      "SELECT nombre, email, telefono, movil, ciudad, direccion, codigo_postal, pais, descripcion, anyos_experiencia FROM usuarios WHERE id = ?",
      [req.usuario.id]
    );
    if (!usuario) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const especialidades = await all(
      `SELECT e.nombre FROM especialidades e
       INNER JOIN usuario_especialidades ue ON e.id = ue.especialidad_id
       WHERE ue.usuario_id = ? ORDER BY e.nombre`,
      [req.usuario.id]
    );
    const resenyas = await get(
      "SELECT COUNT(*) as total, AVG(puntuacion) as media FROM resenyas WHERE destinatario_id = ?",
      [req.usuario.id]
    );
    const solicitudes = await all(
      `SELECT ciudad, descripcion, contrato, jornada, creado_en FROM publicaciones
       WHERE usuario_id = ? AND tipo = 'solicitud' AND activo = 1 ORDER BY creado_en DESC`,
      [req.usuario.id]
    );

    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({ margin: 50, size: "A4" });

    const nombreArchivo = (usuario.nombre || "dentista").replace(/[^\wáéíóúüñÁÉÍÓÚÜÑ\s-]/g, "").trim().replace(/\s+/g, "-");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="CV-${nombreArchivo}.pdf"`);
    doc.pipe(res);

    const azul = "#0f4c75";
    const gris = "#4b5563";

    // Cabecera
    doc.fillColor(azul).fontSize(26).font("Helvetica-Bold").text(usuario.nombre);
    doc.fillColor(gris).fontSize(12).font("Helvetica").text("Dentista", { paragraphGap: 4 });

    const contacto = [
      usuario.email,
      usuario.movil || usuario.telefono,
      [usuario.ciudad, usuario.pais].filter(Boolean).join(", ")
    ].filter(Boolean).join("  ·  ");
    doc.fontSize(10).text(contacto);

    if (resenyas && resenyas.total > 0) {
      const media = Math.round(resenyas.media * 10) / 10;
      doc.moveDown(0.3);
      doc.fillColor("#b45309").fontSize(10)
        .text(`Valoración media: ${media}/5 (${resenyas.total} reseña${resenyas.total === 1 ? "" : "s"} en DentalJobs)`);
    }

    doc.moveDown(0.5);
    doc.strokeColor(azul).lineWidth(1.5)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .stroke();
    doc.moveDown();

    const seccion = (titulo) => {
      doc.moveDown(0.5);
      doc.fillColor(azul).fontSize(14).font("Helvetica-Bold").text(titulo);
      doc.moveDown(0.3);
      doc.fillColor("#1f2937").fontSize(11).font("Helvetica");
    };

    if (usuario.descripcion) {
      seccion("Perfil");
      doc.text(usuario.descripcion, { lineGap: 2 });
    }

    if (usuario.anyos_experiencia !== null && usuario.anyos_experiencia !== undefined) {
      seccion("Experiencia");
      doc.text(`${usuario.anyos_experiencia} año${usuario.anyos_experiencia === 1 ? "" : "s"} de experiencia profesional`);
    }

    if (especialidades.length > 0) {
      seccion("Especialidades");
      especialidades.forEach(e => doc.text(`•  ${e.nombre}`));
    }

    if (solicitudes.length > 0) {
      seccion("Busco trabajo como");
      solicitudes.forEach(s => {
        const detalles = [s.contrato, s.jornada].filter(Boolean).join(" · ");
        doc.font("Helvetica-Bold").text(`${s.ciudad}${detalles ? ` (${detalles})` : ""}`);
        if (s.descripcion) {
          doc.font("Helvetica").fillColor(gris).text(s.descripcion, { lineGap: 1 });
          doc.fillColor("#1f2937");
        }
        doc.moveDown(0.4);
      });
    }

    // Pie de página
    doc.moveDown(1.5);
    doc.fillColor("#9ca3af").fontSize(8)
      .text(`CV generado automáticamente por DentalJobs el ${new Date().toLocaleDateString("es-ES")}`, { align: "center" });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar el CV" });
  }
});

// Perfil público de un usuario (datos no sensibles, para mostrar en fichas)
app.get("/usuarios/:id/publico", (req, res) => {
  db.get(
    "SELECT id, nombre, tipo, ciudad, pais, descripcion, anyos_experiencia, creado_en FROM usuarios WHERE id = ?",
    [req.params.id],
    (err, usuario) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener perfil" });
      }
      if (!usuario) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }
      res.json(usuario);
    }
  );
});

app.get("/auth/confirmar-cambio-email/:token", (req, res) => {
  const { token } = req.params;

  db.get(
    "SELECT * FROM confirmacion_email WHERE token = ? AND expiracion > datetime('now')",
    [token],
    (err, confirmacion) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al confirmar email" });
      }

      if (!confirmacion) {
        return res.status(400).json({ error: "Token inválido o expirado" });
      }

      const datos = JSON.parse(confirmacion.datos);

      // Actualizar usuario con nuevo email y otros datos
      db.run(
        "UPDATE usuarios SET email = ?, nombre = ?, telefono = ?, direccion = ?, codigo_postal = ?, pais = ? WHERE id = ?",
        [confirmacion.nuevo_email, datos.nombre, datos.telefono, datos.direccion, datos.codigo_postal, datos.pais, confirmacion.usuario_id],
        function(err) {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Error al actualizar email" });
          }

          // Eliminar token usado
          db.run("DELETE FROM confirmacion_email WHERE id = ?", [confirmacion.id]);

          res.json({
            success: true,
            message: "Email confirmado y actualizado correctamente"
          });
        }
      );
    }
  );
});

/* ===========================
   🔹 ESPECIALIDADES
=========================== */

app.get("/especialidades", (req, res) => {
  db.all("SELECT * FROM especialidades ORDER BY nombre", (err, especialidades) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al obtener especialidades" });
    }
    res.json(especialidades);
  });
});

/* ===========================
   🔹 PUBLICACIONES
=========================== */

app.get("/publicaciones", (req, res) => {
  const { tipo, especialidad, ciudad, usuario_id, contrato, jornada, salarioMin, experienciaMin, sort, paraUsuarioId } = req.query;

  let selectCols = "p.*, u.nombre as usuario_nombre, u.tipo as usuario_tipo, u.email as usuario_email, u.telefono as usuario_telefono, u.ciudad as usuario_ciudad";
  const selectParams = [];

  const usarRelevancia = sort === 'relevancia' && paraUsuarioId;
  if (usarRelevancia) {
    selectCols += `, CASE WHEN EXISTS (
      SELECT 1 FROM publicaciones v
      WHERE v.usuario_id = ? AND v.tipo != p.tipo AND v.activo = 1
      AND (v.ciudad = p.ciudad OR v.ciudad LIKE '%' || p.ciudad || '%' OR p.ciudad LIKE '%' || v.ciudad || '%')
      AND (
        NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
        OR NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = v.id)
        OR EXISTS (
          SELECT 1 FROM publicacion_especialidades pev
          INNER JOIN publicacion_especialidades pep ON pev.especialidad_id = pep.especialidad_id
          WHERE pev.publicacion_id = v.id AND pep.publicacion_id = p.id
        )
      )
    ) THEN 1 ELSE 0 END as relevancia_score`;
    selectParams.push(paraUsuarioId);
  }

  let query = `SELECT ${selectCols} FROM publicaciones p LEFT JOIN usuarios u ON p.usuario_id = u.id WHERE p.activo = 1`;
  const params = [...selectParams];

  if (tipo) {
    query += " AND p.tipo = ?";
    params.push(tipo);
  }

  if (usuario_id) {
    query += " AND p.usuario_id = ?";
    params.push(usuario_id);
  }

  if (ciudad) {
    query += " AND p.ciudad LIKE ?";
    params.push(`%${ciudad}%`);
  }

  if (contrato) {
    query += " AND p.contrato = ?";
    params.push(contrato);
  }

  if (jornada) {
    query += " AND p.jornada = ?";
    params.push(jornada);
  }

  if (especialidad) {
    query += " AND EXISTS (SELECT 1 FROM publicacion_especialidades pe WHERE pe.publicacion_id = p.id AND pe.especialidad_id = ?)";
    params.push(especialidad);
  }

  if (salarioMin) {
    query += " AND p.salario_min >= ?";
    params.push(parseInt(salarioMin));
  }

  if (experienciaMin) {
    if (tipo === 'solicitud') {
      // Dentistas con al menos esta experiencia
      query += " AND p.experiencia_minima >= ?";
    } else {
      // Ofertas que exigen como máximo esta experiencia (el dentista sí califica)
      query += " AND p.experiencia_minima <= ?";
    }
    params.push(parseInt(experienciaMin));
  }

  if (sort === 'salario') {
    query += " ORDER BY p.salario_min DESC, p.creado_en DESC";
  } else if (sort === 'ciudad') {
    query += " ORDER BY p.ciudad ASC, p.creado_en DESC";
  } else if (usarRelevancia) {
    query += " ORDER BY relevancia_score DESC, p.creado_en DESC";
  } else {
    query += " ORDER BY p.creado_en DESC";
  }

  const limit = Math.min(parseInt(req.query.limit) || 20, 500);
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  query += " LIMIT ? OFFSET ?";
  params.push(limit, (page - 1) * limit);

  db.all(query, params, (err, publicaciones) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al obtener publicaciones" });
    }
    res.json(publicaciones);
  });
});

app.get("/publicaciones/contactadas/:usuario_id", verifyToken, (req, res) => {
  db.all(
    `SELECT DISTINCT p.*, u.nombre as usuario_nombre, u.tipo as usuario_tipo, u.email as usuario_email, u.telefono as usuario_telefono, u.ciudad as usuario_ciudad FROM publicaciones p
     INNER JOIN mensajes m ON p.id = m.publicacion_id
     LEFT JOIN usuarios u ON p.usuario_id = u.id
     WHERE m.usuario_id = ? AND p.tipo = 'solicitud'
     ORDER BY p.creado_en DESC`,
    [req.params.usuario_id],
    (err, publicaciones) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener solicitudes contactadas" });
      }
      res.json(publicaciones || []);
    }
  );
});

app.get("/publicaciones/:id", (req, res) => {
  db.get(
    "SELECT * FROM publicaciones WHERE id = ? AND activo = 1",
    [req.params.id],
    (err, pub) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener publicación" });
      }
      if (!pub) {
        return res.status(404).json({ error: "Publicación no encontrada" });
      }
      res.json(pub);
    }
  );
});

// Obtener ofertas del usuario con conteo de candidatos
app.get("/publicaciones/usuario/:usuario_id/candidatos", verifyToken, (req, res) => {
  const usuario_id = req.params.usuario_id;

  db.all(
    `SELECT p.id as publicacion_id, COUNT(c.id) as candidatos_count
     FROM publicaciones p
     LEFT JOIN candidaturas c ON p.id = c.publicacion_id
     WHERE p.usuario_id = ? AND p.tipo = 'oferta' AND p.activo = 1
     GROUP BY p.id`,
    [usuario_id],
    (err, ofertas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener ofertas" });
      }
      res.json({ ofertas: ofertas || [] });
    }
  );
});

// Comprueba las búsquedas guardadas del mismo tipo que la publicación recién creada
// y genera una alerta para cada una cuyos criterios coincidan.
function generarAlertasParaPublicacion(publicacionId, tipo, ciudad, especialidadIds, contrato, jornada, salarioMin, experienciaMinima) {
  db.all(
    "SELECT * FROM busquedas_guardadas WHERE tipo = ?",
    [tipo],
    (err, busquedas) => {
      if (err || !busquedas) {
        if (err) console.error(err);
        return;
      }

      const coinciden = busquedas.filter(b => {
        if (b.ciudad && !(ciudad.toLowerCase().includes(b.ciudad.toLowerCase()) || b.ciudad.toLowerCase().includes(ciudad.toLowerCase()))) {
          return false;
        }
        if (b.especialidad_id && !especialidadIds.includes(b.especialidad_id)) {
          return false;
        }
        if (b.contrato && b.contrato !== contrato) {
          return false;
        }
        if (b.jornada && b.jornada !== jornada) {
          return false;
        }
        if (b.salario_min && (salarioMin === null || salarioMin < b.salario_min)) {
          return false;
        }
        if (b.experiencia_minima !== null && b.experiencia_minima !== undefined && experienciaMinima !== null) {
          if (tipo === 'oferta' && experienciaMinima > b.experiencia_minima) {
            return false; // la oferta exige más experiencia de la que tiene quien busca
          }
          if (tipo === 'solicitud' && experienciaMinima < b.experiencia_minima) {
            return false; // el dentista tiene menos experiencia de la buscada
          }
        }
        return true;
      });

      if (coinciden.length === 0) return;

      const stmt = db.prepare("INSERT INTO alertas (usuario_id, busqueda_guardada_id, publicacion_id) VALUES (?, ?, ?)");
      coinciden.forEach(b => {
        stmt.run(b.usuario_id, b.id, publicacionId);
      });
      stmt.finalize();
    }
  );
}

app.post("/publicaciones", verifyToken, (req, res) => {
  const { tipo, descripcion, ciudad, especialidades, contrato, jornada, salario, experiencia, nombre_contacto, email_contacto, telefono_contacto, sede_id } = req.body;

  if (!tipo || !ciudad) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  // Validar tipo de usuario vs tipo de publicación
  const tipoUsuario = req.usuario.tipo;
  if ((tipoUsuario === 'clinica' && tipo !== 'oferta') || (tipoUsuario === 'dentista' && tipo !== 'solicitud')) {
    return res.status(403).json({ error: "No puedes crear este tipo de publicación" });
  }

  const salarioMatch = (salario || '').match(/\d+/);
  const salarioMin = salarioMatch ? parseInt(salarioMatch[0]) : null;
  const experienciaMinima = experiencia !== undefined && experiencia !== '' ? parseInt(experiencia) : null;

  const insertarPublicacion = (sedeIdValidada) => {
    db.run(
      `INSERT INTO publicaciones
       (tipo, descripcion, ciudad, especialidad_id, contrato, jornada, salario, salario_min, experiencia_minima, usuario_id, nombre_contacto, email_contacto, telefono_contacto, sede_id)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tipo, descripcion, ciudad, contrato || null, jornada || null, salario || null, salarioMin, experienciaMinima, req.usuario.id, nombre_contacto, email_contacto, telefono_contacto, sedeIdValidada],
      function(err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al crear publicación" });
        }

        const publicacionId = this.lastID;

        // Guardar especialidades si se proporcionan
        if (Array.isArray(especialidades) && especialidades.length > 0) {
          const stmt = db.prepare("INSERT INTO publicacion_especialidades (publicacion_id, especialidad_id) VALUES (?, ?)");
          especialidades.forEach(eId => {
            stmt.run(publicacionId, eId);
          });
          stmt.finalize();
        }

        generarAlertasParaPublicacion(publicacionId, tipo, ciudad, especialidades || [], contrato, jornada, salarioMin, experienciaMinima);

        res.json({
          mensaje: "Publicación creada",
          id: publicacionId
        });
      }
    );
  };

  if (sede_id) {
    db.get("SELECT usuario_id FROM sedes WHERE id = ?", [sede_id], (err, sede) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al crear publicación" });
      }
      if (!sede || sede.usuario_id !== req.usuario.id) {
        return res.status(403).json({ error: "La sede indicada no es tuya" });
      }
      insertarPublicacion(sede_id);
    });
  } else {
    insertarPublicacion(null);
  }
});

// Registrar una vista de la publicación (lo llama el frontend cuando alguien que no es el dueño abre el detalle)
app.post("/publicaciones/:id/vista", (req, res) => {
  db.run(
    "UPDATE publicaciones SET vistas = COALESCE(vistas, 0) + 1 WHERE id = ? AND activo = 1",
    [req.params.id],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al registrar vista" });
      }
      res.json({ success: true });
    }
  );
});

// Panel de estadísticas de una publicación (solo el dueño): vistas, postulantes y tiempo medio de respuesta
app.get("/publicaciones/:id/estadisticas", verifyToken, (req, res) => {
  const publicacionId = req.params.id;

  db.get("SELECT usuario_id, vistas FROM publicaciones WHERE id = ?", [publicacionId], (err, pub) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al obtener estadísticas" });
    }
    if (!pub) {
      return res.status(404).json({ error: "Publicación no encontrada" });
    }
    if (pub.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "Solo el dueño puede ver las estadísticas" });
    }

    db.get(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN estado = 'pendiente' THEN 1 ELSE 0 END) as pendientes,
              SUM(CASE WHEN estado = 'aceptada' THEN 1 ELSE 0 END) as aceptadas,
              SUM(CASE WHEN estado = 'rechazada' THEN 1 ELSE 0 END) as rechazadas,
              SUM(CASE WHEN estado = 'retirada' THEN 1 ELSE 0 END) as retiradas,
              AVG(CASE WHEN estado != 'pendiente' AND actualizado_en > creado_en
                  THEN julianday(actualizado_en) - julianday(creado_en) END) as tiempo_medio_respuesta_dias
       FROM candidaturas
       WHERE publicacion_id = ?`,
      [publicacionId],
      (err, stats) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al obtener estadísticas" });
        }

        res.json({
          vistas: pub.vistas || 0,
          postulantes: {
            total: stats.total || 0,
            pendientes: stats.pendientes || 0,
            aceptadas: stats.aceptadas || 0,
            rechazadas: stats.rechazadas || 0,
            retiradas: stats.retiradas || 0
          },
          tiempo_medio_respuesta_dias: stats.tiempo_medio_respuesta_dias !== null && stats.tiempo_medio_respuesta_dias !== undefined
            ? Math.round(stats.tiempo_medio_respuesta_dias * 10) / 10
            : null
        });
      }
    );
  });
});

app.get("/publicaciones/:id/especialidades", (req, res) => {
  const publicacionId = req.params.id;

  db.all(
    `SELECT e.id, e.nombre FROM especialidades e
     INNER JOIN publicacion_especialidades pe ON e.id = pe.especialidad_id
     WHERE pe.publicacion_id = ?
     UNION
     SELECT e.id, e.nombre FROM especialidades e
     INNER JOIN publicaciones p ON p.especialidad_id = e.id
     WHERE p.id = ? AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = ?)`,
    [publicacionId, publicacionId, publicacionId],
    (err, especialidades) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener especialidades" });
      }
      res.json({ especialidades: especialidades || [] });
    }
  );
});

app.post("/publicaciones/:id/especialidades", verifyToken, (req, res) => {
  const { especialidades } = req.body;
  const publicacionId = req.params.id;

  if (!Array.isArray(especialidades)) {
    return res.status(400).json({ error: "Especialidades debe ser un array" });
  }

  // Verificar que la publicación pertenece al usuario
  db.get("SELECT usuario_id FROM publicaciones WHERE id = ?", [publicacionId], (err, pub) => {
    if (err || !pub) {
      return res.status(404).json({ error: "Publicación no encontrada" });
    }

    if (pub.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para modificar esta publicación" });
    }

    if (especialidades.length === 0) {
      return res.json({ success: true });
    }

    const stmt = db.prepare(
      "INSERT INTO publicacion_especialidades (publicacion_id, especialidad_id) VALUES (?, ?)"
    );

    especialidades.forEach(espId => {
      stmt.run(publicacionId, espId);
    });

    stmt.finalize((err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al guardar especialidades" });
      }

      res.json({ success: true });
    });
  });
});

app.put("/publicaciones/:id", verifyToken, (req, res) => {
  const { descripcion, ciudad, especialidades, contrato, jornada, salario, experiencia, nombre_contacto, email_contacto, telefono_contacto } = req.body;
  const publicacionId = req.params.id;

  db.get("SELECT usuario_id FROM publicaciones WHERE id = ?", [publicacionId], (err, pub) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al actualizar publicación" });
    }

    if (!pub) {
      return res.status(404).json({ error: "Publicación no encontrada" });
    }

    if (pub.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para modificar esta publicación" });
    }

    const salarioMatch = (salario || '').match(/\d+/);
    const salarioMin = salarioMatch ? parseInt(salarioMatch[0]) : null;
    const experienciaMinima = experiencia !== undefined && experiencia !== '' ? parseInt(experiencia) : null;

    db.run(
      `UPDATE publicaciones
       SET descripcion = ?, ciudad = ?, contrato = ?, jornada = ?, salario = ?, salario_min = ?, experiencia_minima = ?,
           nombre_contacto = ?, email_contacto = ?, telefono_contacto = ?
       WHERE id = ?`,
      [descripcion, ciudad, contrato || null, jornada || null, salario || null, salarioMin, experienciaMinima,
       nombre_contacto, email_contacto, telefono_contacto || null, publicacionId],
      function(err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al actualizar publicación" });
        }

        // Actualizar especialidades si se envían
        if (Array.isArray(especialidades) && especialidades.length > 0) {
          db.run("DELETE FROM publicacion_especialidades WHERE publicacion_id = ?", [publicacionId], (delErr) => {
            if (delErr) {
              console.error(delErr);
              return res.status(500).json({ error: "Error al actualizar especialidades" });
            }

            const stmt = db.prepare("INSERT INTO publicacion_especialidades (publicacion_id, especialidad_id) VALUES (?, ?)");
            especialidades.forEach(eId => {
              stmt.run(publicacionId, eId);
            });
            stmt.finalize();

            res.json({ mensaje: "Publicación actualizada" });
          });
        } else {
          res.json({ mensaje: "Publicación actualizada" });
        }
      }
    );
  });
});

app.delete("/publicaciones/:id", verifyToken, (req, res) => {
  db.get("SELECT usuario_id FROM publicaciones WHERE id = ?", [req.params.id], (err, pub) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al eliminar publicación" });
    }

    if (!pub) {
      return res.status(404).json({ error: "Publicación no encontrada" });
    }

    if (pub.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para eliminar esta publicación" });
    }

    db.run("UPDATE publicaciones SET activo = 0 WHERE id = ?", [req.params.id], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al eliminar publicación" });
      }

      db.run(
        "UPDATE candidaturas SET estado = 'retirada', actualizado_en = CURRENT_TIMESTAMP WHERE publicacion_id = ? AND estado != 'retirada'",
        [req.params.id],
        (err) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Error al retirar candidaturas asociadas" });
          }
          res.json({ mensaje: "Publicación eliminada" });
        }
      );
    });
  });
});

// Endpoints de estadísticas
app.get("/stats/total-dentistas", (req, res) => {
  db.get(
    "SELECT COUNT(DISTINCT usuario_id) as total FROM publicaciones WHERE tipo = 'solicitud' AND activo = 1",
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener total de dentistas" });
      }
      res.json({ total: result.total || 0 });
    }
  );
});

app.get("/stats/total-clinicas", (req, res) => {
  db.get(
    "SELECT COUNT(DISTINCT usuario_id) as total FROM publicaciones WHERE tipo = 'oferta' AND activo = 1",
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener total de clínicas" });
      }
      res.json({ total: result.total || 0 });
    }
  );
});

// Estadísticas para dentistas (candidatos)
app.get("/stats/mis-postulaciones/:usuario_id", verifyToken, (req, res) => {
  const usuario_id = req.params.usuario_id;
  db.get(
    `SELECT COUNT(*) as total
     FROM candidaturas c
     INNER JOIN publicaciones p ON c.publicacion_id = p.id
     WHERE c.usuario_id = ? AND p.activo = 1`,
    [usuario_id],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener postulaciones" });
      }
      res.json({ total: result.total || 0 });
    }
  );
});

app.get("/stats/mis-postulaciones-lista/:usuario_id", verifyToken, (req, res) => {
  const usuario_id = req.params.usuario_id;
  db.all(
    `SELECT c.id, c.estado, c.mensaje, c.creado_en, c.actualizado_en,
            p.id as publicacion_id, p.descripcion, p.ciudad, p.contrato, p.jornada, p.salario,
            u.nombre as empresa_nombre, u.email as empresa_email
     FROM candidaturas c
     INNER JOIN publicaciones p ON c.publicacion_id = p.id
     INNER JOIN usuarios u ON p.usuario_id = u.id
     WHERE c.usuario_id = ? AND p.activo = 1
     ORDER BY p.id, c.creado_en DESC`,
    [usuario_id],
    (err, postulaciones) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener postulaciones" });
      }
      res.json(postulaciones || []);
    }
  );
});

app.get("/stats/mis-postulaciones-aceptadas/:usuario_id", verifyToken, (req, res) => {
  const usuario_id = req.params.usuario_id;
  db.get(
    `SELECT COUNT(*) as total FROM candidaturas WHERE usuario_id = ? AND estado = 'aceptada'`,
    [usuario_id],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener postulaciones aceptadas" });
      }
      res.json({ total: result.total || 0 });
    }
  );
});

app.get("/stats/mis-postulaciones-aceptadas-lista/:usuario_id", verifyToken, (req, res) => {
  const usuario_id = req.params.usuario_id;
  db.all(
    `SELECT c.id, c.estado, c.mensaje, c.creado_en, c.actualizado_en,
            p.id as publicacion_id, p.descripcion, p.ciudad, p.contrato, p.jornada, p.salario,
            u.nombre as empresa_nombre, u.email as empresa_email
     FROM candidaturas c
     INNER JOIN publicaciones p ON c.publicacion_id = p.id
     INNER JOIN usuarios u ON p.usuario_id = u.id
     WHERE c.usuario_id = ? AND c.estado = 'aceptada'
     ORDER BY p.id, c.creado_en DESC`,
    [usuario_id],
    (err, postulaciones) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener postulaciones aceptadas" });
      }
      res.json(postulaciones || []);
    }
  );
});

app.get("/stats/posibles-candidatos/:empresa_id", verifyToken, (req, res) => {
  // Contar dentistas únicos que coinciden con Ciudad y Especialidad de mis ofertas
  db.all(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT DISTINCT s.id as publicacion_id, s.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, s.ciudad
     FROM publicaciones s
     INNER JOIN usuarios u ON s.usuario_id = u.id
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     AND (
       SELECT COUNT(*) FROM publicaciones o
       WHERE o.usuario_id = ? AND o.tipo = 'oferta' AND o.activo = 1
       AND (o.ciudad = s.ciudad OR s.ciudad LIKE '%' || o.ciudad || '%' OR o.ciudad LIKE '%' || s.ciudad || '%')
       AND (
         NOT EXISTS (SELECT 1 FROM pub_esp WHERE publicacion_id = o.id)
         OR NOT EXISTS (SELECT 1 FROM pub_esp WHERE publicacion_id = s.id)
         OR EXISTS (
           SELECT 1 FROM pub_esp peo INNER JOIN pub_esp pes ON peo.especialidad_id = pes.especialidad_id
           WHERE peo.publicacion_id = o.id AND pes.publicacion_id = s.id
         )
       )
     ) > 0`,
    [req.params.empresa_id],
    (err, candidatos) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener posibles candidatos" });
      }
      res.json({ total: (candidatos || []).length });
    }
  );
});

app.get("/stats/candidatos-interesados/:empresa_id", verifyToken, (req, res) => {
  // Contar total de candidaturas que se han hecho a mis ofertas
  db.get(
    `SELECT COUNT(*) as total
     FROM candidaturas c
     INNER JOIN publicaciones p ON c.publicacion_id = p.id
     WHERE p.usuario_id = ? AND p.tipo = 'oferta' AND p.activo = 1`,
    [req.params.empresa_id],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener candidatos interesados" });
      }
      res.json({ total: result.total || 0 });
    }
  );
});

app.get("/stats/posibles-candidatos-lista/:empresa_id", verifyToken, (req, res) => {
  db.all(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT DISTINCT s.id as publicacion_id, s.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, s.ciudad
     FROM publicaciones s
     INNER JOIN usuarios u ON s.usuario_id = u.id
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     AND (
       SELECT COUNT(*) FROM publicaciones o
       WHERE o.usuario_id = ? AND o.tipo = 'oferta' AND o.activo = 1
       AND (o.ciudad = s.ciudad OR s.ciudad LIKE '%' || o.ciudad || '%' OR o.ciudad LIKE '%' || s.ciudad || '%')
       AND (
         NOT EXISTS (SELECT 1 FROM pub_esp WHERE publicacion_id = o.id)
         OR NOT EXISTS (SELECT 1 FROM pub_esp WHERE publicacion_id = s.id)
         OR EXISTS (
           SELECT 1 FROM pub_esp peo INNER JOIN pub_esp pes ON peo.especialidad_id = pes.especialidad_id
           WHERE peo.publicacion_id = o.id AND pes.publicacion_id = s.id
         )
       )
     ) > 0`,
    [req.params.empresa_id],
    (err, candidatos) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener posibles candidatos" });
      }
      res.json(candidatos || []);
    }
  );
});

app.get("/stats/clinicas-potenciales/:usuario_id", verifyToken, (req, res) => {
  db.get(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT COUNT(*) as total
     FROM (
       SELECT DISTINCT s.id as publicacion_id, o.usuario_id
       FROM publicaciones o
       INNER JOIN publicaciones s ON s.usuario_id = ? AND s.tipo = 'solicitud' AND s.activo = 1 AND o.ciudad = s.ciudad
       WHERE o.tipo = 'oferta' AND o.activo = 1
       AND (
         NOT EXISTS (SELECT 1 FROM pub_esp WHERE publicacion_id = o.id)
         OR NOT EXISTS (SELECT 1 FROM pub_esp WHERE publicacion_id = s.id)
         OR EXISTS (
           SELECT 1 FROM pub_esp peo INNER JOIN pub_esp pes ON peo.especialidad_id = pes.especialidad_id
           WHERE peo.publicacion_id = o.id AND pes.publicacion_id = s.id
         )
       )
     )`,
    [req.params.usuario_id],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener clínicas potenciales" });
      }
      res.json({ total: result.total || 0 });
    }
  );
});

app.get("/stats/clinicas-potenciales-lista/:usuario_id", verifyToken, (req, res) => {
  db.all(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT DISTINCT s.id as publicacion_id, o.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, o.ciudad
     FROM publicaciones o
     INNER JOIN usuarios u ON o.usuario_id = u.id
     INNER JOIN publicaciones s ON s.usuario_id = ? AND s.tipo = 'solicitud' AND s.activo = 1 AND o.ciudad = s.ciudad
     WHERE o.tipo = 'oferta' AND o.activo = 1
     AND (
       NOT EXISTS (SELECT 1 FROM pub_esp WHERE publicacion_id = o.id)
       OR NOT EXISTS (SELECT 1 FROM pub_esp WHERE publicacion_id = s.id)
       OR EXISTS (
         SELECT 1 FROM pub_esp peo INNER JOIN pub_esp pes ON peo.especialidad_id = pes.especialidad_id
         WHERE peo.publicacion_id = o.id AND pes.publicacion_id = s.id
       )
     )`,
    [req.params.usuario_id],
    (err, clinicas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener clínicas potenciales" });
      }
      res.json(clinicas || []);
    }
  );
});

app.get("/stats/candidatos-interesados-lista/:empresa_id", verifyToken, (req, res) => {
  db.all(
    `SELECT c.id, c.usuario_id, c.estado, c.mensaje, c.creado_en,
            u.nombre, u.email, u.telefono, u.direccion, u.codigo_postal, u.pais, u.ciudad,
            p.id as publicacion_id, p.descripcion as oferta_descripcion, p.ciudad as oferta_ciudad, p.contrato, p.jornada, p.salario
     FROM candidaturas c
     INNER JOIN usuarios u ON c.usuario_id = u.id
     INNER JOIN publicaciones p ON c.publicacion_id = p.id
     WHERE p.usuario_id = ? AND p.tipo = 'oferta' AND p.activo = 1
     ORDER BY p.id, c.creado_en DESC`,
    [req.params.empresa_id],
    (err, candidatos) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener candidatos interesados" });
      }
      res.json(candidatos || []);
    }
  );
});

app.get("/stats/contactados-lista/:empresa_id", verifyToken, (req, res) => {
  db.all(
    `SELECT c.id, c.usuario_id, c.estado, c.mensaje, c.creado_en,
            u.nombre, u.email, u.telefono, u.direccion, u.codigo_postal, u.pais, u.ciudad,
            p.id as publicacion_id, p.descripcion as oferta_descripcion, p.ciudad as oferta_ciudad, p.contrato, p.jornada, p.salario
     FROM candidaturas c
     INNER JOIN usuarios u ON c.usuario_id = u.id
     INNER JOIN publicaciones p ON c.publicacion_id = p.id
     WHERE p.usuario_id = ? AND p.tipo = 'oferta' AND p.activo = 1 AND c.estado = 'aceptada'
     ORDER BY p.id, c.creado_en DESC`,
    [req.params.empresa_id],
    (err, aceptados) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener aceptados" });
      }
      res.json(aceptados || []);
    }
  );
});

app.get("/stats/dentistas-por-especialidad", (req, res) => {
  db.all(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT e.nombre as especialidad, COUNT(DISTINCT s.usuario_id) as total
     FROM publicaciones s
     INNER JOIN pub_esp pe ON pe.publicacion_id = s.id
     INNER JOIN especialidades e ON pe.especialidad_id = e.id
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     GROUP BY e.id, e.nombre
     UNION ALL
     SELECT 'Sin especialidad' as especialidad, COUNT(DISTINCT s.usuario_id) as total
     FROM publicaciones s
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     AND NOT EXISTS (
       SELECT 1 FROM pub_esp pe2
       INNER JOIN publicaciones s2 ON s2.id = pe2.publicacion_id
       WHERE s2.usuario_id = s.usuario_id AND s2.tipo = 'solicitud' AND s2.activo = 1
     )
     HAVING COUNT(DISTINCT s.usuario_id) > 0
     ORDER BY total DESC`,
    (err, resultado) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener dentistas por especialidad" });
      }
      res.json(resultado || []);
    }
  );
});

app.get("/stats/postulaciones-recibidas-dentista/:usuario_id", verifyToken, (req, res) => {
  db.get(
    `SELECT COUNT(*) as total
     FROM candidaturas c
     INNER JOIN publicaciones p ON c.publicacion_id = p.id
     WHERE p.usuario_id = ? AND p.tipo = 'solicitud' AND p.activo = 1`,
    [req.params.usuario_id],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener postulaciones recibidas" });
      }
      res.json({ total: result.total || 0 });
    }
  );
});

app.get("/stats/postulaciones-recibidas-dentista-lista/:usuario_id", verifyToken, (req, res) => {
  db.all(
    `SELECT c.id, c.usuario_id, c.estado, c.mensaje, c.creado_en,
            u.nombre, u.email, u.telefono, u.direccion, u.codigo_postal, u.pais, u.ciudad,
            p.id as publicacion_id, p.descripcion as solicitud_descripcion, p.ciudad as solicitud_ciudad, p.especialidad_id
     FROM candidaturas c
     INNER JOIN usuarios u ON c.usuario_id = u.id
     INNER JOIN publicaciones p ON c.publicacion_id = p.id
     WHERE p.usuario_id = ? AND p.tipo = 'solicitud' AND p.activo = 1
     ORDER BY p.id, c.creado_en DESC`,
    [req.params.usuario_id],
    (err, candidatos) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener postulaciones recibidas" });
      }
      res.json(candidatos || []);
    }
  );
});

app.get("/stats/postulaciones-recibidas-aceptadas-dentista/:usuario_id", verifyToken, (req, res) => {
  db.get(
    `SELECT COUNT(*) as total
     FROM candidaturas c
     INNER JOIN publicaciones p ON c.publicacion_id = p.id
     WHERE p.usuario_id = ? AND p.tipo = 'solicitud' AND p.activo = 1 AND c.estado = 'aceptada'`,
    [req.params.usuario_id],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener postulaciones recibidas aceptadas" });
      }
      res.json({ total: result.total || 0 });
    }
  );
});

app.get("/stats/postulaciones-recibidas-aceptadas-dentista-lista/:usuario_id", verifyToken, (req, res) => {
  db.all(
    `SELECT c.id, c.usuario_id, c.estado, c.mensaje, c.creado_en,
            u.nombre, u.email, u.telefono, u.direccion, u.codigo_postal, u.pais, u.ciudad,
            p.id as publicacion_id, p.descripcion as solicitud_descripcion, p.ciudad as solicitud_ciudad, p.especialidad_id
     FROM candidaturas c
     INNER JOIN usuarios u ON c.usuario_id = u.id
     INNER JOIN publicaciones p ON c.publicacion_id = p.id
     WHERE p.usuario_id = ? AND p.tipo = 'solicitud' AND p.activo = 1 AND c.estado = 'aceptada'
     ORDER BY p.id, c.creado_en DESC`,
    [req.params.usuario_id],
    (err, candidatos) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener postulaciones recibidas aceptadas" });
      }
      res.json(candidatos || []);
    }
  );
});

app.get("/stats/dentistas-por-ciudad", (req, res) => {
  db.all(
    `SELECT s.ciudad, COUNT(DISTINCT s.usuario_id) as total
     FROM publicaciones s
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     GROUP BY s.ciudad
     ORDER BY total DESC`,
    (err, resultado) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener dentistas por ciudad" });
      }
      res.json(resultado || []);
    }
  );
});

app.get("/stats/dentistas-por-ciudad-especialidad", (req, res) => {
  db.all(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT s.ciudad, e.nombre as especialidad, COUNT(DISTINCT s.usuario_id) as total
     FROM publicaciones s
     INNER JOIN pub_esp pe ON pe.publicacion_id = s.id
     INNER JOIN especialidades e ON pe.especialidad_id = e.id
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     GROUP BY s.ciudad, e.id, e.nombre
     UNION ALL
     SELECT s.ciudad, 'Sin especialidad' as especialidad, COUNT(DISTINCT s.usuario_id) as total
     FROM publicaciones s
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     AND NOT EXISTS (
       SELECT 1 FROM pub_esp pe2
       INNER JOIN publicaciones s2 ON s2.id = pe2.publicacion_id
       WHERE s2.usuario_id = s.usuario_id AND s2.tipo = 'solicitud' AND s2.activo = 1
     )
     GROUP BY s.ciudad
     HAVING COUNT(DISTINCT s.usuario_id) > 0
     ORDER BY ciudad, especialidad`,
    (err, resultado) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener dentistas por ciudad y especialidad" });
      }
      res.json(resultado || []);
    }
  );
});

app.get("/stats/dentistas-por-especialidad-lista/:especialidad", (req, res) => {
  db.all(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT s.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, s.ciudad,
       GROUP_CONCAT(DISTINCT COALESCE(e2.nombre, e.nombre)) as especialidades
     FROM publicaciones s
     INNER JOIN usuarios u ON s.usuario_id = u.id
     LEFT JOIN especialidades e ON s.especialidad_id = e.id
     LEFT JOIN publicacion_especialidades pe2 ON pe2.publicacion_id = s.id
     LEFT JOIN especialidades e2 ON pe2.especialidad_id = e2.id
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     AND (
       EXISTS (
         SELECT 1 FROM pub_esp pem
         INNER JOIN especialidades em ON pem.especialidad_id = em.id
         INNER JOIN publicaciones sm ON sm.id = pem.publicacion_id
         WHERE sm.usuario_id = s.usuario_id AND sm.tipo = 'solicitud' AND sm.activo = 1
         AND LOWER(em.nombre) = LOWER(?)
       )
       OR (
         ? = 'Sin especialidad'
         AND NOT EXISTS (
           SELECT 1 FROM pub_esp pen
           INNER JOIN publicaciones sn ON sn.id = pen.publicacion_id
           WHERE sn.usuario_id = s.usuario_id AND sn.tipo = 'solicitud' AND sn.activo = 1
         )
       )
     )
     GROUP BY s.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, s.ciudad`,
    [req.params.especialidad, req.params.especialidad],
    (err, dentistas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener dentistas" });
      }
      res.json(dentistas || []);
    }
  );
});

app.get("/stats/dentistas-por-ciudad-lista/:ciudad", (req, res) => {
  db.all(
    `SELECT s.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, s.ciudad,
       GROUP_CONCAT(DISTINCT COALESCE(e2.nombre, e.nombre)) as especialidades
     FROM publicaciones s
     INNER JOIN usuarios u ON s.usuario_id = u.id
     LEFT JOIN especialidades e ON s.especialidad_id = e.id
     LEFT JOIN publicacion_especialidades pe2 ON pe2.publicacion_id = s.id
     LEFT JOIN especialidades e2 ON pe2.especialidad_id = e2.id
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     AND LOWER(s.ciudad) = LOWER(?)
     GROUP BY s.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, s.ciudad`,
    [req.params.ciudad],
    (err, dentistas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener dentistas" });
      }
      res.json(dentistas || []);
    }
  );
});

app.get("/stats/dentistas-por-ciudad-especialidad-lista/:ciudad/:especialidad", (req, res) => {
  db.all(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT s.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, s.ciudad,
       GROUP_CONCAT(DISTINCT COALESCE(e2.nombre, e.nombre)) as especialidades
     FROM publicaciones s
     INNER JOIN usuarios u ON s.usuario_id = u.id
     LEFT JOIN especialidades e ON s.especialidad_id = e.id
     LEFT JOIN publicacion_especialidades pe2 ON pe2.publicacion_id = s.id
     LEFT JOIN especialidades e2 ON pe2.especialidad_id = e2.id
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     AND LOWER(s.ciudad) = LOWER(?)
     AND (
       EXISTS (
         SELECT 1 FROM pub_esp pem
         INNER JOIN especialidades em ON pem.especialidad_id = em.id
         INNER JOIN publicaciones sm ON sm.id = pem.publicacion_id
         WHERE sm.usuario_id = s.usuario_id AND sm.tipo = 'solicitud' AND sm.activo = 1
         AND LOWER(em.nombre) = LOWER(?)
       )
       OR (
         ? = 'Sin especialidad'
         AND NOT EXISTS (
           SELECT 1 FROM pub_esp pen
           INNER JOIN publicaciones sn ON sn.id = pen.publicacion_id
           WHERE sn.usuario_id = s.usuario_id AND sn.tipo = 'solicitud' AND sn.activo = 1
         )
       )
     )
     GROUP BY s.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, s.ciudad`,
    [req.params.ciudad, req.params.especialidad, req.params.especialidad],
    (err, dentistas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener dentistas" });
      }
      res.json(dentistas || []);
    }
  );
});

app.get("/stats/clinicas-por-especialidad", (req, res) => {
  db.all(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT e.nombre as especialidad, COUNT(DISTINCT o.usuario_id) as total
     FROM publicaciones o
     INNER JOIN pub_esp pe ON pe.publicacion_id = o.id
     INNER JOIN especialidades e ON pe.especialidad_id = e.id
     WHERE o.tipo = 'oferta' AND o.activo = 1
     GROUP BY e.id, e.nombre
     UNION ALL
     SELECT 'Sin especialidad' as especialidad, COUNT(DISTINCT o.usuario_id) as total
     FROM publicaciones o
     WHERE o.tipo = 'oferta' AND o.activo = 1
     AND NOT EXISTS (
       SELECT 1 FROM pub_esp pe2
       INNER JOIN publicaciones o2 ON o2.id = pe2.publicacion_id
       WHERE o2.usuario_id = o.usuario_id AND o2.tipo = 'oferta' AND o2.activo = 1
     )
     HAVING COUNT(DISTINCT o.usuario_id) > 0
     ORDER BY total DESC`,
    (err, resultado) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener clínicas por especialidad" });
      }
      res.json(resultado || []);
    }
  );
});

app.get("/stats/clinicas-por-ciudad", (req, res) => {
  db.all(
    `SELECT o.ciudad, COUNT(DISTINCT o.usuario_id) as total
     FROM publicaciones o
     WHERE o.tipo = 'oferta' AND o.activo = 1
     GROUP BY o.ciudad
     ORDER BY total DESC`,
    (err, resultado) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener clínicas por ciudad" });
      }
      res.json(resultado || []);
    }
  );
});

app.get("/stats/clinicas-por-ciudad-especialidad", (req, res) => {
  db.all(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT o.ciudad, e.nombre as especialidad, COUNT(DISTINCT o.usuario_id) as total
     FROM publicaciones o
     INNER JOIN pub_esp pe ON pe.publicacion_id = o.id
     INNER JOIN especialidades e ON pe.especialidad_id = e.id
     WHERE o.tipo = 'oferta' AND o.activo = 1
     GROUP BY o.ciudad, e.id, e.nombre
     UNION ALL
     SELECT o.ciudad, 'Sin especialidad' as especialidad, COUNT(DISTINCT o.usuario_id) as total
     FROM publicaciones o
     WHERE o.tipo = 'oferta' AND o.activo = 1
     AND NOT EXISTS (
       SELECT 1 FROM pub_esp pe2
       INNER JOIN publicaciones o2 ON o2.id = pe2.publicacion_id
       WHERE o2.usuario_id = o.usuario_id AND o2.tipo = 'oferta' AND o2.activo = 1
     )
     GROUP BY o.ciudad
     HAVING COUNT(DISTINCT o.usuario_id) > 0
     ORDER BY ciudad, especialidad`,
    (err, resultado) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener clínicas por ciudad y especialidad" });
      }
      res.json(resultado || []);
    }
  );
});

app.get("/stats/clinicas-por-especialidad-lista/:especialidad", (req, res) => {
  db.all(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT o.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, o.ciudad,
       GROUP_CONCAT(DISTINCT COALESCE(e2.nombre, el.nombre)) as especialidades
     FROM publicaciones o
     INNER JOIN usuarios u ON o.usuario_id = u.id
     LEFT JOIN publicacion_especialidades pe2 ON pe2.publicacion_id = o.id
     LEFT JOIN especialidades e2 ON pe2.especialidad_id = e2.id
     LEFT JOIN especialidades el ON el.id = o.especialidad_id
     WHERE o.tipo = 'oferta' AND o.activo = 1
     AND (
       EXISTS (
         SELECT 1 FROM pub_esp pem
         INNER JOIN especialidades em ON pem.especialidad_id = em.id
         INNER JOIN publicaciones om ON om.id = pem.publicacion_id
         WHERE om.usuario_id = o.usuario_id AND om.tipo = 'oferta' AND om.activo = 1
         AND LOWER(em.nombre) = LOWER(?)
       )
       OR (
         ? = 'Sin especialidad'
         AND NOT EXISTS (
           SELECT 1 FROM pub_esp pen
           INNER JOIN publicaciones on2 ON on2.id = pen.publicacion_id
           WHERE on2.usuario_id = o.usuario_id AND on2.tipo = 'oferta' AND on2.activo = 1
         )
       )
     )
     GROUP BY o.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, o.ciudad`,
    [req.params.especialidad, req.params.especialidad],
    (err, clinicas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener clínicas" });
      }
      res.json(clinicas || []);
    }
  );
});

app.get("/stats/clinicas-por-ciudad-lista/:ciudad", (req, res) => {
  db.all(
    `SELECT o.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, o.ciudad,
       GROUP_CONCAT(DISTINCT COALESCE(e2.nombre, el.nombre)) as especialidades
     FROM publicaciones o
     INNER JOIN usuarios u ON o.usuario_id = u.id
     LEFT JOIN publicacion_especialidades pe2 ON pe2.publicacion_id = o.id
     LEFT JOIN especialidades e2 ON pe2.especialidad_id = e2.id
     LEFT JOIN especialidades el ON el.id = o.especialidad_id
     WHERE o.tipo = 'oferta' AND o.activo = 1
     AND LOWER(o.ciudad) = LOWER(?)
     GROUP BY o.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, o.ciudad`,
    [req.params.ciudad],
    (err, clinicas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener clínicas" });
      }
      res.json(clinicas || []);
    }
  );
});

app.get("/stats/clinicas-por-ciudad-especialidad-lista/:ciudad/:especialidad", (req, res) => {
  db.all(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT o.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, o.ciudad,
       GROUP_CONCAT(DISTINCT COALESCE(e2.nombre, el.nombre)) as especialidades
     FROM publicaciones o
     INNER JOIN usuarios u ON o.usuario_id = u.id
     LEFT JOIN publicacion_especialidades pe2 ON pe2.publicacion_id = o.id
     LEFT JOIN especialidades e2 ON pe2.especialidad_id = e2.id
     LEFT JOIN especialidades el ON el.id = o.especialidad_id
     WHERE o.tipo = 'oferta' AND o.activo = 1
     AND LOWER(o.ciudad) = LOWER(?)
     AND (
       EXISTS (
         SELECT 1 FROM pub_esp pem
         INNER JOIN especialidades em ON pem.especialidad_id = em.id
         INNER JOIN publicaciones om ON om.id = pem.publicacion_id
         WHERE om.usuario_id = o.usuario_id AND om.tipo = 'oferta' AND om.activo = 1
         AND LOWER(em.nombre) = LOWER(?)
       )
       OR (
         ? = 'Sin especialidad'
         AND NOT EXISTS (
           SELECT 1 FROM pub_esp pen
           INNER JOIN publicaciones on2 ON on2.id = pen.publicacion_id
           WHERE on2.usuario_id = o.usuario_id AND on2.tipo = 'oferta' AND on2.activo = 1
         )
       )
     )
     GROUP BY o.usuario_id, u.nombre, u.email, u.telefono, u.movil, u.direccion, u.codigo_postal, u.pais, o.ciudad`,
    [req.params.ciudad, req.params.especialidad, req.params.especialidad],
    (err, clinicas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener clínicas" });
      }
      res.json(clinicas || []);
    }
  );
});

/* ===========================
   🔹 MENSAJES
=========================== */

app.get("/mensajes/:publicacion_id", (req, res) => {
  db.all(
    "SELECT * FROM mensajes WHERE publicacion_id = ? ORDER BY creado_en DESC",
    [req.params.publicacion_id],
    (err, mensajes) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener mensajes" });
      }
      res.json(mensajes || []);
    }
  );
});

app.post("/mensajes", verifyToken, (req, res) => {
  const { publicacion_id, remitente_nombre, remitente_email, cuerpo } = req.body;
  const usuario_id = req.usuario.id;

  if (!publicacion_id || !remitente_nombre || !remitente_email || !cuerpo) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  db.get("SELECT id FROM publicaciones WHERE id = ?", [publicacion_id], (err, pub) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al enviar mensaje" });
    }

    if (!pub) {
      return res.status(404).json({ error: "Publicación no encontrada" });
    }

    db.run(
      "INSERT INTO mensajes (publicacion_id, usuario_id, remitente_nombre, remitente_email, cuerpo) VALUES (?, ?, ?, ?, ?)",
      [publicacion_id, usuario_id, remitente_nombre, remitente_email, cuerpo],
      (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al enviar mensaje" });
        }

        res.json({ mensaje: "Mensaje enviado" });
      }
    );
  });
});

// Obtener conversaciones del usuario (bandeja de entrada)
app.get("/mensajes/conversaciones", verifyToken, (req, res) => {
  const usuario_id = req.usuario.id;

  db.all(
    `SELECT DISTINCT
      m.remitente_email,
      m.remitente_nombre,
      MAX(m.creado_en) as ultima_fecha,
      SUM(CASE WHEN m.leido = 0 AND m.usuario_id = ? THEN 1 ELSE 0 END) as no_leidos,
      (SELECT COUNT(*) FROM mensajes m2 WHERE m2.remitente_email = m.remitente_email) as total_mensajes
     FROM mensajes m
     WHERE m.usuario_id = ? OR m.remitente_email IN (
       SELECT remitente_email FROM mensajes WHERE usuario_id = ?
     )
     GROUP BY m.remitente_email
     ORDER BY ultima_fecha DESC`,
    [usuario_id, usuario_id, usuario_id],
    (err, conversaciones) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener conversaciones" });
      }

      res.json({ conversaciones: conversaciones || [] });
    }
  );
});

// Obtener historial de conversación con un usuario específico
app.get("/mensajes/conversacion/:email", verifyToken, (req, res) => {
  const usuario_id = req.usuario.id;
  const email = req.params.email;

  db.all(
    `SELECT * FROM mensajes
     WHERE (usuario_id = ? AND remitente_email = ?) OR (remitente_email = ? AND usuario_id = ?)
     ORDER BY creado_en DESC`,
    [usuario_id, email, email, usuario_id],
    (err, mensajes) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener conversación" });
      }

      res.json({ mensajes: (mensajes || []).reverse() });
    }
  );
});

// Marcar mensaje como leído
app.put("/mensajes/:id/leer", verifyToken, (req, res) => {
  const mensaje_id = req.params.id;

  db.run(
    "UPDATE mensajes SET leido = 1 WHERE id = ?",
    [mensaje_id],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al marcar como leído" });
      }

      res.json({ success: true });
    }
  );
});

// Contar mensajes no leídos
app.get("/mensajes/no-leidos/count", verifyToken, (req, res) => {
  const usuario_id = req.usuario.id;

  db.get(
    "SELECT COUNT(*) as total FROM mensajes WHERE usuario_id = ? AND leido = 0",
    [usuario_id],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al contar mensajes" });
      }

      res.json({ no_leidos: result.total });
    }
  );
});

/* ===========================
   🔹 CHAT
=========================== */

// Estado "escribiendo…" en memoria: clave `${remitente}:${destinatario}:${publicacion}` → timestamp
const escribiendoStatus = new Map();
const ESCRIBIENDO_TTL_MS = 5000;

// Bandeja de conversaciones del usuario, agrupadas por publicación e interlocutor
app.get("/chat/conversaciones", verifyToken, (req, res) => {
  const usuarioId = req.usuario.id;

  db.all(
    `SELECT m.*, p.ciudad as publicacion_ciudad, p.tipo as publicacion_tipo,
            ur.nombre as remitente_nombre_usuario, ud.nombre as destinatario_nombre
     FROM mensajes m
     LEFT JOIN publicaciones p ON m.publicacion_id = p.id
     LEFT JOIN usuarios ur ON m.usuario_id = ur.id
     LEFT JOIN usuarios ud ON m.destinatario_id = ud.id
     WHERE (m.usuario_id = ? OR m.destinatario_id = ?) AND m.destinatario_id IS NOT NULL
     ORDER BY m.creado_en ASC`,
    [usuarioId, usuarioId],
    (err, mensajes) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener conversaciones" });
      }

      const conversaciones = {};
      (mensajes || []).forEach(m => {
        const otroId = m.usuario_id === usuarioId ? m.destinatario_id : m.usuario_id;
        const otroNombre = m.usuario_id === usuarioId ? m.destinatario_nombre : (m.remitente_nombre_usuario || m.remitente_nombre);
        const clave = `${m.publicacion_id}:${otroId}`;
        if (!conversaciones[clave]) {
          conversaciones[clave] = {
            publicacion_id: m.publicacion_id,
            publicacion_ciudad: m.publicacion_ciudad,
            publicacion_tipo: m.publicacion_tipo,
            otro_id: otroId,
            otro_nombre: otroNombre,
            ultimo_mensaje: null,
            ultima_fecha: null,
            no_leidos: 0
          };
        }
        conversaciones[clave].ultimo_mensaje = m.cuerpo;
        conversaciones[clave].ultima_fecha = m.creado_en;
        if (m.destinatario_id === usuarioId && m.leido === 0) {
          conversaciones[clave].no_leidos++;
        }
      });

      const lista = Object.values(conversaciones)
        .sort((a, b) => (a.ultima_fecha < b.ultima_fecha ? 1 : -1));

      res.json({ conversaciones: lista });
    }
  );
});

// Hilo de una conversación: mensajes en ambos sentidos + estado "escribiendo…" del interlocutor.
// Marca como leídos los mensajes entrantes.
app.get("/chat/mensajes/:publicacionId/:otroId", verifyToken, (req, res) => {
  const usuarioId = req.usuario.id;
  const publicacionId = parseInt(req.params.publicacionId);
  const otroId = parseInt(req.params.otroId);

  // Primero marcar como leídos los mensajes entrantes y después devolver el hilo,
  // para no dejar escrituras en vuelo tras responder
  db.run(
    "UPDATE mensajes SET leido = 1 WHERE publicacion_id = ? AND usuario_id = ? AND destinatario_id = ? AND leido = 0",
    [publicacionId, otroId, usuarioId],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener mensajes" });
      }

      db.all(
        `SELECT m.*, ur.nombre as remitente_nombre_usuario
         FROM mensajes m
         LEFT JOIN usuarios ur ON m.usuario_id = ur.id
         WHERE m.publicacion_id = ?
           AND ((m.usuario_id = ? AND m.destinatario_id = ?) OR (m.usuario_id = ? AND m.destinatario_id = ?))
         ORDER BY m.creado_en ASC`,
        [publicacionId, usuarioId, otroId, otroId, usuarioId],
        (err, mensajes) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Error al obtener mensajes" });
          }

          const claveEscribiendo = `${otroId}:${usuarioId}:${publicacionId}`;
          const ultimaEscritura = escribiendoStatus.get(claveEscribiendo);
          const escribiendo = !!ultimaEscritura && (Date.now() - ultimaEscritura) < ESCRIBIENDO_TTL_MS;

          res.json({ mensajes: mensajes || [], escribiendo });
        }
      );
    }
  );
});

app.post("/chat/mensajes", verifyToken, (req, res) => {
  const { publicacion_id, destinatario_id, cuerpo } = req.body;
  const usuarioId = req.usuario.id;
  const destinatarioId = parseInt(destinatario_id);

  if (!publicacion_id || !destinatario_id || !cuerpo || !cuerpo.trim()) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  if (destinatarioId === usuarioId) {
    return res.status(400).json({ error: "No puedes enviarte mensajes a ti mismo" });
  }

  db.get("SELECT id, usuario_id FROM publicaciones WHERE id = ?", [publicacion_id], (err, pub) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al enviar mensaje" });
    }
    if (!pub) {
      return res.status(404).json({ error: "Publicación no encontrada" });
    }
    if (pub.usuario_id !== usuarioId && pub.usuario_id !== destinatarioId) {
      return res.status(403).json({ error: "No puedes enviar mensajes para esta publicación" });
    }

    // El chat solo se habilita cuando la postulación del interesado a esta publicación fue aceptada
    const postulanteId = pub.usuario_id === usuarioId ? destinatarioId : usuarioId;

    db.get(
      "SELECT id FROM candidaturas WHERE publicacion_id = ? AND usuario_id = ? AND estado = 'aceptada'",
      [publicacion_id, postulanteId],
      (err, candidatura) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al enviar mensaje" });
        }
        if (!candidatura) {
          return res.status(403).json({ error: "Solo puedes chatear tras una postulación aceptada" });
        }

        db.get("SELECT nombre, email FROM usuarios WHERE id = ?", [usuarioId], (err, remitente) => {
          if (err || !remitente) {
            console.error(err);
            return res.status(500).json({ error: "Error al enviar mensaje" });
          }

          db.run(
            `INSERT INTO mensajes (publicacion_id, usuario_id, destinatario_id, remitente_nombre, remitente_email, cuerpo)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [publicacion_id, usuarioId, destinatario_id, remitente.nombre, remitente.email, cuerpo.trim()],
            function(err) {
              if (err) {
                console.error(err);
                return res.status(500).json({ error: "Error al enviar mensaje" });
              }
              escribiendoStatus.delete(`${usuarioId}:${destinatario_id}:${publicacion_id}`);
              res.json({ mensaje: "Mensaje enviado", id: this.lastID });
            }
          );
        });
      }
    );
  });
});

// Señal de "escribiendo…" (se guarda solo en memoria, expira a los pocos segundos)
app.post("/chat/escribiendo", verifyToken, (req, res) => {
  const { publicacion_id, destinatario_id } = req.body;
  if (!publicacion_id || !destinatario_id) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }
  escribiendoStatus.set(`${req.usuario.id}:${destinatario_id}:${publicacion_id}`, Date.now());
  res.json({ success: true });
});

app.get("/chat/no-leidos", verifyToken, (req, res) => {
  db.get(
    "SELECT COUNT(*) as total FROM mensajes WHERE destinatario_id = ? AND leido = 0",
    [req.usuario.id],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al contar mensajes" });
      }
      res.json({ total: result.total || 0 });
    }
  );
});

/* ===========================
   🔹 ARCHIVOS
=========================== */

app.post("/archivos/upload", verifyToken, upload.single("archivo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se envió ningún archivo" });
  }

  const { tipo } = req.body;
  if (!tipo || !["cv", "portfolio", "foto"].includes(tipo)) {
    return res.status(400).json({ error: "Tipo de archivo inválido" });
  }

  if (tipo === "foto" && !(req.file.mimetype || "").startsWith("image/")) {
    return res.status(400).json({ error: "Las fotos deben ser imágenes" });
  }

  const maxSize = tipo === "cv" ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
  if (req.file.size > maxSize) {
    return res.status(400).json({ error: `Archivo demasiado grande (máx ${maxSize / 1024 / 1024} MB)` });
  }

  db.run(
    `INSERT INTO archivos (usuario_id, tipo, nombre_archivo, mime_type, contenido, tamanyo)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.usuario.id, tipo, req.file.originalname, req.file.mimetype, req.file.buffer, req.file.size],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al guardar archivo" });
      }

      res.json({
        mensaje: "Archivo subido exitosamente",
        id: this.lastID,
        archivo: {
          id: this.lastID,
          nombre: req.file.originalname,
          tipo,
          tamanyo: req.file.size
        }
      });
    }
  );
});

app.get("/archivos/usuario/:userId", (req, res) => {
  db.all(
    "SELECT id, tipo, nombre_archivo, tamanyo, creado_en FROM archivos WHERE usuario_id = ? ORDER BY creado_en DESC",
    [req.params.userId],
    (err, archivos) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener archivos" });
      }

      res.json(archivos || []);
    }
  );
});

app.get("/archivos/:id/download", (req, res) => {
  db.get(
    "SELECT nombre_archivo, contenido, mime_type FROM archivos WHERE id = ?",
    [req.params.id],
    (err, archivo) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al descargar archivo" });
      }

      if (!archivo) {
        return res.status(404).json({ error: "Archivo no encontrado" });
      }

      res.setHeader("Content-Type", archivo.mime_type || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${archivo.nombre_archivo}"`);
      res.send(archivo.contenido);
    }
  );
});

app.delete("/archivos/:id", verifyToken, (req, res) => {
  db.get("SELECT usuario_id FROM archivos WHERE id = ?", [req.params.id], (err, archivo) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al eliminar archivo" });
    }

    if (!archivo) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }

    if (archivo.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para eliminar este archivo" });
    }

    db.run("DELETE FROM archivos WHERE id = ?", [req.params.id], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al eliminar archivo" });
      }

      res.json({ mensaje: "Archivo eliminado" });
    });
  });
});

/* ===========================
   🔹 CANDIDATURAS
=========================== */

// Exportar postulaciones a CSV: 'recibidas' (sobre mis publicaciones) o 'enviadas' (las mías).
// Separador ';' y BOM UTF-8 para que Excel en español lo abra directamente.
app.get("/candidaturas/export.csv", verifyToken, (req, res) => {
  const tipoExport = req.query.tipo || (req.usuario.tipo === "clinica" ? "recibidas" : "enviadas");
  if (!["recibidas", "enviadas"].includes(tipoExport)) {
    return res.status(400).json({ error: "Tipo de exportación inválido" });
  }

  const esRecibidas = tipoExport === "recibidas";
  const sql = esRecibidas
    ? `SELECT c.creado_en, c.actualizado_en, c.estado, c.mensaje,
              p.tipo as publicacion_tipo, p.ciudad as publicacion_ciudad,
              u.nombre as contraparte_nombre, u.email as contraparte_email, u.ciudad as contraparte_ciudad
       FROM candidaturas c
       INNER JOIN publicaciones p ON c.publicacion_id = p.id
       INNER JOIN usuarios u ON c.usuario_id = u.id
       WHERE p.usuario_id = ?
       ORDER BY c.creado_en DESC`
    : `SELECT c.creado_en, c.actualizado_en, c.estado, c.mensaje,
              p.tipo as publicacion_tipo, p.ciudad as publicacion_ciudad,
              u.nombre as contraparte_nombre, u.email as contraparte_email, u.ciudad as contraparte_ciudad
       FROM candidaturas c
       INNER JOIN publicaciones p ON c.publicacion_id = p.id
       INNER JOIN usuarios u ON p.usuario_id = u.id
       WHERE c.usuario_id = ?
       ORDER BY c.creado_en DESC`;

  db.all(sql, [req.usuario.id], (err, filas) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al exportar postulaciones" });
    }

    const etiquetaContraparte = esRecibidas ? "Candidato" : "Publicado por";
    const columnas = ["Fecha postulación", "Estado", "Fecha última actualización",
                      "Publicación", "Ciudad publicación",
                      etiquetaContraparte, "Email", "Ciudad", "Mensaje"];

    const escapar = (valor) => `"${String(valor ?? "").replace(/"/g, '""')}"`;
    const lineas = [columnas.map(escapar).join(";")];

    (filas || []).forEach(f => {
      lineas.push([
        f.creado_en,
        f.estado,
        f.actualizado_en,
        f.publicacion_tipo === "oferta" ? "Oferta" : "Solicitud",
        f.publicacion_ciudad,
        f.contraparte_nombre,
        f.contraparte_email,
        f.contraparte_ciudad,
        f.mensaje
      ].map(escapar).join(";"));
    });

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="postulaciones-${tipoExport}-${fecha}.csv"`);
    res.send("\uFEFF" + lineas.join("\n"));
  });
});

// Crear candidatura (dentista postulándose a oferta)
app.post("/candidaturas", verifyToken, (req, res) => {
  const { publicacion_id, mensaje } = req.body;
  const usuario_id = req.usuario.id;

  if (!publicacion_id) {
    return res.status(400).json({ error: "publicacion_id requerido" });
  }

  db.run(
    "INSERT INTO candidaturas (publicacion_id, usuario_id, estado, mensaje) VALUES (?, ?, 'pendiente', ?)",
    [publicacion_id, usuario_id, mensaje || null],
    function(err) {
      if (err) {
        if (err.message.includes("UNIQUE")) {
          return res.status(400).json({ error: "Ya te has postulado a esta oferta" });
        }
        console.error(err);
        return res.status(500).json({ error: "Error al postularse" });
      }

      res.json({
        mensaje: "Postulación creada",
        candidatura_id: this.lastID
      });
    }
  );
});

// Obtener mis postulaciones (dentista)
app.get("/candidaturas/mis-postulaciones", verifyToken, (req, res) => {
  const usuario_id = req.usuario.id;

  db.all(
    `SELECT c.*, p.tipo as publicacion_tipo, p.descripcion, p.ciudad, p.contrato, p.jornada, p.salario,
            u.nombre as empresa_nombre, u.email as empresa_email
     FROM candidaturas c
     JOIN publicaciones p ON c.publicacion_id = p.id
     JOIN usuarios u ON p.usuario_id = u.id
     WHERE c.usuario_id = ? AND p.activo = 1
     ORDER BY c.creado_en DESC`,
    [usuario_id],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener postulaciones" });
      }

      res.json({ candidaturas: rows || [] });
    }
  );
});

// Obtener candidatos de una oferta (clínica)
app.get("/publicaciones/:id/candidatos", verifyToken, (req, res) => {
  const publicacion_id = req.params.id;

  db.all(
    `SELECT c.*, u.nombre, u.email, u.telefono, u.movil, u.ciudad, u.direccion, u.tipo
     FROM candidaturas c
     JOIN usuarios u ON c.usuario_id = u.id
     WHERE c.publicacion_id = ?
     ORDER BY c.creado_en DESC`,
    [publicacion_id],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener candidatos" });
      }

      res.json({ candidatos: rows || [] });
    }
  );
});

// Cambiar estado de candidatura (aceptar/rechazar)
app.put("/candidaturas/:id", verifyToken, (req, res) => {
  const { estado } = req.body;
  const candidatura_id = req.params.id;
  const usuarioId = req.usuario.id;

  if (!["pendiente", "aceptada", "rechazada"].includes(estado)) {
    return res.status(400).json({ error: "Estado inválido" });
  }

  db.get(
    `SELECT p.usuario_id
     FROM candidaturas c
     JOIN publicaciones p ON p.id = c.publicacion_id
     WHERE c.id = ?`,
    [candidatura_id],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al actualizar candidatura" });
      }
      if (!row) {
        return res.status(404).json({ error: "Candidatura no encontrada" });
      }
      if (row.usuario_id !== usuarioId) {
        return res.status(403).json({ error: "No puedes modificar esta candidatura" });
      }

      db.run(
        "UPDATE candidaturas SET estado = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?",
        [estado, candidatura_id],
        function(err) {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Error al actualizar candidatura" });
          }

          res.json({ mensaje: "Candidatura actualizada" });
        }
      );
    }
  );
});

// Eliminar candidatura (retirar postulación)
app.delete("/candidaturas/:id", verifyToken, (req, res) => {
  const candidatura_id = req.params.id;
  const usuario_id = req.usuario.id;

  // Verificar que el usuario sea el que se postuló
  db.get(
    "SELECT usuario_id FROM candidaturas WHERE id = ?",
    [candidatura_id],
    (err, candidatura) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al eliminar candidatura" });
      }

      if (!candidatura || candidatura.usuario_id !== usuario_id) {
        return res.status(403).json({ error: "No tienes permiso para eliminar esta candidatura" });
      }

      db.run(
        "DELETE FROM candidaturas WHERE id = ?",
        [candidatura_id],
        (err) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Error al eliminar candidatura" });
          }

          res.json({ mensaje: "Candidatura eliminada" });
        }
      );
    }
  );
});

/* ===========================
   🔹 SEDES
=========================== */

app.post("/sedes", verifyToken, (req, res) => {
  if (req.usuario.tipo !== "clinica") {
    return res.status(403).json({ error: "Solo las clínicas pueden gestionar sedes" });
  }

  const { nombre, ciudad, direccion, codigo_postal, telefono } = req.body;
  if (!nombre || !nombre.trim() || !ciudad || !ciudad.trim()) {
    return res.status(400).json({ error: "Nombre y ciudad son obligatorios" });
  }

  db.run(
    "INSERT INTO sedes (usuario_id, nombre, ciudad, direccion, codigo_postal, telefono) VALUES (?, ?, ?, ?, ?, ?)",
    [req.usuario.id, nombre.trim(), ciudad.trim(), direccion || null, codigo_postal || null, telefono || null],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al crear sede" });
      }
      res.json({ mensaje: "Sede creada", id: this.lastID });
    }
  );
});

app.get("/sedes", verifyToken, (req, res) => {
  db.all(
    "SELECT * FROM sedes WHERE usuario_id = ? ORDER BY nombre",
    [req.usuario.id],
    (err, sedes) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener sedes" });
      }
      res.json({ sedes: sedes || [] });
    }
  );
});

app.put("/sedes/:id", verifyToken, (req, res) => {
  const { nombre, ciudad, direccion, codigo_postal, telefono } = req.body;
  if (!nombre || !nombre.trim() || !ciudad || !ciudad.trim()) {
    return res.status(400).json({ error: "Nombre y ciudad son obligatorios" });
  }

  db.get("SELECT usuario_id FROM sedes WHERE id = ?", [req.params.id], (err, sede) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al actualizar sede" });
    }
    if (!sede || sede.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para modificar esta sede" });
    }

    db.run(
      "UPDATE sedes SET nombre = ?, ciudad = ?, direccion = ?, codigo_postal = ?, telefono = ? WHERE id = ?",
      [nombre.trim(), ciudad.trim(), direccion || null, codigo_postal || null, telefono || null, req.params.id],
      (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al actualizar sede" });
        }
        res.json({ mensaje: "Sede actualizada" });
      }
    );
  });
});

app.delete("/sedes/:id", verifyToken, (req, res) => {
  db.get("SELECT usuario_id FROM sedes WHERE id = ?", [req.params.id], (err, sede) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al eliminar sede" });
    }
    if (!sede || sede.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para eliminar esta sede" });
    }

    // Las publicaciones asociadas quedan sin sede, pero no se tocan
    db.run("UPDATE publicaciones SET sede_id = NULL WHERE sede_id = ?", [req.params.id], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al eliminar sede" });
      }
      db.run("DELETE FROM sedes WHERE id = ?", [req.params.id], (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al eliminar sede" });
        }
        res.json({ mensaje: "Sede eliminada" });
      });
    });
  });
});

/* ===========================
   🔹 PLANTILLAS DE PUBLICACIÓN
=========================== */

app.post("/plantillas", verifyToken, (req, res) => {
  const { nombre, tipo, descripcion, ciudad, contrato, jornada, salario, experiencia,
          nombre_contacto, email_contacto, telefono_contacto, especialidades } = req.body;

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "La plantilla necesita un nombre" });
  }
  if (!["oferta", "solicitud"].includes(tipo)) {
    return res.status(400).json({ error: "Tipo de plantilla inválido" });
  }

  const experienciaNum = experiencia !== undefined && experiencia !== null && experiencia !== ''
    ? parseInt(experiencia)
    : null;

  db.run(
    `INSERT INTO plantillas_publicacion
     (usuario_id, nombre, tipo, descripcion, ciudad, contrato, jornada, salario, experiencia,
      nombre_contacto, email_contacto, telefono_contacto, especialidades)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.usuario.id, nombre.trim(), tipo, descripcion || null, ciudad || null, contrato || null,
     jornada || null, salario || null, experienciaNum, nombre_contacto || null,
     email_contacto || null, telefono_contacto || null,
     JSON.stringify(Array.isArray(especialidades) ? especialidades : [])],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al guardar plantilla" });
      }
      res.json({ mensaje: "Plantilla guardada", id: this.lastID });
    }
  );
});

app.get("/plantillas", verifyToken, (req, res) => {
  db.all(
    "SELECT * FROM plantillas_publicacion WHERE usuario_id = ? ORDER BY nombre",
    [req.usuario.id],
    (err, plantillas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener plantillas" });
      }
      const lista = (plantillas || []).map(p => ({
        ...p,
        especialidades: (() => {
          try { return JSON.parse(p.especialidades || "[]"); } catch (e) { return []; }
        })()
      }));
      res.json({ plantillas: lista });
    }
  );
});

app.delete("/plantillas/:id", verifyToken, (req, res) => {
  db.get("SELECT usuario_id FROM plantillas_publicacion WHERE id = ?", [req.params.id], (err, plantilla) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al eliminar plantilla" });
    }
    if (!plantilla || plantilla.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para eliminar esta plantilla" });
    }
    db.run("DELETE FROM plantillas_publicacion WHERE id = ?", [req.params.id], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al eliminar plantilla" });
      }
      res.json({ mensaje: "Plantilla eliminada" });
    });
  });
});

/* ===========================
   🔹 RESEÑAS
=========================== */

// Crear reseña sobre la otra parte de una candidatura aceptada
app.post("/resenyas", verifyToken, (req, res) => {
  const { candidatura_id, puntuacion, comentario } = req.body;
  const autorId = req.usuario.id;

  const puntuacionNum = parseInt(puntuacion);
  if (!candidatura_id || !puntuacionNum || puntuacionNum < 1 || puntuacionNum > 5) {
    return res.status(400).json({ error: "Puntuación inválida (debe ser de 1 a 5)" });
  }

  db.get(
    `SELECT c.id, c.estado, c.usuario_id as candidato_id, p.usuario_id as propietario_id
     FROM candidaturas c
     INNER JOIN publicaciones p ON c.publicacion_id = p.id
     WHERE c.id = ?`,
    [candidatura_id],
    (err, candidatura) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al crear reseña" });
      }
      if (!candidatura) {
        return res.status(404).json({ error: "Candidatura no encontrada" });
      }
      if (candidatura.estado !== "aceptada") {
        return res.status(400).json({ error: "Solo puedes valorar colaboraciones aceptadas" });
      }
      if (autorId !== candidatura.candidato_id && autorId !== candidatura.propietario_id) {
        return res.status(403).json({ error: "No formas parte de esta candidatura" });
      }

      const destinatarioId = autorId === candidatura.candidato_id
        ? candidatura.propietario_id
        : candidatura.candidato_id;

      db.run(
        `INSERT INTO resenyas (candidatura_id, autor_id, destinatario_id, puntuacion, comentario)
         VALUES (?, ?, ?, ?, ?)`,
        [candidatura_id, autorId, destinatarioId, puntuacionNum, (comentario || "").trim() || null],
        function(err) {
          if (err) {
            if (err.message.includes("UNIQUE")) {
              return res.status(400).json({ error: "Ya has valorado esta colaboración" });
            }
            console.error(err);
            return res.status(500).json({ error: "Error al crear reseña" });
          }
          res.json({ mensaje: "Reseña creada", id: this.lastID });
        }
      );
    }
  );
});

// Reseñas recibidas por un usuario, con media
app.get("/resenyas/usuario/:id", (req, res) => {
  db.all(
    `SELECT r.puntuacion, r.comentario, r.creado_en, u.nombre as autor_nombre, u.tipo as autor_tipo
     FROM resenyas r
     INNER JOIN usuarios u ON r.autor_id = u.id
     WHERE r.destinatario_id = ?
     ORDER BY r.creado_en DESC`,
    [req.params.id],
    (err, resenyas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener reseñas" });
      }
      const lista = resenyas || [];
      const media = lista.length > 0
        ? Math.round((lista.reduce((suma, r) => suma + r.puntuacion, 0) / lista.length) * 10) / 10
        : null;
      res.json({ media, total: lista.length, resenyas: lista });
    }
  );
});

/* ===========================
   🔹 RECORDATORIOS
=========================== */

// Postulaciones pendientes de responder en publicaciones del usuario desde hace >= N días (por defecto 3)
app.get("/recordatorios/pendientes", verifyToken, (req, res) => {
  const diasParam = parseInt(req.query.dias);
  const dias = Number.isNaN(diasParam) ? 3 : Math.max(diasParam, 0);

  db.all(
    `SELECT c.id as candidatura_id, c.creado_en, c.mensaje,
            CAST(julianday('now') - julianday(c.creado_en) AS INTEGER) as dias_esperando,
            u.id as candidato_id, u.nombre as candidato_nombre,
            p.id as publicacion_id, p.ciudad, p.tipo as publicacion_tipo
     FROM candidaturas c
     INNER JOIN publicaciones p ON c.publicacion_id = p.id
     INNER JOIN usuarios u ON c.usuario_id = u.id
     WHERE p.usuario_id = ? AND p.activo = 1 AND c.estado = 'pendiente'
       AND c.creado_en <= datetime('now', ?)
     ORDER BY c.creado_en ASC`,
    [req.usuario.id, `-${dias} days`],
    (err, pendientes) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener recordatorios" });
      }
      res.json({ pendientes: pendientes || [] });
    }
  );
});

/* ===========================
   🔹 FAVORITOS
=========================== */

app.post("/favoritos", verifyToken, (req, res) => {
  const { publicacion_id } = req.body;
  const usuario_id = req.usuario.id;
  const tipoUsuario = req.usuario.tipo;

  if (!publicacion_id) {
    return res.status(400).json({ error: "publicacion_id requerido" });
  }

  db.get("SELECT tipo FROM publicaciones WHERE id = ?", [publicacion_id], (err, pub) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al añadir a favoritos" });
    }
    if (!pub) {
      return res.status(404).json({ error: "Publicación no encontrada" });
    }
    if ((tipoUsuario === 'clinica' && pub.tipo !== 'solicitud') || (tipoUsuario === 'dentista' && pub.tipo !== 'oferta')) {
      return res.status(403).json({ error: "No puedes guardar este tipo de publicación en favoritos" });
    }

    db.run(
      "INSERT INTO favoritos (usuario_id, publicacion_id) VALUES (?, ?)",
      [usuario_id, publicacion_id],
      function(err) {
        if (err) {
          if (err.message.includes("UNIQUE")) {
            return res.status(400).json({ error: "Ya está en tus favoritos" });
          }
          console.error(err);
          return res.status(500).json({ error: "Error al añadir a favoritos" });
        }
        res.json({ mensaje: "Añadido a favoritos", favorito_id: this.lastID });
      }
    );
  });
});

app.get("/favoritos", verifyToken, (req, res) => {
  db.all(
    `SELECT f.id as favorito_id, p.*, u.nombre as usuario_nombre, u.tipo as usuario_tipo, u.email as usuario_email
     FROM favoritos f
     INNER JOIN publicaciones p ON f.publicacion_id = p.id
     LEFT JOIN usuarios u ON p.usuario_id = u.id
     WHERE f.usuario_id = ?
     ORDER BY f.creado_en DESC`,
    [req.usuario.id],
    (err, favoritos) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener favoritos" });
      }
      res.json(favoritos || []);
    }
  );
});

app.delete("/favoritos/:publicacion_id", verifyToken, (req, res) => {
  db.run(
    "DELETE FROM favoritos WHERE usuario_id = ? AND publicacion_id = ?",
    [req.usuario.id, req.params.publicacion_id],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al quitar de favoritos" });
      }
      res.json({ mensaje: "Quitado de favoritos" });
    }
  );
});

/* ===========================
   🔹 BÚSQUEDAS GUARDADAS Y ALERTAS
=========================== */

app.post("/busquedas-guardadas", verifyToken, (req, res) => {
  const { nombre, tipo, ciudad, especialidad_id, contrato, jornada, salarioMin, experienciaMin } = req.body;
  const usuario_id = req.usuario.id;

  if (!tipo) {
    return res.status(400).json({ error: "tipo requerido" });
  }

  db.run(
    `INSERT INTO busquedas_guardadas
     (usuario_id, nombre, tipo, ciudad, especialidad_id, contrato, jornada, salario_min, experiencia_minima)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [usuario_id, nombre || null, tipo, ciudad || null, especialidad_id || null, contrato || null, jornada || null,
     salarioMin || null, experienciaMin !== undefined && experienciaMin !== '' ? experienciaMin : null],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al guardar búsqueda" });
      }
      res.json({ mensaje: "Búsqueda guardada", id: this.lastID });
    }
  );
});

app.get("/busquedas-guardadas", verifyToken, (req, res) => {
  db.all(
    "SELECT * FROM busquedas_guardadas WHERE usuario_id = ? ORDER BY creado_en DESC",
    [req.usuario.id],
    (err, busquedas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener búsquedas guardadas" });
      }
      res.json(busquedas || []);
    }
  );
});

app.delete("/busquedas-guardadas/:id", verifyToken, (req, res) => {
  db.get("SELECT usuario_id FROM busquedas_guardadas WHERE id = ?", [req.params.id], (err, busqueda) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al eliminar búsqueda guardada" });
    }
    if (!busqueda || busqueda.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para eliminar esta búsqueda" });
    }
    db.run("DELETE FROM busquedas_guardadas WHERE id = ?", [req.params.id], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al eliminar búsqueda guardada" });
      }
      res.json({ mensaje: "Búsqueda guardada eliminada" });
    });
  });
});

app.get("/alertas", verifyToken, (req, res) => {
  db.all(
    `SELECT a.id as alerta_id, a.leido, a.creado_en as alerta_creado_en, p.*
     FROM alertas a
     INNER JOIN publicaciones p ON a.publicacion_id = p.id
     WHERE a.usuario_id = ?
     ORDER BY a.creado_en DESC`,
    [req.usuario.id],
    (err, alertas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener alertas" });
      }
      db.run("UPDATE alertas SET leido = 1 WHERE usuario_id = ? AND leido = 0", [req.usuario.id]);
      res.json(alertas || []);
    }
  );
});

app.get("/alertas/no-leidas/count", verifyToken, (req, res) => {
  db.get(
    "SELECT COUNT(*) as total FROM alertas WHERE usuario_id = ? AND leido = 0",
    [req.usuario.id],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener alertas sin leer" });
      }
      res.json({ total: result.total || 0 });
    }
  );
});

/* ===========================
   🔹 INICIAR SERVIDOR
=========================== */

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
