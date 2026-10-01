import nodemailer from "nodemailer";
import { logger } from "../utils/logger";
import { getEffectiveSmtpConfig } from "./smtpSettingsService";

let transporter: import("nodemailer").Transporter | null = null;
let transporterKey = "";

function getTransporter(config: Awaited<ReturnType<typeof getEffectiveSmtpConfig>>) {
  const key = `${config.host}:${config.port}:${config.secure}:${config.username}:${config.password}`;
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass: config.password },
    });
    transporterKey = key;
  }
  return transporter;
}

export async function sendAlertEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  const config = await getEffectiveSmtpConfig();
  if (!config.enabled) {
    logger.info({ to }, "Email alerts are disabled — skipping email send");
    return false;
  }
  if (!config.username || !config.password || !config.fromEmail) {
    logger.warn("Email alerts are enabled but SMTP credentials are incomplete — skipping email send");
    return false;
  }
  try {
    await getTransporter(config).sendMail({ from: config.fromEmail, to, subject, html, text });
    return true;
  } catch (err) {
    logger.error({ err: String(err), to }, "failed to send alert email");
    return false;
  }
}

export async function verifySmtpConnection(): Promise<void> {
  const config = await getEffectiveSmtpConfig();
  if (!config.username || !config.password) throw new Error("SMTP credentials are incomplete.");
  await getTransporter(config).verify();
}

export async function sendSmtpTestEmail(to: string): Promise<void> {
  const config = await getEffectiveSmtpConfig();
  if (!config.username || !config.password || !config.fromEmail) throw new Error("SMTP credentials are incomplete.");
  await getTransporter(config).sendMail({
    from: config.fromEmail,
    to,
    subject: "RRP Groups email configuration test",
    text: "Your RRP Groups SMTP configuration is working.",
    html: "<p>Your <strong>RRP Groups</strong> SMTP configuration is working.</p>",
  });
}
