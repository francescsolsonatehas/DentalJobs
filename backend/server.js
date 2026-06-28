const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const db = require("./db");
const { verifyToken, generateToken } = require("./middleware/auth");

const app = express();

app.use(express.json());
app.use(cors());

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

  try {
    // Si password es vacío, guardar como vacío; si no, hashear
    const hashedPassword = password === "" ? "" : bcrypt.hashSync(password, 10);
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
  const { nombre, telefono, movil, direccion, codigo_postal, pais, ciudad } = req.body;
  const usuarioId = req.usuario.id;

  if (!nombre) {
    return res.status(400).json({ error: "El nombre es obligatorio" });
  }

  db.run(
    "UPDATE usuarios SET nombre = ?, telefono = ?, movil = ?, direccion = ?, codigo_postal = ?, pais = ?, ciudad = ? WHERE id = ?",
    [nombre, telefono || null, movil || null, direccion || null, codigo_postal || null, pais || null, ciudad || null, usuarioId],
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

  // passwordActual y passwordNueva pueden ser vacíos (strings vacíos "")
  // Se validarán contra la contraseña actual guardada

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

    // Crear hash de nueva contraseña (puede ser vacía)
    const hashedPassword = passwordNueva === "" ? "" : bcrypt.hashSync(passwordNueva, 10);

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
    "SELECT id, nombre, email, tipo, telefono, movil, direccion, codigo_postal, pais, ciudad, creado_en FROM usuarios WHERE id = ?",
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
  const { tipo, especialidad, ciudad } = req.query;

  let query = "SELECT * FROM publicaciones WHERE activo = 1";
  const params = [];

  if (tipo) {
    query += " AND tipo = ?";
    params.push(tipo);
  }
  if (especialidad) {
    query += " AND especialidad_id = ?";
    params.push(especialidad);
  }
  if (ciudad) {
    query += " AND ciudad LIKE ?";
    params.push(`%${ciudad}%`);
  }

  query += " ORDER BY creado_en DESC";

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
    `SELECT DISTINCT p.* FROM publicaciones p
     INNER JOIN mensajes m ON p.id = m.publicacion_id
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

app.post("/publicaciones", verifyToken, (req, res) => {
  const { tipo, descripcion, ciudad, especialidad_id, contrato, jornada, salario, nombre_contacto, email_contacto, telefono_contacto } = req.body;

  if (!tipo || !ciudad) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  db.run(
    `INSERT INTO publicaciones
     (tipo, descripcion, ciudad, especialidad_id, contrato, jornada, salario, usuario_id, nombre_contacto, email_contacto, telefono_contacto)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tipo, descripcion, ciudad, especialidad_id || null, contrato || null, jornada || null, salario || null, req.usuario.id, nombre_contacto, email_contacto, telefono_contacto],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al crear publicación" });
      }

      res.json({
        mensaje: "Publicación creada",
        id: this.lastID
      });
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
      res.json({ mensaje: "Publicación eliminada" });
    });
  });
});

// Endpoints de estadísticas
app.get("/stats/total-dentistas", (req, res) => {
  db.get(
    "SELECT COUNT(*) as total FROM publicaciones WHERE tipo = 'solicitud' AND activo = 1",
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener total de dentistas" });
      }
      res.json({ total: result.total || 0 });
    }
  );
});

// Estadísticas para dentistas (candidatos)
app.get("/stats/mis-postulaciones/:usuario_id", verifyToken, (req, res) => {
  const usuario_id = req.params.usuario_id;
  db.get(
    `SELECT COUNT(*) as total FROM candidaturas WHERE usuario_id = ?`,
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
     WHERE c.usuario_id = ?
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
  // Contar candidatos únicos que coinciden con Ciudad y Especialidad de mis ofertas
  db.get(
    `SELECT COUNT(DISTINCT s.usuario_id) as total
     FROM publicaciones s
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     AND (
       SELECT COUNT(*) FROM publicaciones o
       WHERE o.usuario_id = ? AND o.tipo = 'oferta' AND o.activo = 1
       AND (o.ciudad = s.ciudad OR s.ciudad LIKE '%' || o.ciudad || '%' OR o.ciudad LIKE '%' || s.ciudad || '%')
       AND (o.especialidad_id = s.especialidad_id OR o.especialidad_id IS NULL OR s.especialidad_id IS NULL)
     ) > 0`,
    [req.params.empresa_id],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener posibles candidatos" });
      }
      res.json({ total: result.total || 0 });
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
    `SELECT DISTINCT s.usuario_id, u.nombre, u.email, u.telefono, u.direccion, u.codigo_postal, u.pais, s.ciudad, e.nombre as especialidad
     FROM publicaciones s
     INNER JOIN usuarios u ON s.usuario_id = u.id
     LEFT JOIN especialidades e ON s.especialidad_id = e.id
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     AND (
       SELECT COUNT(*) FROM publicaciones o
       WHERE o.usuario_id = ? AND o.tipo = 'oferta' AND o.activo = 1
       AND (o.ciudad = s.ciudad OR s.ciudad LIKE '%' || o.ciudad || '%' OR o.ciudad LIKE '%' || s.ciudad || '%')
       AND (o.especialidad_id = s.especialidad_id OR o.especialidad_id IS NULL OR s.especialidad_id IS NULL)
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

app.get("/stats/candidatos-interesados-lista/:empresa_id", verifyToken, (req, res) => {
  db.all(
    `SELECT c.id, c.usuario_id, c.estado, c.mensaje, c.creado_en,
            u.nombre, u.email, u.telefono, u.direccion, u.codigo_postal, u.pais, u.ciudad,
            p.id as publicacion_id, p.descripcion as oferta_descripcion
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
            p.id as publicacion_id, p.descripcion as oferta_descripcion
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
    `SELECT e.nombre as especialidad, COUNT(DISTINCT s.usuario_id) as total
     FROM publicaciones s
     LEFT JOIN especialidades e ON s.especialidad_id = e.id
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     GROUP BY s.especialidad_id, e.nombre
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
    `SELECT s.ciudad, e.nombre as especialidad, COUNT(DISTINCT s.usuario_id) as total
     FROM publicaciones s
     LEFT JOIN especialidades e ON s.especialidad_id = e.id
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     GROUP BY s.ciudad, s.especialidad_id, e.nombre
     ORDER BY s.ciudad, e.nombre`,
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
    `SELECT DISTINCT s.usuario_id, u.nombre, u.email, u.telefono, u.direccion, u.codigo_postal, u.pais, s.ciudad, e.nombre as especialidad
     FROM publicaciones s
     INNER JOIN usuarios u ON s.usuario_id = u.id
     LEFT JOIN especialidades e ON s.especialidad_id = e.id
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     AND (e.nombre = ? OR (? = 'Sin especialidad' AND s.especialidad_id IS NULL))`,
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
    `SELECT DISTINCT s.usuario_id, u.nombre, u.email, u.telefono, u.direccion, u.codigo_postal, u.pais, s.ciudad, e.nombre as especialidad
     FROM publicaciones s
     INNER JOIN usuarios u ON s.usuario_id = u.id
     LEFT JOIN especialidades e ON s.especialidad_id = e.id
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     AND s.ciudad = ?`,
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
    `SELECT DISTINCT s.usuario_id, u.nombre, u.email, u.telefono, u.direccion, u.codigo_postal, u.pais, s.ciudad, e.nombre as especialidad
     FROM publicaciones s
     INNER JOIN usuarios u ON s.usuario_id = u.id
     LEFT JOIN especialidades e ON s.especialidad_id = e.id
     WHERE s.tipo = 'solicitud' AND s.activo = 1
     AND s.ciudad = ?
     AND (e.nombre = ? OR (? = 'Sin especialidad' AND s.especialidad_id IS NULL))`,
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
   🔹 ARCHIVOS
=========================== */

app.post("/archivos/upload", verifyToken, upload.single("archivo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se envió ningún archivo" });
  }

  const { tipo } = req.body;
  if (!tipo || !["cv", "portfolio"].includes(tipo)) {
    return res.status(400).json({ error: "Tipo de archivo inválido" });
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
    `SELECT c.*, , p.descripcion, p.ciudad, p.contrato, p.jornada, p.salario,
            u.nombre as empresa_nombre, u.email as empresa_email
     FROM candidaturas c
     JOIN publicaciones p ON c.publicacion_id = p.id
     JOIN usuarios u ON p.usuario_id = u.id
     WHERE c.usuario_id = ?
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

  if (!["pendiente", "aceptada", "rechazada"].includes(estado)) {
    return res.status(400).json({ error: "Estado inválido" });
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
   🔹 INICIAR SERVIDOR
=========================== */

app.listen(3000, () => {
  console.log("✅ Servidor corriendo en http://localhost:3000");
});
