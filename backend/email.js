// Envío de correos vía la API HTTP de Brevo (antes Sendinblue).
// Render bloquea las conexiones salientes por los puertos SMTP (465/587,
// probado con Gmail: timeout y ENETUNREACH incluso forzando IPv4), así que
// el envío va por HTTPS en vez de SMTP.
// Sin BREVO_API_KEY configurada, los correos se imprimen por consola: el
// resto del código no nota la diferencia (modo desarrollo/tests).
const EMAIL_REMITENTE = process.env.GMAIL_USER || "dentaljobs.avisos@gmail.com";

// Buzón de pruebas. En tests no se imprime nada: `node --test` recibe los
// resultados de cada fichero por la salida del proceso hijo, y volcar ahí un email
// por envío compite con esos mensajes hasta corromperlos ("Unable to deserialize
// cloned data"), matando un fichero de test entero al azar.
//
// A cambio, cada envío queda registrado aquí y los tests lo consultan. Es mejor que
// capturar console.log: son datos estructurados, no un texto sobre el que hacer
// regex, y no hay que parchear una global compartida.
const buzonPruebas = [];

function enviadosEnPruebas() {
  return buzonPruebas;
}

function limpiarBuzonPruebas() {
  buzonPruebas.length = 0;
}

async function enviarEmail(para, asunto, html) {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    if (process.env.NODE_ENV === "test") {
      buzonPruebas.push({ para, asunto, html });
    } else {
      console.log("📧 [email en modo consola] ─────────────────────");
      console.log(`   Para:    ${para}`);
      console.log(`   Asunto:  ${asunto}`);
      console.log(`   ${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300)}`);
      console.log("   ────────────────────────────────────────────");
    }
    return { simulado: true };
  }

  const respuesta = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify({
      sender: { name: "DentalJobs", email: EMAIL_REMITENTE },
      to: [{ email: para }],
      subject: asunto,
      htmlContent: html
    })
  });

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    throw new Error(`Brevo respondió ${respuesta.status}: ${JSON.stringify(datos)}`);
  }

  console.log(`📧 Email enviado a ${para}: messageId=${datos.messageId}`);
  return datos;
}

// Plantilla sencilla y consistente para todos los correos
function plantilla(titulo, cuerpo, urlBoton, textoBoton) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #0f4c75;">🦷 DentalJobs</h2>
      <h3 style="color: #1f2937;">${titulo}</h3>
      <div style="color: #4b5563; line-height: 1.6;">${cuerpo}</div>
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

module.exports = { enviarEmail, plantilla, urlFrontend, enviadosEnPruebas, limpiarBuzonPruebas };
