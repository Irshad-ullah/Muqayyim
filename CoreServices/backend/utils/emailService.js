import nodemailer from 'nodemailer';
import { logError } from '../services/errorLogger.js';

// Sends one email; resolves to { ok, error } and never throws.
const trySend = async (email, subject, htmlContent) => {
  try {
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: subject,
      html: htmlContent,
    });

    return { ok: true };
  } catch (error) {
    console.error('Email send error:', error.message);
    return { ok: false, error };
  }
};

// Low-level send: true/false, never writes to the error log. Used by critical
// alerts, so a mail outage can't cause an alert loop.
const sendEmailRaw = async (email, subject, htmlContent) => (await trySend(email, subject, htmlContent)).ok;

// Normal send: failures are recorded in the error log (module 'mailer').
// The recipient address and message body are not logged.
const sendEmail = async (email, subject, htmlContent) => {
  const { ok, error } = await trySend(email, subject, htmlContent);
  if (!ok) {
    logError({
      level: 'error',
      module: 'mailer',
      errorType: error?.code || error?.name || 'MAIL_SEND_FAILED',
      message: `Failed to send "${subject}": ${error?.message || 'unknown error'}`,
      stack: error?.stack,
    });
  }
  return ok;
};

const sendPasswordResetEmail = async (email, resetToken) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

  const htmlContent = `
    <h2>Password Reset Request</h2>
    <p>You requested a password reset for your MUQAYYIM account.</p>
    <p>Click the link below to reset your password:</p>
    <a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
      Reset Password
    </a>
    <p>Or copy this link: ${resetUrl}</p>
    <p>This link expires in 1 hour.</p>
    <p>If you didn't request this, please ignore this email.</p>
  `;

  return sendEmail(email, 'Password Reset Request - MUQAYYIM', htmlContent);
};

const sendPasswordChangedEmail = async (email, name) => {
  const html = `
    <p>Hi ${name || 'there'},</p>
    <p>The password for your MUQAYYIM account was just changed.</p>
    <p>If you made this change, no action is needed. If you did not, reset your password
    immediately using "Forgot password" on the login page and contact support.</p>
  `;
  return sendEmail(email, 'Your MUQAYYIM password was changed', html);
};

export { sendEmail, sendEmailRaw, sendPasswordResetEmail, sendPasswordChangedEmail };
