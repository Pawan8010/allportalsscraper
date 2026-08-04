let stored: any = null;

jest.mock("../../src/config/env", () => ({
  env: {
    mailSettingsKey: "test-only-encryption-key",
    alertsEnabled: false,
    smtpHost: "smtp.example.com",
    smtpPort: 465,
    smtpUser: "",
    smtpAppPassword: "",
    alertFromEmail: "",
  },
}));

jest.mock("../../src/services/prisma", () => ({
  prisma: {
    smtpSettings: {
      findUnique: jest.fn(async () => stored),
      upsert: jest.fn(async ({ create, update }: any) => {
        stored = stored ? { ...stored, ...update, updatedAt: new Date() } : { ...create, updatedAt: new Date() };
        return stored;
      }),
    },
  },
}));

import { getEffectiveSmtpConfig, getPublicSmtpSettings, saveSmtpSettings } from "../../src/services/smtpSettingsService";

describe("smtpSettingsService", () => {
  beforeEach(() => { stored = null; });

  it("encrypts the SMTP password and never exposes it publicly", async () => {
    const result = await saveSmtpSettings({
      enabled: true,
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      username: "alerts@example.com",
      password: "app-password-secret",
      fromEmail: "alerts@example.com",
    });

    expect(stored.encryptedPassword).not.toContain("app-password-secret");
    expect(result.passwordConfigured).toBe(true);
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("encryptedPassword");
  });

  it("decrypts the saved password only for the mail transport", async () => {
    await saveSmtpSettings({
      enabled: true,
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      username: "alerts@example.com",
      password: "app-password-secret",
      fromEmail: "alerts@example.com",
    });

    const effective = await getEffectiveSmtpConfig();
    expect(effective.password).toBe("app-password-secret");
    expect(effective.source).toBe("database");
  });

  it("keeps the existing encrypted password when the admin leaves it blank", async () => {
    await saveSmtpSettings({ enabled: true, host: "smtp.gmail.com", port: 465, secure: true, username: "old@example.com", password: "saved-secret", fromEmail: "old@example.com" });
    const encryptedBefore = stored.encryptedPassword;
    await saveSmtpSettings({ enabled: true, host: "smtp.gmail.com", port: 465, secure: true, username: "new@example.com", fromEmail: "new@example.com" });

    expect(stored.encryptedPassword).toBe(encryptedBefore);
    expect((await getPublicSmtpSettings()).username).toBe("new@example.com");
  });
});
