const jwt = require("jsonwebtoken");

// En producción el secreto es obligatorio: nunca arrancar con el valor de desarrollo
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.error("❌ Falta JWT_SECRET. Genera uno con `openssl rand -hex 32` y defínelo como variable de entorno.");
  process.exit(1);
}

const SECRET = process.env.JWT_SECRET || "dental_jobs_secret_key_2024";

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
    { expiresIn: "7d" }
  );
}

module.exports = { verifyToken, generateToken, SECRET };
