// Cargar variables de entorno desde backend/.env (en Render vienen del panel).
// En tests NO se carga: usan siempre una BD temporal local, jamás Turso.
if (process.env.NODE_ENV !== "test") {
  require("dotenv").config({ path: require("path").join(__dirname, ".env") });
}

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
const { enviarEmail, plantilla, urlFrontend } = require("./email");
const { ETIQUETAS_ESTADO } = require("./catalogos");
const { construirFiltros } = require("./filtros-publicaciones");
const { generarCsv } = require("./exportaciones");
const { geocodificarCiudad } = require("./municipios-coords");
const { expandirRango, sanearDias } = require("./fechas");
const crypto = require("crypto");

// Notifica por email a un usuario, si tiene los avisos activados
function notificarUsuario(usuarioId, asunto, titulo, cuerpo, textoBoton) {
  db.get("SELECT nombre, email, recibir_emails FROM usuarios WHERE id = ?", [usuarioId], (err, u) => {
    if (err || !u || !u.recibir_emails) return;
    if ((u.email || "").endsWith("@dentaljobs.invalid")) return; // cuentas eliminadas

    enviarEmail(u.email, asunto, plantilla(titulo, cuerpo, urlFrontend(), textoBoton || "Abrir DentalJobs"))
      .catch(e => console.error("Error al enviar notificación:", e.message));
  });
}

// Autenticación de administración: sin panel de roles todavía, se protege
// con un token secreto (ADMIN_TOKEN) que solo conoce quien opera la plataforma.
function verificarAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

// Dentistas cuya ciudad y especialidad coinciden con las ofertas activas de una clínica
// (misma lógica que /stats/posibles-candidatos-lista/:empresa_id, reutilizada para el resumen semanal)
function listarDentistasPotencialesParaClinica(empresaId, callback) {
  db.all(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT DISTINCT s.id as publicacion_id, s.usuario_id, u.nombre, u.email, s.ciudad
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
    [empresaId],
    callback
  );
}

// Clínicas cuya ciudad y especialidad coinciden con las solicitudes activas de un dentista
// (misma lógica que /stats/clinicas-potenciales-lista/:usuario_id, reutilizada para el resumen semanal)
function listarClinicasPotencialesParaDentista(usuarioId, callback) {
  db.all(
    `WITH pub_esp AS (
       SELECT pe.publicacion_id, pe.especialidad_id FROM publicacion_especialidades pe
       UNION
       SELECT p.id as publicacion_id, p.especialidad_id FROM publicaciones p
       WHERE p.especialidad_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM publicacion_especialidades WHERE publicacion_id = p.id)
     )
     SELECT DISTINCT s.id as publicacion_id, o.usuario_id, u.nombre, u.email, o.ciudad
     FROM publicaciones o
     INNER JOIN usuarios u ON o.usuario_id = u.id
     INNER JOIN publicaciones s ON s.usuario_id = ? AND s.tipo = 'solicitud' AND s.activo = 1
       AND (o.ciudad = s.ciudad OR s.ciudad LIKE '%' || o.ciudad || '%' OR o.ciudad LIKE '%' || s.ciudad || '%')
     WHERE o.tipo = 'oferta' AND o.activo = 1
     AND (
       NOT EXISTS (SELECT 1 FROM pub_esp WHERE publicacion_id = o.id)
       OR NOT EXISTS (SELECT 1 FROM pub_esp WHERE publicacion_id = s.id)
       OR EXISTS (
         SELECT 1 FROM pub_esp peo INNER JOIN pub_esp pes ON peo.especialidad_id = pes.especialidad_id
         WHERE peo.publicacion_id = o.id AND pes.publicacion_id = s.id
       )
     )`,
    [usuarioId],
    callback
  );
}

// Catálogos fijos (sin tabla propia, como contrato/jornada)
const EQUIPAMIENTO_CATALOGO = ["CBCT / TAC 3D", "CAD-CAM", "Microscopio", "Escáner intraoral", "Láser dental", "Sedación consciente"];
const CERTIFICACIONES_CATALOGO = ["Invisalign", "Implantología avanzada", "Ortodoncia lingual", "Estética dental avanzada", "Sedación consciente", "Cirugía guiada"];

const app = express();

// Detrás de un proxy (Render, Caddy…) la IP real llega en X-Forwarded-For
app.set("trust proxy", 1);

// CSP desactivada: el frontend actual usa estilos y manejadores onclick inline
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json());

// CORS: en producción, restringido al origen del frontend (GitHub Pages);
// sin CORS_ORIGIN definido (desarrollo), se permite cualquier origen.
const origenesCors = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(o => o.trim())
  : true;
app.use(cors({ origin: origenesCors }));
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
  const { nombre, email, password, tipo, telefono, direccion, codigo_postal, pais, aceptaTerminos } = req.body;

  if (!nombre || !email || !tipo) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  if (aceptaTerminos !== true) {
    return res.status(400).json({ error: "Debes aceptar la política de privacidad y los términos de uso" });
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
      "INSERT INTO usuarios (nombre, email, password, tipo, telefono, direccion, codigo_postal, pais, acepto_terminos_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
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

        // Token de verificación de email (7 días) — el insert se completa antes de responder
        const tokenVerificacion = crypto.randomBytes(32).toString("hex");
        const expiracion = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        db.run(
          "INSERT INTO tokens_verificacion (usuario_id, tipo, token, expiracion) VALUES (?, 'verificacion', ?, ?)",
          [usuario.id, tokenVerificacion, expiracion],
          (err) => {
            if (err) console.error("Error al crear token de verificación:", err);

            res.json({ mensaje: "Usuario registrado", token, usuario });

            enviarEmail(
              email,
              "Verifica tu email en DentalJobs",
              plantilla(
                `¡Bienvenido/a, ${nombre}!`,
                "Gracias por registrarte en DentalJobs. Confirma tu dirección de correo para que las clínicas y dentistas sepan que tu cuenta es real.",
                `${urlFrontend()}#verificar=${tokenVerificacion}`,
                "Verificar mi email"
              )
            ).catch(e => console.error("Error al enviar email de verificación:", e.message));
          }
        );
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

    // Cuentas antiguas sin contraseña: obligar a crear una por email
    if (usuario.password === "") {
      return res.status(403).json({
        error: "Tu cuenta no tiene contraseña. Usa '¿Has olvidado tu contraseña?' para crear una."
      });
    }

    const esValido = bcrypt.compareSync(password || "", usuario.password);

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

// Derecho de supresión (RGPD): borra los datos personales y anonimiza lo que
// forma parte del historial de otros usuarios (mensajes, reseñas).
app.delete("/auth/mi-cuenta", verifyToken, (req, res) => {
  const usuarioId = req.usuario.id;
  const { password } = req.body || {};

  db.get("SELECT password FROM usuarios WHERE id = ?", [usuarioId], (err, usuario) => {
    if (err || !usuario) {
      console.error(err);
      return res.status(500).json({ error: "Error al eliminar la cuenta" });
    }

    // Confirmación con contraseña (las cuentas antiguas sin contraseña pasan solo con el token)
    if (usuario.password !== "" && !bcrypt.compareSync(password || "", usuario.password)) {
      return res.status(403).json({ error: "Contraseña incorrecta" });
    }

    // Cascada: se ejecuta en orden por la cola secuencial del adaptador
    const pasos = [
      // Publicaciones propias: desactivar y vaciar datos de contacto (las candidaturas ajenas quedan 'retiradas')
      ["UPDATE candidaturas SET estado = 'retirada', actualizado_en = CURRENT_TIMESTAMP WHERE estado != 'retirada' AND publicacion_id IN (SELECT id FROM publicaciones WHERE usuario_id = ?)", [usuarioId]],
      ["UPDATE publicaciones SET activo = 0, sede_id = NULL, descripcion = '[Publicación eliminada]', nombre_contacto = 'Usuario eliminado', email_contacto = '', telefono_contacto = NULL WHERE usuario_id = ?", [usuarioId]],
      // Actividad propia. Las candidaturas con reseñas asociadas no se pueden
      // borrar (las referencian): se conservan sin el mensaje personal.
      ["UPDATE candidaturas SET mensaje = NULL WHERE usuario_id = ?", [usuarioId]],
      ["DELETE FROM candidaturas WHERE usuario_id = ? AND id NOT IN (SELECT candidatura_id FROM resenyas)", [usuarioId]],
      ["DELETE FROM archivos WHERE usuario_id = ?", [usuarioId]],
      ["DELETE FROM favoritos WHERE usuario_id = ?", [usuarioId]],
      ["DELETE FROM tokens_verificacion WHERE usuario_id = ?", [usuarioId]],
      ["DELETE FROM confirmacion_email WHERE usuario_id = ?", [usuarioId]],
      ["DELETE FROM plantillas_publicacion WHERE usuario_id = ?", [usuarioId]],
      ["DELETE FROM sedes WHERE usuario_id = ?", [usuarioId]],
      ["DELETE FROM experiencia_laboral WHERE usuario_id = ?", [usuarioId]],
      ["DELETE FROM formacion WHERE usuario_id = ?", [usuarioId]],
      ["DELETE FROM idiomas WHERE usuario_id = ?", [usuarioId]],
      ["DELETE FROM certificaciones WHERE usuario_id = ?", [usuarioId]],
      // Historial compartido: anonimizar, no borrar
      ["UPDATE mensajes SET remitente_nombre = 'Usuario eliminado', remitente_email = '' WHERE usuario_id = ?", [usuarioId]],
      // La fila de usuario se anonimiza para mantener íntegras las referencias (reseñas, mensajes)
      [`UPDATE usuarios SET nombre = 'Usuario eliminado', email = 'eliminado-' || id || '@dentaljobs.invalid',
        password = '!cuenta-eliminada!', telefono = NULL, movil = NULL, direccion = NULL, codigo_postal = NULL,
        pais = NULL, ciudad = NULL, descripcion = NULL, anyos_experiencia = NULL, email_verificado = 0,
        acepto_terminos_en = NULL
        WHERE id = ?`, [usuarioId]]
    ];

    const ejecutar = (i) => {
      if (i >= pasos.length) {
        return res.json({ success: true, mensaje: "Cuenta eliminada. Tus datos personales han sido borrados." });
      }
      db.run(pasos[i][0], pasos[i][1], (err) => {
        if (err) {
          console.error("Error en el borrado de cuenta (paso " + i + "):", err);
          return res.status(500).json({ error: "Error al eliminar la cuenta" });
        }
        ejecutar(i + 1);
      });
    };
    ejecutar(0);
  });
});

// Recuperación de contraseña: siempre responde igual, exista o no el email
app.post("/auth/olvide-password", (req, res) => {
  const { email } = req.body;
  const respuestaNeutra = { success: true, mensaje: "Si el email está registrado, te hemos enviado instrucciones." };

  if (!email) {
    return res.status(400).json({ error: "Email requerido" });
  }

  db.get("SELECT id, nombre FROM usuarios WHERE email = ?", [email], (err, usuario) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al procesar la solicitud" });
    }
    if (!usuario) {
      return res.json(respuestaNeutra);
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiracion = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora

    db.run(
      "INSERT INTO tokens_verificacion (usuario_id, tipo, token, expiracion) VALUES (?, 'password', ?, ?)",
      [usuario.id, token, expiracion],
      (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al procesar la solicitud" });
        }

        res.json(respuestaNeutra);

        enviarEmail(
          email,
          "Restablece tu contraseña de DentalJobs",
          plantilla(
            `Hola, ${usuario.nombre}`,
            "Hemos recibido una solicitud para restablecer tu contraseña. Si no has sido tú, ignora este correo. El enlace caduca en 1 hora.",
            `${urlFrontend()}#restablecer=${token}`,
            "Crear nueva contraseña"
          )
        ).catch(e => console.error("Error al enviar email de recuperación:", e.message));
      }
    );
  });
});

app.post("/auth/restablecer-password", (req, res) => {
  const { token, passwordNueva } = req.body;

  if (!token) {
    return res.status(400).json({ error: "Token requerido" });
  }
  if (!passwordNueva || typeof passwordNueva !== "string" || passwordNueva.length < 8) {
    return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres" });
  }

  db.get(
    "SELECT * FROM tokens_verificacion WHERE token = ? AND tipo = 'password' AND expiracion > datetime('now')",
    [token],
    (err, registro) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al restablecer contraseña" });
      }
      if (!registro) {
        return res.status(400).json({ error: "Enlace inválido o caducado. Solicita uno nuevo." });
      }

      const hashedPassword = bcrypt.hashSync(passwordNueva, 10);
      // Llegar por email también verifica la dirección
      db.run(
        "UPDATE usuarios SET password = ?, email_verificado = 1 WHERE id = ?",
        [hashedPassword, registro.usuario_id],
        (err) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Error al restablecer contraseña" });
          }
          db.run("DELETE FROM tokens_verificacion WHERE id = ?", [registro.id], () => {
            res.json({ success: true, mensaje: "Contraseña actualizada. Ya puedes iniciar sesión." });
          });
        }
      );
    }
  );
});

// Verificación de la dirección de email (enlace del correo de bienvenida)
app.get("/auth/verificar-email/:token", (req, res) => {
  db.get(
    "SELECT * FROM tokens_verificacion WHERE token = ? AND tipo = 'verificacion' AND expiracion > datetime('now')",
    [req.params.token],
    (err, registro) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al verificar email" });
      }
      if (!registro) {
        return res.status(400).json({ error: "Enlace inválido o caducado" });
      }

      db.run("UPDATE usuarios SET email_verificado = 1 WHERE id = ?", [registro.usuario_id], (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al verificar email" });
        }
        db.run("DELETE FROM tokens_verificacion WHERE id = ?", [registro.id], () => {
          res.json({ success: true, mensaje: "Email verificado correctamente" });
        });
      });
    }
  );
});

app.post("/auth/reenviar-verificacion", verifyToken, (req, res) => {
  db.get("SELECT id, nombre, email, email_verificado FROM usuarios WHERE id = ?", [req.usuario.id], (err, usuario) => {
    if (err || !usuario) {
      return res.status(500).json({ error: "Error al reenviar verificación" });
    }
    if (usuario.email_verificado) {
      return res.json({ success: true, mensaje: "Tu email ya está verificado" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiracion = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.run(
      "INSERT INTO tokens_verificacion (usuario_id, tipo, token, expiracion) VALUES (?, 'verificacion', ?, ?)",
      [usuario.id, token, expiracion],
      (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al reenviar verificación" });
        }
        res.json({ success: true, mensaje: "Te hemos reenviado el correo de verificación" });

        enviarEmail(
          usuario.email,
          "Verifica tu email en DentalJobs",
          plantilla(
            `Hola, ${usuario.nombre}`,
            "Confirma tu dirección de correo pulsando el botón.",
            `${urlFrontend()}#verificar=${token}`,
            "Verificar mi email"
          )
        ).catch(e => console.error("Error al reenviar verificación:", e.message));
      }
    );
  });
});

app.put("/auth/actualizar-perfil", verifyToken, (req, res) => {
  const { nombre, telefono, movil, direccion, codigo_postal, pais, ciudad, provincia, descripcion, anyos_experiencia } = req.body;
  const usuarioId = req.usuario.id;

  if (!nombre) {
    return res.status(400).json({ error: "El nombre es obligatorio" });
  }

  const experiencia = anyos_experiencia !== undefined && anyos_experiencia !== null && anyos_experiencia !== ''
    ? parseInt(anyos_experiencia)
    : null;

  // Preferencia de avisos por email: si el cliente no la envía, se mantiene activada
  const recibirEmails = req.body.recibir_emails === false || req.body.recibir_emails === 0 ? 0 : 1;

  db.run(
    "UPDATE usuarios SET nombre = ?, telefono = ?, movil = ?, direccion = ?, codigo_postal = ?, pais = ?, ciudad = ?, provincia = ?, descripcion = ?, anyos_experiencia = ?, recibir_emails = ? WHERE id = ?",
    [nombre, telefono || null, movil || null, direccion || null, codigo_postal || null, pais || null, ciudad || null, provincia || null, (descripcion || "").trim() || null, experiencia, recibirEmails, usuarioId],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al actualizar perfil" });
      }
      res.json({ success: true, message: "Perfil actualizado correctamente" });
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

app.get("/auth/mis-certificaciones", verifyToken, (req, res) => {
  db.all(
    "SELECT certificacion FROM certificaciones WHERE usuario_id = ?",
    [req.usuario.id],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener certificaciones" });
      }
      res.json({ certificaciones: (rows || []).map(r => r.certificacion) });
    }
  );
});

app.post("/auth/guardar-certificaciones", verifyToken, (req, res) => {
  const { certificaciones } = req.body;
  const usuarioId = req.usuario.id;

  if (!Array.isArray(certificaciones)) {
    return res.status(400).json({ error: "Certificaciones debe ser un array" });
  }

  const validas = certificaciones.filter(c => CERTIFICACIONES_CATALOGO.includes(c));

  db.run("DELETE FROM certificaciones WHERE usuario_id = ?", [usuarioId], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al guardar certificaciones" });
    }
    if (validas.length === 0) {
      return res.json({ success: true, message: "Certificaciones guardadas" });
    }

    const stmt = db.prepare("INSERT INTO certificaciones (usuario_id, certificacion) VALUES (?, ?)");
    validas.forEach(c => stmt.run(usuarioId, c));
    stmt.finalize((err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al guardar certificaciones" });
      }
      res.json({ success: true, message: "Certificaciones guardadas correctamente" });
    });
  });
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
    const token = crypto.randomBytes(32).toString('hex');
    const expiracion = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    db.run(
      "INSERT INTO confirmacion_email (usuario_id, nuevo_email, token, expiracion, datos) VALUES (?, ?, ?, ?, ?)",
      [usuarioId, nuevoEmail, token, expiracion.toISOString(), JSON.stringify(datos)],
      function(err) {
        if (err) {
          console.error("Error al insertar token:", err);
          return res.status(500).json({ error: "Error al procesar cambio de email" });
        }

        // El token viaja SOLO por correo, al email nuevo (demuestra que es suyo)
        res.json({ success: true, message: "Email de confirmación enviado" });

        enviarEmail(
          nuevoEmail,
          "Confirma tu nuevo email en DentalJobs",
          plantilla(
            "Confirma el cambio de email",
            "Has pedido cambiar tu dirección de correo en DentalJobs a esta. Confírmalo pulsando el botón. Si no has sido tú, ignora este mensaje y tu email actual seguirá activo.",
            `${urlFrontend()}#confirmar-email=${token}`,
            "Confirmar nuevo email"
          )
        ).catch(e => console.error("Error al enviar confirmación de cambio de email:", e.message));
      }
    );
  });
});

app.get("/auth/mi-perfil", verifyToken, (req, res) => {
  const usuarioId = req.usuario.id;

  db.get(
    "SELECT id, nombre, email, tipo, telefono, movil, direccion, codigo_postal, pais, ciudad, provincia, descripcion, anyos_experiencia, email_verificado, recibir_emails, creado_en FROM usuarios WHERE id = ?",
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
// Recopila todos los datos que componen el CV de un dentista.
// Reutilizado por el PDF (/auth/mi-cv.pdf) y por la vista previa en pantalla (/auth/mi-cv).
async function recopilarDatosCv(usuarioId) {
  const get = (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (e, r) => e ? reject(e) : resolve(r)));
  const all = (sql, params) => new Promise((resolve, reject) => db.all(sql, params, (e, r) => e ? reject(e) : resolve(r)));

  const usuario = await get(
    "SELECT nombre, email, telefono, movil, ciudad, direccion, codigo_postal, pais, descripcion, anyos_experiencia FROM usuarios WHERE id = ?",
    [usuarioId]
  );
  if (!usuario) return null;

  const especialidades = await all(
    `SELECT e.nombre FROM especialidades e
     INNER JOIN usuario_especialidades ue ON e.id = ue.especialidad_id
     WHERE ue.usuario_id = ? ORDER BY e.nombre`,
    [usuarioId]
  );
  const resenyas = await get(
    "SELECT COUNT(*) as total, AVG(puntuacion) as media FROM resenyas WHERE destinatario_id = ?",
    [usuarioId]
  );
  const solicitudes = await all(
    `SELECT ciudad, descripcion, contrato, jornada, creado_en FROM publicaciones
     WHERE usuario_id = ? AND tipo = 'solicitud' AND activo = 1 ORDER BY creado_en DESC`,
    [usuarioId]
  );
  const experienciaLaboral = await all(
    "SELECT puesto, lugar, fecha_inicio, fecha_fin, actual, descripcion FROM experiencia_laboral WHERE usuario_id = ? ORDER BY orden ASC, fecha_inicio DESC",
    [usuarioId]
  );
  const formacionLista = await all(
    "SELECT titulo, centro, anyo FROM formacion WHERE usuario_id = ? ORDER BY orden ASC, anyo DESC",
    [usuarioId]
  );
  const idiomasLista = await all(
    "SELECT idioma, nivel FROM idiomas WHERE usuario_id = ? ORDER BY id ASC",
    [usuarioId]
  );
  const certificacionesLista = await all(
    "SELECT certificacion FROM certificaciones WHERE usuario_id = ? ORDER BY certificacion ASC",
    [usuarioId]
  );

  return { usuario, especialidades, resenyas, solicitudes, experienciaLaboral, formacionLista, idiomasLista, certificacionesLista };
}

// Vista previa del CV en JSON (misma información que el PDF, para mostrarla en pantalla)
app.get("/auth/mi-cv", verifyToken, async (req, res) => {
  if (req.usuario.tipo !== "dentista") {
    return res.status(403).json({ error: "El CV solo está disponible para dentistas" });
  }
  try {
    const datos = await recopilarDatosCv(req.usuario.id);
    if (!datos) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener el CV" });
  }
});

app.get("/auth/mi-cv.pdf", verifyToken, async (req, res) => {
  if (req.usuario.tipo !== "dentista") {
    return res.status(403).json({ error: "El CV en PDF solo está disponible para dentistas" });
  }

  try {
    const datos = await recopilarDatosCv(req.usuario.id);
    if (!datos) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    const { usuario, especialidades, resenyas, solicitudes, experienciaLaboral, formacionLista, idiomasLista, certificacionesLista } = datos;

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

    if (experienciaLaboral.length > 0) {
      seccion("Experiencia laboral");
      experienciaLaboral.forEach(e => {
        const rango = [e.fecha_inicio, e.actual ? "Actualidad" : e.fecha_fin].filter(Boolean).join(" – ");
        doc.font("Helvetica-Bold").text(`${e.puesto}${e.lugar ? ` · ${e.lugar}` : ""}`);
        if (rango) doc.font("Helvetica").fillColor(gris).fontSize(10).text(rango);
        if (e.descripcion) doc.font("Helvetica").fillColor(gris).fontSize(11).text(e.descripcion, { lineGap: 1 });
        doc.fillColor("#1f2937").fontSize(11);
        doc.moveDown(0.4);
      });
    }

    if (formacionLista.length > 0) {
      seccion("Formación");
      formacionLista.forEach(f => {
        const linea = [f.titulo, f.centro].filter(Boolean).join(" · ") + (f.anyo ? ` (${f.anyo})` : "");
        doc.text(linea);
      });
    }

    if (idiomasLista.length > 0) {
      seccion("Idiomas");
      doc.text(idiomasLista.map(i => `${i.idioma} (${i.nivel})`).join("  ·  "));
    }

    if (especialidades.length > 0) {
      seccion("Especialidades");
      especialidades.forEach(e => doc.text(`•  ${e.nombre}`));
    }

    if (certificacionesLista.length > 0) {
      seccion("Certificaciones");
      certificacionesLista.forEach(c => doc.text(`•  ${c.certificacion}`));
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

// Perfil público de un usuario (datos no sensibles, para mostrar en fichas).
// No se expone email/teléfono/dirección de cuenta: el contacto es por el chat.
// Incluye especialidades y, en clínicas, las sedes completas (dato de negocio).
app.get("/usuarios/:id/publico", (req, res) => {
  const id = req.params.id;
  db.get(
    "SELECT id, nombre, tipo, ciudad, provincia, pais, descripcion, anyos_experiencia, creado_en FROM usuarios WHERE id = ?",
    [id],
    (err, usuario) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener perfil" });
      }
      if (!usuario) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }

      // Especialidades (dentistas y clínicas)
      db.all(
        `SELECT e.nombre FROM usuario_especialidades ue
         INNER JOIN especialidades e ON e.id = ue.especialidad_id
         WHERE ue.usuario_id = ? ORDER BY e.nombre`,
        [id],
        (err2, esps) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({ error: "Error al obtener perfil" });
          }
          usuario.especialidades = (esps || []).map(e => e.nombre);

          // Solo las clínicas tienen sedes; para dentistas la ficha no las necesita
          if (usuario.tipo !== "clinica") {
            return res.json(usuario);
          }

          db.all(
            "SELECT id, nombre, ciudad, provincia, direccion, codigo_postal, telefono FROM sedes WHERE usuario_id = ? ORDER BY nombre",
            [id],
            (err3, sedes) => {
              if (err3) {
                console.error(err3);
                return res.status(500).json({ error: "Error al obtener perfil" });
              }
              sedes = sedes || [];
              if (!sedes.length) {
                usuario.sedes = [];
                return res.json(usuario);
              }

              const ids = sedes.map(s => s.id);
              const placeholders = ids.map(() => "?").join(",");
              db.all(
                `SELECT sede_id, equipo FROM sede_equipamiento WHERE sede_id IN (${placeholders})`,
                ids,
                (err4, equipos) => {
                  if (err4) {
                    console.error(err4);
                    return res.status(500).json({ error: "Error al obtener perfil" });
                  }
                  const porSede = {};
                  (equipos || []).forEach(e => { (porSede[e.sede_id] = porSede[e.sede_id] || []).push(e.equipo); });
                  sedes.forEach(s => { s.equipamiento = porSede[s.id] || []; });
                  usuario.sedes = sedes;
                  res.json(usuario);
                }
              );
            }
          );
        }
      );
    }
  );
});

/* ===========================
   🔹 TRAYECTORIA PROFESIONAL (experiencia, formación, idiomas)
=========================== */

// Trayectoria pública de un usuario (visible en su ficha y usada en el CV en PDF)
app.get("/usuarios/:id/trayectoria", (req, res) => {
  const usuarioId = req.params.id;
  db.all(
    "SELECT id, puesto, lugar, fecha_inicio, fecha_fin, actual, descripcion FROM experiencia_laboral WHERE usuario_id = ? ORDER BY orden ASC, fecha_inicio DESC",
    [usuarioId],
    (err, experiencia) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener la trayectoria" });
      }
      db.all(
        "SELECT id, titulo, centro, anyo FROM formacion WHERE usuario_id = ? ORDER BY orden ASC, anyo DESC",
        [usuarioId],
        (err, formacion) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Error al obtener la trayectoria" });
          }
          db.all(
            "SELECT id, idioma, nivel FROM idiomas WHERE usuario_id = ? ORDER BY id ASC",
            [usuarioId],
            (err, idiomas) => {
              if (err) {
                console.error(err);
                return res.status(500).json({ error: "Error al obtener la trayectoria" });
              }
              db.all(
                "SELECT certificacion FROM certificaciones WHERE usuario_id = ? ORDER BY certificacion ASC",
                [usuarioId],
                (err, certs) => {
                  if (err) {
                    console.error(err);
                    return res.status(500).json({ error: "Error al obtener la trayectoria" });
                  }
                  res.json({
                    experiencia: experiencia || [],
                    formacion: formacion || [],
                    idiomas: idiomas || [],
                    certificaciones: (certs || []).map(c => c.certificacion)
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

app.post("/experiencia-laboral", verifyToken, (req, res) => {
  const { puesto, lugar, fecha_inicio, fecha_fin, actual, descripcion } = req.body;
  if (!puesto || !puesto.trim()) {
    return res.status(400).json({ error: "El puesto es obligatorio" });
  }
  db.run(
    `INSERT INTO experiencia_laboral (usuario_id, puesto, lugar, fecha_inicio, fecha_fin, actual, descripcion)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.usuario.id, puesto.trim(), lugar || null, fecha_inicio || null, actual ? null : (fecha_fin || null), actual ? 1 : 0, descripcion || null],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al guardar la experiencia" });
      }
      res.json({ mensaje: "Experiencia guardada", id: this.lastID });
    }
  );
});

app.put("/experiencia-laboral/:id", verifyToken, (req, res) => {
  const { puesto, lugar, fecha_inicio, fecha_fin, actual, descripcion } = req.body;
  if (!puesto || !puesto.trim()) {
    return res.status(400).json({ error: "El puesto es obligatorio" });
  }
  db.get("SELECT usuario_id FROM experiencia_laboral WHERE id = ?", [req.params.id], (err, fila) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al actualizar la experiencia" });
    }
    if (!fila || fila.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para modificar esta experiencia" });
    }
    db.run(
      `UPDATE experiencia_laboral SET puesto = ?, lugar = ?, fecha_inicio = ?, fecha_fin = ?, actual = ?, descripcion = ? WHERE id = ?`,
      [puesto.trim(), lugar || null, fecha_inicio || null, actual ? null : (fecha_fin || null), actual ? 1 : 0, descripcion || null, req.params.id],
      (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al actualizar la experiencia" });
        }
        res.json({ mensaje: "Experiencia actualizada" });
      }
    );
  });
});

app.delete("/experiencia-laboral/:id", verifyToken, (req, res) => {
  db.get("SELECT usuario_id FROM experiencia_laboral WHERE id = ?", [req.params.id], (err, fila) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al eliminar la experiencia" });
    }
    if (!fila || fila.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para eliminar esta experiencia" });
    }
    db.run("DELETE FROM experiencia_laboral WHERE id = ?", [req.params.id], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al eliminar la experiencia" });
      }
      res.json({ mensaje: "Experiencia eliminada" });
    });
  });
});

app.post("/formacion", verifyToken, (req, res) => {
  const { titulo, centro, anyo } = req.body;
  if (!titulo || !titulo.trim()) {
    return res.status(400).json({ error: "El título es obligatorio" });
  }
  db.run(
    "INSERT INTO formacion (usuario_id, titulo, centro, anyo) VALUES (?, ?, ?, ?)",
    [req.usuario.id, titulo.trim(), centro || null, anyo || null],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al guardar la formación" });
      }
      res.json({ mensaje: "Formación guardada", id: this.lastID });
    }
  );
});

app.put("/formacion/:id", verifyToken, (req, res) => {
  const { titulo, centro, anyo } = req.body;
  if (!titulo || !titulo.trim()) {
    return res.status(400).json({ error: "El título es obligatorio" });
  }
  db.get("SELECT usuario_id FROM formacion WHERE id = ?", [req.params.id], (err, fila) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al actualizar la formación" });
    }
    if (!fila || fila.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para modificar esta formación" });
    }
    db.run(
      "UPDATE formacion SET titulo = ?, centro = ?, anyo = ? WHERE id = ?",
      [titulo.trim(), centro || null, anyo || null, req.params.id],
      (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al actualizar la formación" });
        }
        res.json({ mensaje: "Formación actualizada" });
      }
    );
  });
});

app.delete("/formacion/:id", verifyToken, (req, res) => {
  db.get("SELECT usuario_id FROM formacion WHERE id = ?", [req.params.id], (err, fila) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al eliminar la formación" });
    }
    if (!fila || fila.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para eliminar esta formación" });
    }
    db.run("DELETE FROM formacion WHERE id = ?", [req.params.id], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al eliminar la formación" });
      }
      res.json({ mensaje: "Formación eliminada" });
    });
  });
});

app.post("/idiomas", verifyToken, (req, res) => {
  const { idioma, nivel } = req.body;
  if (!idioma || !idioma.trim() || !nivel || !nivel.trim()) {
    return res.status(400).json({ error: "Idioma y nivel son obligatorios" });
  }
  db.run(
    "INSERT INTO idiomas (usuario_id, idioma, nivel) VALUES (?, ?, ?)",
    [req.usuario.id, idioma.trim(), nivel.trim()],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al guardar el idioma" });
      }
      res.json({ mensaje: "Idioma guardado", id: this.lastID });
    }
  );
});

app.delete("/idiomas/:id", verifyToken, (req, res) => {
  db.get("SELECT usuario_id FROM idiomas WHERE id = ?", [req.params.id], (err, fila) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al eliminar el idioma" });
    }
    if (!fila || fila.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para eliminar este idioma" });
    }
    db.run("DELETE FROM idiomas WHERE id = ?", [req.params.id], (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al eliminar el idioma" });
      }
      res.json({ mensaje: "Idioma eliminado" });
    });
  });
});

/* ===========================
   🔹 MATCHING PROACTIVO (resumen semanal por email)
=========================== */

// Envía a cada clínica y dentista un resumen de sus coincidencias activas
// (misma ciudad + especialidad). Pensado para dispararse una vez por semana
// desde un cron externo (GitHub Actions), ya que Render free no trae cron propio.
app.post("/admin/enviar-resumen-semanal", verificarAdmin, (req, res) => {
  // Responder ya: con muchos usuarios el envío puede tardar más de lo que conviene mantener la petición abierta
  res.json({ success: true, mensaje: "Envío de resúmenes semanales en curso" });

  // Avisar también de las alertas de búsqueda guardadas por cada usuario
  procesarAlertasGuardadas();

  db.all("SELECT id, tipo FROM usuarios WHERE tipo IN ('clinica', 'dentista')", (err, usuarios) => {
    if (err || !usuarios) {
      console.error("Error al listar usuarios para el resumen semanal:", err);
      return;
    }

    usuarios.forEach(u => {
      if (u.tipo === 'clinica') {
        listarDentistasPotencialesParaClinica(u.id, (err, candidatos) => {
          if (err) return console.error("Error al calcular dentistas potenciales:", err);
          if (!candidatos || candidatos.length === 0) return;
          notificarUsuario(
            u.id,
            `🔍 ${candidatos.length} dentista${candidatos.length === 1 ? "" : "s"} que encajan con tus ofertas`,
            "Resumen semanal de coincidencias",
            `Esta semana hemos encontrado ${candidatos.length} dentista${candidatos.length === 1 ? "" : "s"} cuya ciudad y especialidad coinciden con tus ofertas activas. Entra en DentalJobs para verlos y contactar.`,
            "Ver dentistas potenciales"
          );
        });
      } else {
        listarClinicasPotencialesParaDentista(u.id, (err, clinicas) => {
          if (err) return console.error("Error al calcular clínicas potenciales:", err);
          if (!clinicas || clinicas.length === 0) return;
          notificarUsuario(
            u.id,
            `🔍 ${clinicas.length} clínica${clinicas.length === 1 ? "" : "s"} que encajan contigo`,
            "Resumen semanal de coincidencias",
            `Esta semana hemos encontrado ${clinicas.length} clínica${clinicas.length === 1 ? "" : "s"} que buscan un perfil como el tuyo en tu ciudad y especialidad. Entra en DentalJobs para verlas y contactar.`,
            "Ver clínicas potenciales"
          );
        });
      }
    });
  });
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

// Catálogos fijos de equipamiento y certificaciones (para pintar checkboxes en el frontend)
app.get("/catalogos", (req, res) => {
  res.json({ equipamiento: EQUIPAMIENTO_CATALOGO, certificaciones: CERTIFICACIONES_CATALOGO });
});

/* ===========================
   🔹 PUBLICACIONES
=========================== */

app.get("/publicaciones", (req, res) => {
  const { tipo, sort, paraUsuarioId } = req.query;

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

  // Búsqueda por radio: geocodificar la ciudad como centro. Si no se reconoce
  // la ciudad, se ignora el radio y se cae al filtro normal por ciudad.
  const filtrosQuery = { ...req.query };
  if (filtrosQuery.radioKm && filtrosQuery.ciudad) {
    const centro = geocodificarCiudad(filtrosQuery.ciudad);
    if (centro) {
      filtrosQuery.latCentro = centro.lat;
      filtrosQuery.lonCentro = centro.lon;
    } else {
      delete filtrosQuery.radioKm;
    }
  }

  const filtros = construirFiltros(filtrosQuery);
  let query = `SELECT ${selectCols} FROM publicaciones p LEFT JOIN usuarios u ON p.usuario_id = u.id WHERE p.activo = 1${filtros.sql}`;
  const params = [...selectParams, ...filtros.params];

  if (sort === 'salario') {
    query += " ORDER BY p.salario_min DESC, p.creado_en DESC";
  } else if (sort === 'ciudad') {
    query += " ORDER BY p.ciudad ASC, p.creado_en DESC";
  } else if (sort === 'fecha') {
    // Para suplencias: las urgentes primero, luego por fecha de inicio más próxima
    query += " ORDER BY p.urgente DESC, p.fecha_desde ASC, p.creado_en DESC";
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

/* ===========================
   🔹 ALERTAS DE BÚSQUEDA GUARDADAS
=========================== */

// Claves de filtro que una alerta puede guardar: las mismas que entiende
// construirFiltros, para que el matching sea idéntico al del listado.
const CLAVES_FILTRO_ALERTA = [
  "tipo", "especialidad", "ciudad", "contrato", "jornada",
  "salarioMin", "salarioMax", "experienciaMin", "q", "equipamiento", "retribucion", "certificacion"
];
const MAX_ALERTAS_POR_USUARIO = 20;

function limpiarFiltrosAlerta(filtros) {
  const limpio = {};
  if (filtros && typeof filtros === "object") {
    for (const clave of CLAVES_FILTRO_ALERTA) {
      const valor = filtros[clave];
      if (valor !== undefined && valor !== null && String(valor).trim() !== "") {
        limpio[clave] = valor;
      }
    }
  }
  return limpio;
}

// Cuenta las publicaciones activas de otros usuarios que encajan con los filtros
// de una alerta. Si `desde` viene informado, solo cuenta las creadas después.
function contarCoincidenciasAlerta(filtrosObj, usuarioId, desde, cb) {
  const filtros = construirFiltros(filtrosObj);
  let sql = `SELECT COUNT(*) AS n FROM publicaciones p LEFT JOIN usuarios u ON p.usuario_id = u.id
             WHERE p.activo = 1 AND (p.usuario_id IS NULL OR p.usuario_id != ?)${filtros.sql}`;
  const params = [usuarioId, ...filtros.params];
  if (desde) {
    sql += " AND p.creado_en > ?";
    params.push(desde);
  }
  db.get(sql, params, (err, row) => cb(err, row ? row.n : 0));
}

// Listar mis alertas, cada una con su recuento actual de coincidencias
app.get("/alertas", verifyToken, (req, res) => {
  db.all(
    "SELECT * FROM alertas_busqueda WHERE usuario_id = ? ORDER BY creado_en DESC",
    [req.usuario.id],
    (err, filas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener alertas" });
      }
      const alertas = (filas || []).map(a => {
        let filtros = {};
        try { filtros = JSON.parse(a.filtros); } catch (e) {}
        return { ...a, filtros };
      });
      if (alertas.length === 0) return res.json({ alertas: [] });

      let pendientes = alertas.length;
      alertas.forEach(a => {
        contarCoincidenciasAlerta(a.filtros, req.usuario.id, null, (e, n) => {
          a.coincidencias = n;
          if (--pendientes === 0) res.json({ alertas });
        });
      });
    }
  );
});

// Crear una alerta a partir de los filtros actuales de búsqueda
app.post("/alertas", verifyToken, (req, res) => {
  const { nombre, filtros, frecuencia } = req.body;
  const filtrosLimpios = limpiarFiltrosAlerta(filtros);
  if (Object.keys(filtrosLimpios).length === 0) {
    return res.status(400).json({ error: "La alerta necesita al menos un filtro" });
  }
  const freq = ["diaria", "semanal"].includes(frecuencia) ? frecuencia : "semanal";

  db.get(
    "SELECT COUNT(*) AS n FROM alertas_busqueda WHERE usuario_id = ?",
    [req.usuario.id],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al guardar la alerta" });
      }
      if (row && row.n >= MAX_ALERTAS_POR_USUARIO) {
        return res.status(400).json({ error: `Solo puedes tener ${MAX_ALERTAS_POR_USUARIO} alertas guardadas` });
      }
      db.run(
        "INSERT INTO alertas_busqueda (usuario_id, nombre, filtros, frecuencia) VALUES (?, ?, ?, ?)",
        [req.usuario.id, (nombre || "").trim() || null, JSON.stringify(filtrosLimpios), freq],
        function (err) {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Error al guardar la alerta" });
          }
          res.json({ id: this.lastID, mensaje: "Alerta guardada" });
        }
      );
    }
  );
});

// Actualizar una alerta (activar/pausar, renombrar, cambiar frecuencia o filtros)
app.put("/alertas/:id", verifyToken, (req, res) => {
  const { nombre, filtros, frecuencia, activa } = req.body;
  db.get("SELECT * FROM alertas_busqueda WHERE id = ?", [req.params.id], (err, a) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al actualizar la alerta" });
    }
    if (!a) return res.status(404).json({ error: "Alerta no encontrada" });
    if (a.usuario_id !== req.usuario.id) return res.status(403).json({ error: "No puedes modificar esta alerta" });

    const nuevoNombre = nombre !== undefined ? ((nombre || "").trim() || null) : a.nombre;
    const nuevaFreq = ["diaria", "semanal"].includes(frecuencia) ? frecuencia : a.frecuencia;
    const nuevaActiva = activa !== undefined ? (activa ? 1 : 0) : a.activa;
    let nuevosFiltros = a.filtros;
    if (filtros !== undefined) {
      const limpio = limpiarFiltrosAlerta(filtros);
      if (Object.keys(limpio).length === 0) {
        return res.status(400).json({ error: "La alerta necesita al menos un filtro" });
      }
      nuevosFiltros = JSON.stringify(limpio);
    }

    db.run(
      "UPDATE alertas_busqueda SET nombre = ?, filtros = ?, frecuencia = ?, activa = ? WHERE id = ?",
      [nuevoNombre, nuevosFiltros, nuevaFreq, nuevaActiva, a.id],
      err => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al actualizar la alerta" });
        }
        res.json({ mensaje: "Alerta actualizada" });
      }
    );
  });
});

// Eliminar una alerta
app.delete("/alertas/:id", verifyToken, (req, res) => {
  db.get("SELECT usuario_id FROM alertas_busqueda WHERE id = ?", [req.params.id], (err, a) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al eliminar la alerta" });
    }
    if (!a) return res.status(404).json({ error: "Alerta no encontrada" });
    if (a.usuario_id !== req.usuario.id) return res.status(403).json({ error: "No puedes eliminar esta alerta" });
    db.run("DELETE FROM alertas_busqueda WHERE id = ?", [req.params.id], err => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al eliminar la alerta" });
      }
      res.json({ mensaje: "Alerta eliminada" });
    });
  });
});

// Recorre las alertas activas y avisa por email de las publicaciones nuevas que
// encajan desde el último aviso. Se dispara junto al resumen semanal (cron externo).
function procesarAlertasGuardadas() {
  db.all("SELECT * FROM alertas_busqueda WHERE activa = 1", (err, alertas) => {
    if (err || !alertas) {
      if (err) console.error("Error al listar alertas para el resumen:", err);
      return;
    }
    alertas.forEach(a => {
      let filtros;
      try { filtros = JSON.parse(a.filtros); } catch (e) { return; }
      const desde = a.ultimo_aviso ||
        new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace("T", " ");
      contarCoincidenciasAlerta(filtros, a.usuario_id, desde, (e, n) => {
        if (e || !n) return;
        const etiqueta = a.nombre ? `«${a.nombre}»` : "tu búsqueda guardada";
        notificarUsuario(
          a.usuario_id,
          `🔔 ${n} publicación${n === 1 ? "" : "es"} nueva${n === 1 ? "" : "s"} para ${etiqueta}`,
          "Nuevas coincidencias para tu alerta",
          `Han aparecido ${n} publicaci${n === 1 ? "ón" : "ones"} nueva${n === 1 ? "" : "s"} que encajan con ${etiqueta}. Entra en DentalJobs para verlas.`,
          "Ver coincidencias"
        );
        db.run("UPDATE alertas_busqueda SET ultimo_aviso = CURRENT_TIMESTAMP WHERE id = ?", [a.id]);
      });
    });
  });
}

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
      if (pub.tipo !== 'suplencia') {
        return res.json(pub);
      }
      // Para las suplencias se adjuntan los días concretos que cubren
      db.all(
        "SELECT fecha FROM suplencia_dias WHERE publicacion_id = ? ORDER BY fecha",
        [pub.id],
        (err2, dias) => {
          pub.dias = (err2 || !dias) ? [] : dias.map(d => d.fecha);
          res.json(pub);
        }
      );
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
     WHERE p.usuario_id = ? AND p.tipo IN ('oferta', 'suplencia') AND p.activo = 1
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

/* ===========================
   🔹 DISPONIBILIDAD DEL DENTISTA (calendario para suplencias)
=========================== */

// Días en los que el dentista se declara disponible para cubrir suplencias.
app.get("/disponibilidad", verifyToken, (req, res) => {
  db.all(
    "SELECT fecha FROM disponibilidad_dentista WHERE usuario_id = ? ORDER BY fecha",
    [req.usuario.id],
    (err, filas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener la disponibilidad" });
      }
      res.json({ dias: (filas || []).map(f => f.fecha) });
    }
  );
});

// Reemplaza el conjunto de días disponibles del dentista por el que llega en dias[].
app.put("/disponibilidad", verifyToken, (req, res) => {
  if (req.usuario.tipo !== "dentista") {
    return res.status(403).json({ error: "Solo los dentistas tienen disponibilidad" });
  }
  const dias = sanearDias(req.body.dias, 366);

  // Reemplazo completo: borrar y reinsertar. Se completan todas las escrituras
  // antes de responder para no dejar ninguna en vuelo (rompería la limpieza en tests).
  db.run("DELETE FROM disponibilidad_dentista WHERE usuario_id = ?", [req.usuario.id], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al guardar la disponibilidad" });
    }
    if (dias.length === 0) {
      return res.json({ success: true, dias: [] });
    }
    const stmt = db.prepare("INSERT OR IGNORE INTO disponibilidad_dentista (usuario_id, fecha) VALUES (?, ?)");
    dias.forEach(dia => stmt.run(req.usuario.id, dia));
    stmt.finalize(() => res.json({ success: true, dias }));
  });
});

// Suplencias activas agrupadas por día para un mes concreto, para la vista de
// calendario. Devuelve { dias: { 'YYYY-MM-DD': [ {id, ciudad, urgente} ] } }.
app.get("/suplencias/calendario", (req, res) => {
  const anyo = parseInt(req.query.anyo);
  const mes = parseInt(req.query.mes); // 1-12
  if (!anyo || !mes || mes < 1 || mes > 12) {
    return res.status(400).json({ error: "Indica un año y un mes válidos" });
  }
  const mm = String(mes).padStart(2, "0");
  const inicio = `${anyo}-${mm}-01`;
  const fin = `${anyo}-${mm}-31`; // comparación de cadenas: cubre todo el mes

  db.all(
    `SELECT sd.fecha, p.id, p.ciudad, p.urgente
     FROM suplencia_dias sd
     JOIN publicaciones p ON p.id = sd.publicacion_id
     WHERE p.activo = 1 AND p.tipo = 'suplencia' AND sd.fecha BETWEEN ? AND ?
     ORDER BY sd.fecha, p.urgente DESC, p.id`,
    [inicio, fin],
    (err, filas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener el calendario" });
      }
      const dias = {};
      (filas || []).forEach(f => {
        (dias[f.fecha] = dias[f.fecha] || []).push({ id: f.id, ciudad: f.ciudad, urgente: !!f.urgente });
      });
      res.json({ dias });
    }
  );
});

// Sanea las preguntas de criba de una oferta: máximo 3, sin vacías, recortadas.
const MAX_PREGUNTAS_CRIBA = 3;
function sanearPreguntas(preguntas) {
  if (!Array.isArray(preguntas)) return [];
  return preguntas
    .map(p => String(p || "").trim().slice(0, 200))
    .filter(p => p.length > 0)
    .slice(0, MAX_PREGUNTAS_CRIBA);
}

app.post("/publicaciones", verifyToken, (req, res) => {
  const { tipo, descripcion, ciudad, provincia, especialidades, contrato, jornada, salario, salarioDesde, salarioHasta, experiencia, nombre_contacto, email_contacto, telefono_contacto, sede_id, fecha_desde, fecha_hasta, dias, urgente, retribucionTipo, retribucionPorcentaje, equipamiento, preguntas } = req.body;
  // Las preguntas de criba solo aplican a ofertas/suplencias (las publica la clínica)
  const preguntasCriba = (tipo === "oferta" || tipo === "suplencia") ? sanearPreguntas(preguntas) : [];

  // La ciudad de las solicitudes se hereda del perfil del dentista (no editable), así que aquí no es obligatoria
  if (!tipo || (tipo !== 'solicitud' && !ciudad)) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  // Validar tipo de usuario vs tipo de publicación (las clínicas pueden crear ofertas fijas o suplencias puntuales)
  const tipoUsuario = req.usuario.tipo;
  const tiposPermitidos = tipoUsuario === 'clinica' ? ['oferta', 'suplencia'] : ['solicitud'];
  if (!tiposPermitidos.includes(tipo)) {
    return res.status(403).json({ error: "No puedes crear este tipo de publicación" });
  }

  // Días de la suplencia: se aceptan días concretos (dias[]) o, como respaldo/legacy,
  // un rango fecha_desde→fecha_hasta que se expande. fecha_desde/hasta se guardan como
  // resumen (primer y último día) para el listado, el SEO y el sitemap.
  const diasSuplencia = tipo === 'suplencia'
    ? (Array.isArray(dias) && dias.length ? sanearDias(dias) : sanearDias(expandirRango(fecha_desde, fecha_hasta)))
    : [];
  if (tipo === 'suplencia' && diasSuplencia.length === 0) {
    return res.status(400).json({ error: "Las suplencias necesitan al menos un día" });
  }
  const suplenciaDesde = diasSuplencia.length ? diasSuplencia[0] : null;
  const suplenciaHasta = diasSuplencia.length ? diasSuplencia[diasSuplencia.length - 1] : null;

  // Salario estructurado (campos numéricos) con retrocompatibilidad con el texto libre
  const desdeNum = salarioDesde !== undefined && salarioDesde !== null && salarioDesde !== '' ? parseInt(salarioDesde) : null;
  const hastaNum = salarioHasta !== undefined && salarioHasta !== null && salarioHasta !== '' ? parseInt(salarioHasta) : null;
  const salarioMatch = (salario || '').match(/\d+/);
  const salarioMin = desdeNum ?? (salarioMatch ? parseInt(salarioMatch[0]) : null);
  const experienciaMinima = experiencia !== undefined && experiencia !== null && experiencia !== '' ? parseInt(experiencia) : null;

  const retribucionTipoFinal = retribucionTipo === 'porcentaje' ? 'porcentaje' : 'fijo';
  const retribucionPorcentajeFinal = retribucionTipoFinal === 'porcentaje' && retribucionPorcentaje !== undefined && retribucionPorcentaje !== null && retribucionPorcentaje !== ''
    ? parseInt(retribucionPorcentaje)
    : null;

  // Equipamiento solo aplica a ofertas/suplencias, y solo se aceptan valores del catálogo fijo
  const equipamientoValido = (tipo === 'oferta' || tipo === 'suplencia') && Array.isArray(equipamiento)
    ? equipamiento.filter(e => EQUIPAMIENTO_CATALOGO.includes(e))
    : [];

  // Los campos de contacto y el equipamiento pueden venir del formulario (respaldo/legacy) o
  // derivarse de la sede/perfil (opts) cuando se publica una oferta/suplencia con sede.
  const insertarPublicacion = (sedeIdValidada, ciudadFinal, provinciaFinal, opts = {}) => {
    const nombreContactoFinal = opts.nombreContacto !== undefined ? opts.nombreContacto : nombre_contacto;
    const emailContactoFinal = opts.emailContacto !== undefined ? opts.emailContacto : email_contacto;
    const telefonoContactoFinal = opts.telefonoContacto !== undefined ? opts.telefonoContacto : telefono_contacto;
    const equiposFinal = opts.equipos !== undefined ? opts.equipos : equipamientoValido;
    const geo = geocodificarCiudad(ciudadFinal);

    db.run(
      `INSERT INTO publicaciones
       (tipo, descripcion, ciudad, provincia, especialidad_id, contrato, jornada, salario, salario_min, salario_max, experiencia_minima, usuario_id, nombre_contacto, email_contacto, telefono_contacto, sede_id, fecha_desde, fecha_hasta, urgente, retribucion_tipo, retribucion_porcentaje, lat, lon, preguntas)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tipo, descripcion, ciudadFinal, provinciaFinal, contrato || null, jornada || null, salario || null, salarioMin, hastaNum, experienciaMinima, req.usuario.id, nombreContactoFinal, emailContactoFinal, telefonoContactoFinal, sedeIdValidada, suplenciaDesde, suplenciaHasta, tipo === 'suplencia' && urgente ? 1 : 0, retribucionTipoFinal, retribucionPorcentajeFinal, geo ? geo.lat : null, geo ? geo.lon : null, preguntasCriba.length ? JSON.stringify(preguntasCriba) : null],
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

        if (equiposFinal && equiposFinal.length > 0) {
          const stmt = db.prepare("INSERT INTO publicacion_equipamiento (publicacion_id, equipo) VALUES (?, ?)");
          equiposFinal.forEach(eq => stmt.run(publicacionId, eq));
          stmt.finalize();
        }

        // Días concretos de la suplencia. Completamos la escritura antes de responder
        // (una escritura en vuelo tras res.json haría fallar la limpieza de la BD en tests).
        if (diasSuplencia.length > 0) {
          const stmt = db.prepare("INSERT OR IGNORE INTO suplencia_dias (publicacion_id, fecha) VALUES (?, ?)");
          diasSuplencia.forEach(dia => stmt.run(publicacionId, dia));
          stmt.finalize(() => res.json({ mensaje: "Publicación creada", id: publicacionId }));
          return;
        }

        res.json({
          mensaje: "Publicación creada",
          id: publicacionId
        });
      }
    );
  };

  if (tipo === 'solicitud') {
    // La ciudad y provincia de una solicitud se heredan del perfil del dentista (no editable en el
    // formulario). Si el perfil aún no tiene ciudad, se acepta la que llegue en el cuerpo como respaldo.
    db.get("SELECT ciudad, provincia FROM usuarios WHERE id = ?", [req.usuario.id], (err, u) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al crear publicación" });
      }
      const ciudadFinal = (u && u.ciudad) ? u.ciudad : (ciudad || null);
      const provinciaFinal = (u && u.ciudad) ? (u.provincia || null) : (provincia || null);
      if (!ciudadFinal) {
        return res.status(400).json({ error: "Define tu ciudad en el perfil antes de publicar una solicitud" });
      }
      insertarPublicacion(null, ciudadFinal, provinciaFinal, { equipos: [] });
    });
  } else if (sede_id) {
    // Oferta/suplencia con sede: ciudad, provincia, teléfono y equipamiento se heredan de la sede;
    // el nombre y el email de contacto, del perfil de la clínica (no editables en el formulario).
    db.get("SELECT * FROM sedes WHERE id = ?", [sede_id], (err, sede) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al crear publicación" });
      }
      if (!sede || sede.usuario_id !== req.usuario.id) {
        return res.status(403).json({ error: "La sede indicada no es tuya" });
      }
      db.get("SELECT nombre, email FROM usuarios WHERE id = ?", [req.usuario.id], (err2, perfil) => {
        if (err2 || !perfil) {
          console.error(err2);
          return res.status(500).json({ error: "Error al crear publicación" });
        }
        db.all("SELECT equipo FROM sede_equipamiento WHERE sede_id = ?", [sede_id], (err3, rows) => {
          if (err3) {
            console.error(err3);
            return res.status(500).json({ error: "Error al crear publicación" });
          }
          insertarPublicacion(sede_id, sede.ciudad, sede.provincia || null, {
            nombreContacto: perfil.nombre,
            emailContacto: perfil.email,
            telefonoContacto: sede.telefono || null,
            equipos: (rows || []).map(r => r.equipo)
          });
        });
      });
    });
  } else {
    // Oferta/suplencia sin sede (respaldo/legacy/API): se usa lo que llegue en el cuerpo
    insertarPublicacion(null, ciudad, provincia || null);
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

app.get("/publicaciones/:id/equipamiento", (req, res) => {
  db.all(
    "SELECT equipo FROM publicacion_equipamiento WHERE publicacion_id = ? ORDER BY equipo",
    [req.params.id],
    (err, filas) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener el equipamiento" });
      }
      res.json({ equipamiento: (filas || []).map(f => f.equipo) });
    }
  );
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
  const { descripcion, ciudad, especialidades, contrato, jornada, salario, experiencia, nombre_contacto, email_contacto, telefono_contacto, preguntas, dias, fecha_desde, fecha_hasta } = req.body;
  // Solo se actualizan las preguntas si el cliente las envía (undefined = no tocar)
  const preguntasCriba = preguntas !== undefined ? sanearPreguntas(preguntas) : undefined;
  const publicacionId = req.params.id;

  db.get("SELECT usuario_id, tipo FROM publicaciones WHERE id = ?", [publicacionId], (err, pub) => {
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
    const experienciaMinima = experiencia !== undefined && experiencia !== null && experiencia !== '' ? parseInt(experiencia) : null;

    const geo = geocodificarCiudad(ciudad);

    const setPreguntas = preguntasCriba !== undefined ? ", preguntas = ?" : "";
    const paramsPreguntas = preguntasCriba !== undefined
      ? [preguntasCriba.length ? JSON.stringify(preguntasCriba) : null]
      : [];

    // Días de suplencia editados: se aceptan días concretos (dias[]) o un rango.
    // Solo se tocan si es una suplencia y el cliente los envía. fecha_desde/hasta
    // se recalculan como primer y último día.
    const pidieronDias = Array.isArray(dias) || fecha_desde !== undefined;
    const diasEdit = pidieronDias ? sanearDias(Array.isArray(dias) && dias.length ? dias : expandirRango(fecha_desde, fecha_hasta)) : null;
    const aplicarDias = pub.tipo === 'suplencia' && diasEdit !== null && diasEdit.length > 0;
    const setFechas = aplicarDias ? ", fecha_desde = ?, fecha_hasta = ?" : "";
    const paramsFechas = aplicarDias ? [diasEdit[0], diasEdit[diasEdit.length - 1]] : [];

    // Sustituye los días de la suplencia (si procede) y responde. Se completan las
    // escrituras antes de responder para no dejar ninguna en vuelo.
    const terminar = () => {
      if (!aplicarDias) return res.json({ mensaje: "Publicación actualizada" });
      db.run("DELETE FROM suplencia_dias WHERE publicacion_id = ?", [publicacionId], () => {
        const stmt = db.prepare("INSERT OR IGNORE INTO suplencia_dias (publicacion_id, fecha) VALUES (?, ?)");
        diasEdit.forEach(dia => stmt.run(publicacionId, dia));
        stmt.finalize(() => res.json({ mensaje: "Publicación actualizada" }));
      });
    };

    db.run(
      `UPDATE publicaciones
       SET descripcion = ?, ciudad = ?, contrato = ?, jornada = ?, salario = ?, salario_min = ?, experiencia_minima = ?,
           nombre_contacto = ?, email_contacto = ?, telefono_contacto = ?, lat = ?, lon = ?${setPreguntas}${setFechas}
       WHERE id = ?`,
      [descripcion, ciudad, contrato || null, jornada || null, salario || null, salarioMin, experienciaMinima,
       nombre_contacto, email_contacto, telefono_contacto || null, geo ? geo.lat : null, geo ? geo.lon : null, ...paramsPreguntas, ...paramsFechas, publicacionId],
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
            stmt.finalize(() => terminar());
          });
        } else {
          terminar();
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
       INNER JOIN publicaciones s ON s.usuario_id = ? AND s.tipo = 'solicitud' AND s.activo = 1
         AND (o.ciudad = s.ciudad OR s.ciudad LIKE '%' || o.ciudad || '%' OR o.ciudad LIKE '%' || s.ciudad || '%')
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
     INNER JOIN publicaciones s ON s.usuario_id = ? AND s.tipo = 'solicitud' AND s.activo = 1
       AND (o.ciudad = s.ciudad OR s.ciudad LIKE '%' || o.ciudad || '%' OR o.ciudad LIKE '%' || s.ciudad || '%')
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
     SELECT * FROM (
       SELECT 'Sin especialidad' as especialidad, COUNT(DISTINCT s.usuario_id) as total
       FROM publicaciones s
       WHERE s.tipo = 'solicitud' AND s.activo = 1
       AND NOT EXISTS (
         SELECT 1 FROM pub_esp pe2
         INNER JOIN publicaciones s2 ON s2.id = pe2.publicacion_id
         WHERE s2.usuario_id = s.usuario_id AND s2.tipo = 'solicitud' AND s2.activo = 1
       )
     ) WHERE total > 0
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
     SELECT * FROM (
       SELECT 'Sin especialidad' as especialidad, COUNT(DISTINCT o.usuario_id) as total
       FROM publicaciones o
       WHERE o.tipo = 'oferta' AND o.activo = 1
       AND NOT EXISTS (
         SELECT 1 FROM pub_esp pe2
         INNER JOIN publicaciones o2 ON o2.id = pe2.publicacion_id
         WHERE o2.usuario_id = o.usuario_id AND o2.tipo = 'oferta' AND o2.activo = 1
       )
     ) WHERE total > 0
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

// Último aviso por email de mensajes de chat, por conversación (throttle 1 h)
const ultimaNotificacionChat = new Map();

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
        const esPerfil = !!m.contacto_perfil_id;
        const clave = esPerfil ? `perfil:${m.contacto_perfil_id}` : `${m.publicacion_id}:${otroId}`;
        if (!conversaciones[clave]) {
          conversaciones[clave] = {
            publicacion_id: m.publicacion_id,
            publicacion_ciudad: m.publicacion_ciudad,
            publicacion_tipo: m.publicacion_tipo,
            contacto_perfil_id: m.contacto_perfil_id || null,
            es_perfil: esPerfil,
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

              // Aviso por email al destinatario, como mucho uno por conversación y hora
              const claveNotif = `${destinatario_id}:${usuarioId}:${publicacion_id}`;
              const ultima = ultimaNotificacionChat.get(claveNotif);
              if (!ultima || Date.now() - ultima > 60 * 60 * 1000) {
                ultimaNotificacionChat.set(claveNotif, Date.now());
                notificarUsuario(
                  destinatario_id,
                  `💬 Mensaje nuevo de ${remitente.nombre} en DentalJobs`,
                  "Tienes un mensaje nuevo",
                  `${remitente.nombre} te ha escrito en el chat de DentalJobs. Entra para leerlo y responder.`,
                  "Abrir el chat"
                );
              }
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
   🔹 EXPORTACIONES A CSV
=========================== */

// Exporta una vista del listado principal (publicaciones, perfiles, mis-publicaciones,
// favoritos, mis-postulaciones o suplencias). Acepta los mismos filtros que la vista,
// así el fichero contiene exactamente las filas que el usuario está viendo.
app.get("/exportar/:vista.csv", verifyToken, async (req, res) => {
  try {
    const { archivo, csv } = await generarCsv(db, req.usuario, req.params.vista, req.query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${archivo}"`);
    res.send(csv);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: "Error al exportar" });
  }
});

/* ===========================
   🔹 CANDIDATURAS
=========================== */

// Exportar postulaciones a CSV: 'recibidas' (sobre mis publicaciones) o 'enviadas' (las mías).
app.get("/candidaturas/export.csv", verifyToken, async (req, res) => {
  const tipoExport = req.query.tipo || (req.usuario.tipo === "clinica" ? "recibidas" : "enviadas");
  if (!["recibidas", "enviadas"].includes(tipoExport)) {
    return res.status(400).json({ error: "Tipo de exportación inválido" });
  }

  const vista = tipoExport === "recibidas" ? "postulaciones-recibidas" : "mis-postulaciones";

  try {
    const { csv } = await generarCsv(db, req.usuario, vista, {});
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="postulaciones-${tipoExport}-${fecha}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al exportar postulaciones" });
  }
});

// Crear candidatura (dentista postulándose a oferta)
app.post("/candidaturas", verifyToken, (req, res) => {
  const { publicacion_id, mensaje, respuestas } = req.body;
  const usuario_id = req.usuario.id;

  if (!publicacion_id) {
    return res.status(400).json({ error: "publicacion_id requerido" });
  }

  // Si la oferta tiene preguntas de criba, exigir una respuesta a cada una
  db.get("SELECT preguntas FROM publicaciones WHERE id = ?", [publicacion_id], (errPub, pub) => {
    if (errPub) {
      console.error(errPub);
      return res.status(500).json({ error: "Error al postularse" });
    }
    let preguntas = [];
    try { preguntas = pub && pub.preguntas ? JSON.parse(pub.preguntas) : []; } catch (e) {}

    let respuestasJson = null;
    if (preguntas.length > 0) {
      const dadas = Array.isArray(respuestas) ? respuestas : [];
      const emparejadas = preguntas.map((pregunta, i) => ({
        pregunta,
        respuesta: String(dadas[i] || "").trim().slice(0, 1000)
      }));
      if (emparejadas.some(r => r.respuesta.length === 0)) {
        return res.status(400).json({ error: "Responde a todas las preguntas de la oferta" });
      }
      respuestasJson = JSON.stringify(emparejadas);
    }

    insertarCandidatura(respuestasJson);
  });

  function insertarCandidatura(respuestasJson) {
  db.run(
    "INSERT INTO candidaturas (publicacion_id, usuario_id, estado, mensaje, respuestas) VALUES (?, ?, 'pendiente', ?, ?)",
    [publicacion_id, usuario_id, mensaje || null, respuestasJson],
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

      // Avisar por email al dueño de la publicación
      db.get(
        `SELECT p.usuario_id as propietario_id, p.ciudad, u.nombre as candidato_nombre
         FROM publicaciones p, usuarios u
         WHERE p.id = ? AND u.id = ?`,
        [publicacion_id, usuario_id],
        (err, info) => {
          if (err || !info) return;
          notificarUsuario(
            info.propietario_id,
            "📬 Nueva postulación en DentalJobs",
            "¡Tienes una nueva postulación!",
            `${info.candidato_nombre} se ha postulado a tu publicación de ${info.ciudad}. Entra para ver su perfil y responder.`,
            "Ver la postulación"
          );
        }
      );
    }
  );
  }
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

  const listar = () => {
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
  };

  // "CV visto": cuando el dueño abre la lista, las pendientes pasan a 'vista'
  db.get("SELECT usuario_id FROM publicaciones WHERE id = ?", [publicacion_id], (err, pub) => {
    if (!err && pub && pub.usuario_id === req.usuario.id) {
      db.run(
        "UPDATE candidaturas SET estado = 'vista', actualizado_en = CURRENT_TIMESTAMP WHERE publicacion_id = ? AND estado = 'pendiente'",
        [publicacion_id],
        () => listar()
      );
    } else {
      listar();
    }
  });
});

// Cambiar estado de candidatura (aceptar/rechazar)
app.put("/candidaturas/:id", verifyToken, (req, res) => {
  const { estado } = req.body;
  const candidatura_id = req.params.id;
  const usuarioId = req.usuario.id;

  if (!["pendiente", "vista", "en_proceso", "entrevista", "aceptada", "rechazada"].includes(estado)) {
    return res.status(400).json({ error: "Estado inválido" });
  }

  db.get(
    `SELECT p.usuario_id, p.ciudad, c.usuario_id as candidato_id, c.estado as estado_anterior
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

          // Avisar al candidato de los cambios relevantes (no del ida y vuelta administrativo)
          const avisar = ["en_proceso", "entrevista", "aceptada", "rechazada"].includes(estado)
            && estado !== row.estado_anterior;
          if (avisar) {
            const textos = {
              en_proceso: `Tu candidatura en ${row.ciudad} está en proceso de selección.`,
              entrevista: `¡Buenas noticias! Quieren hacerte una entrevista para la publicación de ${row.ciudad}. Contacta con ellos desde la plataforma.`,
              aceptada: `🎉 ¡Enhorabuena! Tu candidatura en ${row.ciudad} ha sido ACEPTADA. Ya puedes chatear directamente con la otra parte.`,
              rechazada: `Tu candidatura en ${row.ciudad} no ha seguido adelante esta vez. ¡Ánimo, hay más oportunidades esperándote!`
            };
            notificarUsuario(
              row.candidato_id,
              `Tu candidatura ha cambiado a: ${ETIQUETAS_ESTADO[estado]}`,
              `Candidatura ${ETIQUETAS_ESTADO[estado].toLowerCase()}`,
              textos[estado],
              "Ver mis postulaciones"
            );
          }
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

  const { nombre, ciudad, provincia, direccion, codigo_postal, telefono, equipamiento } = req.body;
  if (!nombre || !nombre.trim() || !ciudad || !ciudad.trim()) {
    return res.status(400).json({ error: "Nombre y ciudad son obligatorios" });
  }

  const equipos = Array.isArray(equipamiento) ? equipamiento.filter(e => EQUIPAMIENTO_CATALOGO.includes(e)) : [];

  db.run(
    "INSERT INTO sedes (usuario_id, nombre, ciudad, provincia, direccion, codigo_postal, telefono) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [req.usuario.id, nombre.trim(), ciudad.trim(), provincia || null, direccion || null, codigo_postal || null, telefono || null],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al crear sede" });
      }
      const sedeId = this.lastID;
      // Guardar el equipamiento antes de responder (evita fallos de escritura en vuelo)
      if (equipos.length) {
        const stmt = db.prepare("INSERT INTO sede_equipamiento (sede_id, equipo) VALUES (?, ?)");
        equipos.forEach(e => stmt.run(sedeId, e));
        stmt.finalize(() => res.json({ mensaje: "Sede creada", id: sedeId }));
      } else {
        res.json({ mensaje: "Sede creada", id: sedeId });
      }
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
      sedes = sedes || [];
      if (!sedes.length) return res.json({ sedes: [] });

      const ids = sedes.map(s => s.id);
      const placeholders = ids.map(() => "?").join(",");
      db.all(`SELECT sede_id, equipo FROM sede_equipamiento WHERE sede_id IN (${placeholders})`, ids, (err2, equipos) => {
        if (err2) {
          console.error(err2);
          return res.status(500).json({ error: "Error al obtener sedes" });
        }
        const porSede = {};
        (equipos || []).forEach(e => { (porSede[e.sede_id] = porSede[e.sede_id] || []).push(e.equipo); });
        sedes.forEach(s => { s.equipamiento = porSede[s.id] || []; });
        res.json({ sedes });
      });
    }
  );
});

app.put("/sedes/:id", verifyToken, (req, res) => {
  const { nombre, ciudad, provincia, direccion, codigo_postal, telefono, equipamiento } = req.body;
  if (!nombre || !nombre.trim() || !ciudad || !ciudad.trim()) {
    return res.status(400).json({ error: "Nombre y ciudad son obligatorios" });
  }

  const equipos = Array.isArray(equipamiento) ? equipamiento.filter(e => EQUIPAMIENTO_CATALOGO.includes(e)) : null;

  db.get("SELECT usuario_id FROM sedes WHERE id = ?", [req.params.id], (err, sede) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al actualizar sede" });
    }
    if (!sede || sede.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: "No tienes permiso para modificar esta sede" });
    }

    db.run(
      "UPDATE sedes SET nombre = ?, ciudad = ?, provincia = ?, direccion = ?, codigo_postal = ?, telefono = ? WHERE id = ?",
      [nombre.trim(), ciudad.trim(), provincia || null, direccion || null, codigo_postal || null, telefono || null, req.params.id],
      (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error al actualizar sede" });
        }
        // Si se envía equipamiento, se reemplaza por completo el de la sede
        if (equipos === null) {
          return res.json({ mensaje: "Sede actualizada" });
        }
        db.run("DELETE FROM sede_equipamiento WHERE sede_id = ?", [req.params.id], (err2) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({ error: "Error al actualizar sede" });
          }
          if (!equipos.length) return res.json({ mensaje: "Sede actualizada" });
          const stmt = db.prepare("INSERT INTO sede_equipamiento (sede_id, equipo) VALUES (?, ?)");
          equipos.forEach(e => stmt.run(req.params.id, e));
          stmt.finalize(() => res.json({ mensaje: "Sede actualizada" }));
        });
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
      db.run("DELETE FROM sede_equipamiento WHERE sede_id = ?", [req.params.id], (err) => {
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
  if (!["oferta", "solicitud", "suplencia"].includes(tipo)) {
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
     WHERE p.usuario_id = ? AND p.activo = 1 AND c.estado IN ('pendiente', 'vista')
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
    if ((tipoUsuario === 'clinica' && pub.tipo !== 'solicitud') || (tipoUsuario === 'dentista' && !['oferta', 'suplencia'].includes(pub.tipo))) {
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
   🔹 PERFILES (fichas de usuarios navegables) Y SUS FAVORITOS
=========================== */

// Lista de perfiles (dentistas o clínicas) para navegar, con filtros. Independiente de publicaciones.
app.get("/perfiles", (req, res) => {
  const { rol, ciudad, provincia, especialidad, q } = req.query;
  const tipo = rol === 'clinica' ? 'clinica' : 'dentista';

  let query = `SELECT id, nombre, tipo, ciudad, provincia, descripcion, anyos_experiencia, creado_en
               FROM usuarios WHERE tipo = ? AND nombre != 'Usuario eliminado'`;
  const params = [tipo];

  if (ciudad) { query += " AND ciudad LIKE ?"; params.push(`%${ciudad}%`); }
  if (provincia) { query += " AND provincia LIKE ?"; params.push(`%${provincia}%`); }
  if (especialidad) {
    query += " AND EXISTS (SELECT 1 FROM usuario_especialidades ue WHERE ue.usuario_id = usuarios.id AND ue.especialidad_id = ?)";
    params.push(especialidad);
  }
  if (q) {
    query += " AND (nombre LIKE ? OR descripcion LIKE ? OR ciudad LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  query += " ORDER BY creado_en DESC LIMIT 200";

  db.all(query, params, (err, perfiles) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al obtener perfiles" });
    }
    perfiles = perfiles || [];
    if (!perfiles.length) return res.json({ perfiles: [] });

    // Adjuntar las especialidades de cada perfil
    const ids = perfiles.map(p => p.id);
    const ph = ids.map(() => "?").join(",");
    db.all(
      `SELECT ue.usuario_id, e.nombre FROM usuario_especialidades ue
       INNER JOIN especialidades e ON e.id = ue.especialidad_id
       WHERE ue.usuario_id IN (${ph}) ORDER BY e.nombre`,
      ids,
      (err2, filas) => {
        if (err2) {
          console.error(err2);
          return res.status(500).json({ error: "Error al obtener perfiles" });
        }
        const porUsuario = {};
        (filas || []).forEach(f => { (porUsuario[f.usuario_id] = porUsuario[f.usuario_id] || []).push(f.nombre); });
        perfiles.forEach(p => { p.especialidades = porUsuario[p.id] || []; });
        res.json({ perfiles });
      }
    );
  });
});

app.post("/favoritos-perfil", verifyToken, (req, res) => {
  const { perfil_id } = req.body;
  if (!perfil_id) return res.status(400).json({ error: "perfil_id requerido" });
  if (parseInt(perfil_id) === req.usuario.id) return res.status(400).json({ error: "No puedes guardarte a ti mismo" });

  db.get("SELECT id FROM usuarios WHERE id = ?", [perfil_id], (err, u) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al añadir a favoritos" });
    }
    if (!u) return res.status(404).json({ error: "Perfil no encontrado" });

    db.run("INSERT INTO favoritos_perfil (usuario_id, perfil_id) VALUES (?, ?)", [req.usuario.id, perfil_id], function(err2) {
      if (err2) {
        if (err2.message.includes("UNIQUE")) return res.status(400).json({ error: "Ya está en tus favoritos" });
        console.error(err2);
        return res.status(500).json({ error: "Error al añadir a favoritos" });
      }
      res.json({ mensaje: "Perfil añadido a favoritos", favorito_id: this.lastID });
    });
  });
});

app.get("/favoritos-perfil", verifyToken, (req, res) => {
  db.all(
    `SELECT f.id as favorito_id, u.id, u.nombre, u.tipo, u.ciudad, u.provincia, u.descripcion, u.anyos_experiencia
     FROM favoritos_perfil f INNER JOIN usuarios u ON f.perfil_id = u.id
     WHERE f.usuario_id = ? ORDER BY f.creado_en DESC`,
    [req.usuario.id],
    (err, perfiles) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Error al obtener favoritos de perfil" });
      }
      res.json({ perfiles: perfiles || [] });
    }
  );
});

app.delete("/favoritos-perfil/:perfil_id", verifyToken, (req, res) => {
  db.run("DELETE FROM favoritos_perfil WHERE usuario_id = ? AND perfil_id = ?", [req.usuario.id, req.params.perfil_id], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al quitar de favoritos" });
    }
    res.json({ mensaje: "Quitado de favoritos" });
  });
});

/* ===========================
   🔹 CONTACTOS DE PERFIL (postularse a una ficha) Y SU CHAT
=========================== */

app.post("/contactos-perfil", verifyToken, (req, res) => {
  const { perfil_id, mensaje } = req.body;
  const solicitanteId = req.usuario.id;
  if (!perfil_id) return res.status(400).json({ error: "perfil_id requerido" });
  if (parseInt(perfil_id) === solicitanteId) return res.status(400).json({ error: "No puedes contactarte a ti mismo" });

  db.get("SELECT id FROM usuarios WHERE id = ?", [perfil_id], (err, perfil) => {
    if (err) { console.error(err); return res.status(500).json({ error: "Error al contactar" }); }
    if (!perfil) return res.status(404).json({ error: "Perfil no encontrado" });

    // Un contacto entre dos personas es un único hilo, aunque ambas hayan pulsado
    // "Contactar". Si ya existe en cualquier sentido, no se crea un segundo:
    //  - si lo inicié yo, ya está enviado;
    //  - si me contactó la otra persona, debo aceptar su solicitud (no duplicar el hilo).
    db.get(
      `SELECT solicitante_id, estado FROM contactos_perfil
       WHERE (solicitante_id = ? AND perfil_id = ?) OR (solicitante_id = ? AND perfil_id = ?)`,
      [solicitanteId, perfil_id, perfil_id, solicitanteId],
      (errExiste, existente) => {
        if (errExiste) { console.error(errExiste); return res.status(500).json({ error: "Error al contactar" }); }
        if (existente) {
          if (existente.solicitante_id === solicitanteId) {
            return res.status(400).json({ error: "Ya has contactado a este perfil" });
          }
          if (existente.estado === "aceptada") {
            return res.status(400).json({ error: "Ya estáis en contacto. Ábrelo desde tus mensajes." });
          }
          return res.status(400).json({ error: "Esta persona ya te ha enviado una solicitud de contacto. Acéptala desde tus mensajes para empezar a chatear." });
        }

        db.run(
          "INSERT INTO contactos_perfil (solicitante_id, perfil_id, estado, mensaje) VALUES (?, ?, 'pendiente', ?)",
          [solicitanteId, perfil_id, (mensaje || "").trim() || null],
          function(err2) {
            if (err2) {
              if (err2.message.includes("UNIQUE")) return res.status(400).json({ error: "Ya has contactado a este perfil" });
              console.error(err2);
              return res.status(500).json({ error: "Error al contactar" });
            }
            res.json({ mensaje: "Contacto enviado", id: this.lastID });

            db.get("SELECT nombre FROM usuarios WHERE id = ?", [solicitanteId], (e, sol) => {
              if (e || !sol) return;
              notificarUsuario(
                perfil_id,
                "📬 Nuevo contacto en DentalJobs",
                "Alguien quiere contactar contigo",
                `${sol.nombre} está interesado/a en tu perfil. Entra para ver su solicitud y aceptarla si te encaja.`,
                "Ver la solicitud"
              );
            });
          }
        );
      }
    );
  });
});

app.get("/contactos-perfil", verifyToken, (req, res) => {
  const uid = req.usuario.id;
  db.all(
    `SELECT c.*, u.nombre as perfil_nombre, u.tipo as perfil_tipo, u.ciudad as perfil_ciudad
     FROM contactos_perfil c INNER JOIN usuarios u ON c.perfil_id = u.id
     WHERE c.solicitante_id = ? ORDER BY c.creado_en DESC`,
    [uid],
    (err, enviados) => {
      if (err) { console.error(err); return res.status(500).json({ error: "Error al obtener contactos" }); }
      db.all(
        `SELECT c.*, u.nombre as solicitante_nombre, u.tipo as solicitante_tipo, u.ciudad as solicitante_ciudad
         FROM contactos_perfil c INNER JOIN usuarios u ON c.solicitante_id = u.id
         WHERE c.perfil_id = ? ORDER BY c.creado_en DESC`,
        [uid],
        (err2, recibidos) => {
          if (err2) { console.error(err2); return res.status(500).json({ error: "Error al obtener contactos" }); }
          res.json({ enviados: enviados || [], recibidos: recibidos || [] });
        }
      );
    }
  );
});

app.put("/contactos-perfil/:id", verifyToken, (req, res) => {
  const { estado } = req.body;
  if (!['aceptada', 'rechazada'].includes(estado)) return res.status(400).json({ error: "Estado no válido" });
  db.get("SELECT perfil_id FROM contactos_perfil WHERE id = ?", [req.params.id], (err, c) => {
    if (err) { console.error(err); return res.status(500).json({ error: "Error al actualizar contacto" }); }
    if (!c) return res.status(404).json({ error: "Contacto no encontrado" });
    if (c.perfil_id !== req.usuario.id) return res.status(403).json({ error: "Solo el destinatario puede aceptar o rechazar" });
    db.run("UPDATE contactos_perfil SET estado = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?", [estado, req.params.id], (err2) => {
      if (err2) { console.error(err2); return res.status(500).json({ error: "Error al actualizar contacto" }); }
      res.json({ mensaje: estado === 'aceptada' ? "Contacto aceptado" : "Contacto rechazado" });
    });
  });
});

// Hilo de chat de un contacto de perfil (mensajes con contacto_perfil_id). Marca como leídos los entrantes.
app.get("/chat/perfil/:contactoId/mensajes", verifyToken, (req, res) => {
  const usuarioId = req.usuario.id;
  const contactoId = parseInt(req.params.contactoId);

  db.get("SELECT * FROM contactos_perfil WHERE id = ?", [contactoId], (err, c) => {
    if (err) { console.error(err); return res.status(500).json({ error: "Error al obtener mensajes" }); }
    if (!c) return res.status(404).json({ error: "Contacto no encontrado" });
    if (c.solicitante_id !== usuarioId && c.perfil_id !== usuarioId) return res.status(403).json({ error: "No autorizado" });
    const otroId = c.solicitante_id === usuarioId ? c.perfil_id : c.solicitante_id;

    db.run(
      "UPDATE mensajes SET leido = 1 WHERE contacto_perfil_id = ? AND destinatario_id = ? AND leido = 0",
      [contactoId, usuarioId],
      (err2) => {
        if (err2) { console.error(err2); return res.status(500).json({ error: "Error al obtener mensajes" }); }
        db.all(
          `SELECT m.*, ur.nombre as remitente_nombre_usuario FROM mensajes m
           LEFT JOIN usuarios ur ON m.usuario_id = ur.id
           WHERE m.contacto_perfil_id = ? ORDER BY m.creado_en ASC`,
          [contactoId],
          (err3, mensajes) => {
            if (err3) { console.error(err3); return res.status(500).json({ error: "Error al obtener mensajes" }); }
            res.json({ mensajes: mensajes || [], otro_id: otroId, estado: c.estado });
          }
        );
      }
    );
  });
});

app.post("/chat/perfil/mensajes", verifyToken, (req, res) => {
  const { contacto_perfil_id, cuerpo } = req.body;
  const usuarioId = req.usuario.id;
  if (!contacto_perfil_id || !cuerpo || !cuerpo.trim()) return res.status(400).json({ error: "Faltan datos obligatorios" });

  db.get("SELECT * FROM contactos_perfil WHERE id = ?", [contacto_perfil_id], (err, c) => {
    if (err) { console.error(err); return res.status(500).json({ error: "Error al enviar mensaje" }); }
    if (!c) return res.status(404).json({ error: "Contacto no encontrado" });
    if (c.solicitante_id !== usuarioId && c.perfil_id !== usuarioId) return res.status(403).json({ error: "No autorizado" });
    if (c.estado !== 'aceptada') return res.status(403).json({ error: "Solo puedes chatear tras aceptar el contacto" });
    const destinatarioId = c.solicitante_id === usuarioId ? c.perfil_id : c.solicitante_id;

    db.get("SELECT nombre, email FROM usuarios WHERE id = ?", [usuarioId], (err2, remitente) => {
      if (err2 || !remitente) { console.error(err2); return res.status(500).json({ error: "Error al enviar mensaje" }); }
      db.run(
        `INSERT INTO mensajes (publicacion_id, contacto_perfil_id, usuario_id, destinatario_id, remitente_nombre, remitente_email, cuerpo)
         VALUES (NULL, ?, ?, ?, ?, ?, ?)`,
        [contacto_perfil_id, usuarioId, destinatarioId, remitente.nombre, remitente.email, cuerpo.trim()],
        function(err3) {
          if (err3) { console.error(err3); return res.status(500).json({ error: "Error al enviar mensaje" }); }
          res.json({ mensaje: "Mensaje enviado", id: this.lastID });

          const claveNotif = `perfil:${destinatarioId}:${usuarioId}:${contacto_perfil_id}`;
          const ultima = ultimaNotificacionChat.get(claveNotif);
          if (!ultima || Date.now() - ultima > 60 * 60 * 1000) {
            ultimaNotificacionChat.set(claveNotif, Date.now());
            notificarUsuario(
              destinatarioId,
              `💬 Mensaje nuevo de ${remitente.nombre} en DentalJobs`,
              "Tienes un mensaje nuevo",
              `${remitente.nombre} te ha escrito en el chat de DentalJobs. Entra para leerlo y responder.`,
              "Abrir el chat"
            );
          }
        }
      );
    });
  });
});

/* ===========================
   🔹 INICIAR SERVIDOR
=========================== */

/* ===========================
   🔹 PÁGINAS PÚBLICAS (SEO)
=========================== */

function escaparHtml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Página pública e indexable de una oferta: visible sin cuenta, con CTA al registro
app.get("/oferta/:id", (req, res) => {
  db.get(
    `SELECT p.*, u.nombre as clinica_nombre, u.id as clinica_id
     FROM publicaciones p
     LEFT JOIN usuarios u ON p.usuario_id = u.id
     WHERE p.id = ? AND p.activo = 1 AND p.tipo IN ('oferta', 'suplencia')`,
    [req.params.id],
    (err, pub) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error interno");
      }
      if (!pub) {
        return res.status(404).send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Oferta no disponible — DentalJobs</title></head>
          <body style="font-family: Arial; text-align: center; padding: 4rem;">
          <h1>🦷 Esta oferta ya no está disponible</h1>
          <p><a href="${escaparHtml(urlFrontend())}">Ver más ofertas en DentalJobs</a></p></body></html>`);
      }

      db.all(
        `SELECT e.nombre FROM especialidades e
         INNER JOIN publicacion_especialidades pe ON e.id = pe.especialidad_id
         WHERE pe.publicacion_id = ?`,
        [pub.id],
        (err, esps) => {
          const especialidades = (esps || []).map(e => e.nombre);
          const esSuplencia = pub.tipo === 'suplencia';
          const titulo = esSuplencia
            ? `${pub.urgente ? "🚨 Urgente: " : ""}Suplencia de ${especialidades[0] || "dentista"} en ${pub.ciudad}`
            : `${especialidades[0] || "Dentista"} en ${pub.ciudad} — oferta de empleo dental`;
          const descripcionMeta = (pub.descripcion || "").slice(0, 155).replace(/\s+/g, " ");
          const urlApp = escaparHtml(urlFrontend());
          const rangoFechas = [pub.fecha_desde, pub.fecha_hasta].filter(Boolean).join(" — ");

          const detalle = (etiqueta, valor) => valor
            ? `<div style="padding: 0.6rem 0; border-bottom: 1px solid #e5e7eb;"><strong style="color: #0f4c75;">${etiqueta}:</strong> ${escaparHtml(valor)}</div>`
            : "";

          res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escaparHtml(titulo)} | DentalJobs</title>
  <meta name="description" content="${escaparHtml(descripcionMeta)}">
  <meta property="og:title" content="${escaparHtml(titulo)}">
  <meta property="og:description" content="${escaparHtml(descripcionMeta)}">
  <meta property="og:type" content="website">
</head>
<body style="font-family: Arial, sans-serif; margin: 0; background: #f3f4f6;">
  <div style="max-width: 640px; margin: 0 auto; padding: 2rem 1rem;">
    <p style="color: #0f4c75; font-weight: bold; font-size: 1.3rem;">🦷 DentalJobs</p>
    <div style="background: white; border-radius: 12px; padding: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
      ${esSuplencia && pub.urgente ? `<p style="display: inline-block; background: #fef2f2; color: #b91c1c; padding: 0.3rem 0.8rem; border-radius: 999px; font-weight: bold; font-size: 0.85rem; margin: 0 0 1rem 0;">🚨 Urgente</p>` : ""}
      <h1 style="color: #0f4c75; margin-top: 0;">${escaparHtml(titulo)}</h1>
      ${pub.clinica_nombre ? `<p style="color: #6b7280;">Publicada por <strong>${escaparHtml(pub.clinica_nombre)}</strong></p>` : ""}
      ${esSuplencia ? detalle("🗓️ Fechas", rangoFechas) : ""}
      ${detalle("📍 Ciudad", pub.ciudad)}
      ${detalle("🦷 Especialidades", especialidades.join(", "))}
      ${detalle("📋 Contrato", pub.contrato)}
      ${detalle("⏰ Jornada", pub.jornada)}
      ${detalle("💰 Salario", pub.salario)}
      ${pub.experiencia_minima !== null && pub.experiencia_minima !== undefined ? detalle("🎓 Experiencia", pub.experiencia_minima + " años") : ""}
      <h2 style="color: #0f4c75; font-size: 1.1rem;">Descripción</h2>
      <p style="white-space: pre-wrap; line-height: 1.6; color: #374151;">${escaparHtml(pub.descripcion)}</p>
      <p style="text-align: center; margin-top: 2rem;">
        <a href="${urlApp}" style="background: #0f4c75; color: white; padding: 0.9rem 2rem; border-radius: 8px; text-decoration: none; font-weight: bold;">Postularme en DentalJobs</a>
      </p>
      <p style="text-align: center; color: #9ca3af; font-size: 0.85rem;">Regístrate gratis como dentista para postularte y chatear con la clínica.</p>
    </div>
    <p style="text-align: center; color: #9ca3af; font-size: 0.8rem; margin-top: 1.5rem;">
      <a href="${urlApp}" style="color: #6b7280;">DentalJobs</a> — empleo para clínicas dentales y profesionales de la odontología
    </p>
  </div>
</body>
</html>`);
        }
      );
    }
  );
});

// Sitemap con todas las ofertas y suplencias activas (para buscadores)
app.get("/sitemap.xml", (req, res) => {
  db.all(
    "SELECT id, creado_en FROM publicaciones WHERE activo = 1 AND tipo IN ('oferta', 'suplencia') ORDER BY id",
    (err, ofertas) => {
      if (err) {
        console.error(err);
        return res.status(500).send("");
      }
      const base = `${req.protocol}://${req.get("host")}`;
      const urls = (ofertas || []).map(o =>
        `  <url><loc>${base}/oferta/${o.id}</loc><lastmod>${String(o.creado_en).slice(0, 10)}</lastmod></url>`
      ).join("\n");

      res.type("application/xml").send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`
      );
    }
  );
});

app.get("/robots.txt", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.type("text/plain").send(`User-agent: *\nAllow: /oferta/\nSitemap: ${base}/sitemap.xml\n`);
});

// Comprobación de salud (UptimeRobot y deploys)
app.get("/salud", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  // Render escanea el puerto por IPv4; sin indicar el host, algunas
  // plataformas de contenedores solo abren IPv6 y el escaneo nunca lo detecta.
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  });

  // Apagado limpio: terminar las peticiones en curso antes de salir
  const cerrar = (senyal) => {
    console.log(`${senyal} recibido, cerrando…`);
    server.close(() => {
      db.close(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => cerrar("SIGTERM"));
  process.on("SIGINT", () => cerrar("SIGINT"));
}

module.exports = app;
