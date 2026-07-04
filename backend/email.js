// Envío de correos vía Gmail (SMTP con contraseña de aplicación).
// Sin GMAIL_USER/GMAIL_APP_PASSWORD configurados, los correos se imprimen por
// consola: el resto del código no nota la diferencia (modo desarrollo/tests).
const nodemailer = require("nodemailer");

let transporter = null;

function obtenerTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });
  }
  return transporter;
}

async function enviarEmail(para, asunto, html) {
  const t = obtenerTransporter();

  if (!t) {
    console.log("📧 [email en modo consola] ─────────────────────");
    console.log(`   Para:    ${para}`);
    console.log(`   Asunto:  ${asunto}`);
    console.log(`   ${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300)}`);
    console.log("   ────────────────────────────────────────────");
    return { simulado: true };
  }

  return t.sendMail({
    from: `"DentalJobs" <${process.env.GMAIL_USER}>`,
    to: para,
    subject: asunto,
    html
  });
}

// Plantilla sencilla y consistente para todos los correos
function plantilla(titulo, cuerpo, urlBoton, textoBoton) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #0f4c75;">🦷 DentalJobs</h2>
      <h3 style="color: #1f2937;">${titulo}</h3>
      <p style="color: #4b5563; line-height: 1.6;">${cuerpo}</p>
      ${urlBoton ? `
      <p style="text-align: center; margin: 28px 0;">
        <a href="${urlBoton}" style="background: #0f4c75; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">${textoBoton}</a>
      </p>
      <p style="color: #9ca3af; font-size: 12px;">Si el botón no funciona, copia este enlace: ${urlBoton}</p>
      ` : ""}
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 28px;">
      <p style="color: #9ca3af; font-size: 12px;">Este correo se envió automáticamente desde DentalJobs. No respondas a este mensaje.</p>
    </div>
  `;
}

// URL base del frontend para construir los enlaces de los correos
function urlFrontend() {
  return (process.env.FRONTEND_URL || "http://localhost:3000/").replace(/\/?$/, "/");
}

module.exports = { enviarEmail, plantilla, urlFrontend };
