import crypto from "node:crypto";
import { prisma } from "./prisma";
import { env } from "../config/env";

const SETTINGS_ID = "smtp";

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  source: "database" | "environment";
}

export interface SaveSmtpSettingsInput {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  fromEmail: string;
}

function encryptionKey(): Buffer {
  if (!env.mailSettingsKey) throw new Error("MAIL_SETTINGS_KEY is not configured on the backend.");
  return crypto.createHash("sha256").update(env.mailSettingsKey).digest();
}

function encrypt(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

function decrypt(payload: string): string {
  const [ivText, tagText, encryptedText] = payload.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Stored SMTP password is invalid.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

export async function getPublicSmtpSettings() {
  const settings = await prisma.smtpSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (!settings) {
    return {
      enabled: env.alertsEnabled,
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      username: env.smtpUser,
      fromEmail: env.alertFromEmail,
      passwordConfigured: Boolean(env.smtpAppPassword),
      source: "environment" as const,
    };
  }
  return {
    enabled: settings.enabled,
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    username: settings.username,
    fromEmail: settings.fromEmail,
    passwordConfigured: Boolean(settings.encryptedPassword),
    source: "database" as const,
    updatedAt: settings.updatedAt,
  };
}

export async function saveSmtpSettings(input: SaveSmtpSettingsInput) {
  const existing = await prisma.smtpSettings.findUnique({ where: { id: SETTINGS_ID } });
  const encryptedPassword = input.password ? encrypt(input.password) : existing?.encryptedPassword;
  if (!encryptedPassword) throw new Error("Enter an SMTP password before saving.");
  const settings = {
    enabled: input.enabled,
    host: input.host,
    port: input.port,
    secure: input.secure,
    username: input.username,
    fromEmail: input.fromEmail,
  };
  await prisma.smtpSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...settings, encryptedPassword },
    update: { ...settings, encryptedPassword },
  });
  return getPublicSmtpSettings();
}

export async function getEffectiveSmtpConfig(): Promise<SmtpConfig> {
  const settings = await prisma.smtpSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (settings) {
    return {
      enabled: settings.enabled,
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      username: settings.username,
      password: decrypt(settings.encryptedPassword),
      fromEmail: settings.fromEmail,
      source: "database",
    };
  }
  return {
    enabled: env.alertsEnabled,
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    username: env.smtpUser,
    password: env.smtpAppPassword,
    fromEmail: env.alertFromEmail,
    source: "environment",
  };
}
