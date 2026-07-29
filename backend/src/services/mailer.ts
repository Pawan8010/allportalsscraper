import nodemailer from "nodemailer";
import { env } from "../config/env";
import { logger } from "../utils/logger";

let transporter: import("nodemailer").Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpAppPassword },
    });
  }
  return transporter;
}

export async function sendAlertEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!env.alertsEnabled) {
    logger.info({ to }, "ALERTS_ENABLED=false — skipping email send");
    return false;
  }
  if (!env.smtpUser || !env.smtpAppPassword) {
    logger.warn("Alerts are enabled but SMTP_USER/SMTP_APP_PASSWORD are not configured — skipping email send");
    return false;
  }
  try {
    await getTransporter().sendMail({ from: env.alertFromEmail, to, subject, html, text });
    return true;
  } catch (err) {
    logger.error({ err: String(err), to }, "failed to send alert email");
    return false;
  }
}
