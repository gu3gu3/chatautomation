import nodemailer from 'nodemailer';
import pino from 'pino';

const logger = pino({ name: 'mailer' });

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'websavvy-solutions.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false, // STARTTLS uses port 587 with secure=false
  auth: {
    user: process.env.SMTP_USER || 'notificaciones@websavvy-solutions.com',
    pass: process.env.SMTP_PASS || '',
  },
  tls: {
    rejectUnauthorized: false
  }
});

export const sendDisconnectionEmail = async (adminEmail, tenantId, tenantName) => {
  if (!adminEmail) {
    logger.warn(`No admin_email provided for tenant ${tenantId}. Cannot send disconnection email.`);
    return;
  }

  const displayName = tenantName || tenantId;

  const mailOptions = {
    from: `"WebSavvy AI" <${process.env.SMTP_USER || 'notificaciones@websavvy-solutions.com'}>`,
    to: adminEmail,
    subject: `[Urgente] Desconexión de WhatsApp en WebSavvy (${displayName})`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://ai.websavvy-solutions.com/websavvy.png" alt="WebSavvy AI Logo" style="height: 50px;" />
        </div>
        <h2 style="color: #ef4444; text-align: center;">Desconexión de WhatsApp</h2>
        <p>Hola,</p>
        <p>Le notificamos que la vinculación de WhatsApp para la empresa <strong>${displayName}</strong> ha sido desconectada.</p>
        <p>Por favor, ingrese al sistema administrativo y vuelva a escanear el código QR en la sección de vinculación para restablecer el servicio a la brevedad.</p>
        <br>
        <p style="border-top: 1px solid #ddd; padding-top: 15px; font-size: 0.9em; color: #777;">
          Atentamente,<br><strong>El equipo de WebSavvy AI</strong>
        </p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info({ messageId: info.messageId, tenantId, adminEmail }, 'Correo de desconexión enviado exitosamente');
  } catch (error) {
    logger.error({ error, tenantId, adminEmail }, 'Error al enviar correo de desconexión');
  }
};
