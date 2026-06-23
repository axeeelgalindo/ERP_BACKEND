import 'dotenv/config';
import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST || "mail.blueinge.com";
const port = parseInt(process.env.SMTP_PORT || "465", 10);
const secure = process.env.SMTP_SECURE === "true" || port === 465;
const user = process.env.SMTP_USER || process.env.MASTER_EMAIL || "adelgado@blueinge.com";
const pass = process.env.SMTP_PASS || process.env.MASTER_PASS || "123123";

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: {
    user,
    pass,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

/**
 * Envia un correo electrónico.
 * @param {Object} options
 * @param {string} options.to Correo del destinatario
 * @param {string} options.subject Asunto del correo
 * @param {string} options.text Contenido en texto plano
 * @param {string} options.html Contenido en formato HTML
 */
export async function sendEmail({ to, subject, html, text }) {
  if (!to) {
    console.error("[Mail] Email not sent: No recipient specified");
    return;
  }
  const from = user;
  try {
    const info = await transporter.sendMail({
      from: `"ERP Blue Ingeniería" <${from}>`,
      to,
      subject,
      text,
      html,
    });
    console.log(`[Mail] Email sent successfully to ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`[Mail] Error sending email to ${to}:`, error);
  }
}
