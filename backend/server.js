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

  if (!nombre || !email || !password || !tipo) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  if (!["clinica", "dentista"].includes(tipo)) {
    return res.status(400).json({ error: "Tipo de usuario inválido" });
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

  if (!email || !password) {
    return res.status(400).json({ error: "Email y contraseña requeridos" });
  }

  db.get("SELECT * FROM usuarios WHERE email = ?", [email], (err, usuario) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error en login" });
    }

    if (!usuario) {
      return res.status(400).json({ error: "Email o contraseña incorrectos" });
    }

    const esValido = bcrypt.compareSync(password, usuario.password);
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

app.post("/publicaciones", verifyToken, (req, res) => {
  const { tipo, titulo, descripcion, ciudad, especialidad_id, contrato, jornada, salario, nombre_contacto, email_contacto, telefono_contacto } = req.body;

  if (!tipo || !titulo || !ciudad) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  db.run(
    `INSERT INTO publicaciones
     (tipo, titulo, descripcion, ciudad, especialidad_id, contrato, jornada, salario, usuario_id, nombre_contacto, email_contacto, telefono_contacto)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tipo, titulo, descripcion, ciudad, especialidad_id || null, contrato || null, jornada || null, salario || null, req.usuario.id, nombre_contacto, email_contacto, telefono_contacto],
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
  // Contar candidatos únicos que han enviado mensaje a mis ofertas
  db.get(
    `SELECT COUNT(DISTINCT m.usuario_id) as total
     FROM mensajes m
     INNER JOIN publicaciones p ON m.publicacion_id = p.id
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
    `SELECT DISTINCT s.usuario_id, u.nombre, u.email
     FROM publicaciones s
     INNER JOIN usuarios u ON s.usuario_id = u.id
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
    `SELECT DISTINCT m.usuario_id, u.nombre, u.email
     FROM mensajes m
     INNER JOIN usuarios u ON m.usuario_id = u.id
     INNER JOIN publicaciones p ON m.publicacion_id = p.id
     WHERE p.usuario_id = ? AND p.tipo = 'oferta' AND p.activo = 1`,
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
    `SELECT DISTINCT u.id as usuario_id, u.nombre, u.email, u.telefono, u.direccion, u.codigo_postal, u.pais, p.ciudad, e.nombre as especialidad
     FROM usuarios u
     INNER JOIN publicaciones p ON u.id = p.usuario_id AND p.tipo = 'solicitud'
     INNER JOIN mensajes m ON p.id = m.publicacion_id
     LEFT JOIN especialidades e ON p.especialidad_id = e.id
     WHERE m.usuario_id = ?`,
    [req.params.empresa_id],
    (err, contactados) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener contactados" });
      }
      res.json(contactados || []);
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
   🔹 INICIAR SERVIDOR
=========================== */

app.listen(3000, () => {
  console.log("✅ Servidor corriendo en http://localhost:3000");
});
