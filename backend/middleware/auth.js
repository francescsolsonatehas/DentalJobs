const jwt = require("jsonwebtoken");

// En producción el secreto es obligatorio: nunca arrancar con el valor de desarrollo
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.error("❌ Falta JWT_SECRET. Genera uno con `openssl rand -hex 32` y defínelo como variable de entorno.");
  process.exit(1);
}

const SECRET = process.env.JWT_SECRET || "dental_jobs_secret_key_2024";

// Cuánto dura la sesión. 30 días: DentalJobs es de uso esporádico (un dentista entra
// cuando busca cambio, una clínica cuando tiene una vacante), y con 7 días casi
// cualquier vuelta a la web pillaba la sesión caducada. Al caducar, el frontend lo
// detecta por el 401 y avisa en vez de quedarse en blanco (ver utils.sesionCaducada).
//
// Subirlo más alarga la ventana en que un token robado sigue sirviendo: no hay lista
// de revocación, así que un token válido lo es hasta que expira.
const DURACION_SESION = process.env.JWT_EXPIRES_IN || "30d";

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }

  try {
    const decoded = jwt.verify(token, SECRET);
    req.usuario = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido" });
  }
}

function generateToken(usuario) {
  return jwt.sign(
    { id: usuario.id, email: usuario.email, tipo: usuario.tipo },
    SECRET,
    { expiresIn: DURACION_SESION }
  );
}

module.exports = { verifyToken, generateToken, SECRET };
