import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { env } from "../config/env";

const BCRYPT_COST = 12;

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function roleForNewSignup(email: string): string {
  return env.adminEmails.includes(email.toLowerCase()) ? "admin" : "user";
}

export interface SessionContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function registerUser(email: string, password: string, ctx: SessionContext) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw new AuthError("An account with this email already exists.", 409);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const role = roleForNewSignup(normalizedEmail);
  const user = await prisma.user.create({
    data: { email: normalizedEmail, passwordHash, role },
  });

  const session = await createSession(user.id, ctx);
  return { user, ...session };
}

export async function loginUser(email: string, password: string, ctx: SessionContext) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  // Same generic error whether the email doesn't exist or the password is
  // wrong -- never confirm which one it was.
  if (!user || !user.passwordHash) throw new AuthError("Invalid email or password.", 401);

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new AuthError("Invalid email or password.", 401);

  const session = await createSession(user.id, ctx);
  return { user, ...session };
}

export async function createSession(userId: string, ctx: SessionContext) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + env.sessionTtlHours * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      tokenHash: hashToken(rawToken),
      userId,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      expiresAt,
    },
  });
  return { rawToken, expiresAt };
}

export async function validateSession(rawToken: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });
  if (!session || !session.active || session.expiresAt < new Date()) return null;

  // Rolling activity timestamp -- cheap enough to do on every authenticated
  // request, and it's what makes the admin sessions view ("currently
  // active") mean something more than just "not yet expired".
  void prisma.session
    .update({ where: { id: session.id }, data: { lastActiveAt: new Date() } })
    .catch(() => undefined);

  return session;
}

export async function revokeSession(rawToken: string): Promise<void> {
  await prisma.session
    .updateMany({ where: { tokenHash: hashToken(rawToken) }, data: { active: false } })
    .catch(() => undefined);
}

export async function listSessions() {
  return prisma.session.findMany({
    include: { user: { select: { email: true, role: true } } },
    orderBy: { lastActiveAt: "desc" },
  });
}

export async function listUsers() {
  return prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      passwordHash: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { sessions: true, alertSentLogs: true } },
      alertSubscription: { select: { active: true, keywords: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function revokeSessionById(sessionId: string): Promise<boolean> {
  const result = await prisma.session.updateMany({ where: { id: sessionId, active: true }, data: { active: false } });
  return result.count > 0;
}
