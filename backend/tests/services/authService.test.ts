let users: any[] = [];
let sessions: any[] = [];
let userIdCounter = 0;
let sessionIdCounter = 0;

const mockEnv = { adminEmails: [] as string[], sessionTtlHours: 720 };

jest.mock("../../src/config/env", () => ({ env: mockEnv }));

jest.mock("../../src/services/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.email !== undefined) return users.find((u) => u.email === where.email) ?? null;
        if (where.googleId !== undefined) return users.find((u) => u.googleId === where.googleId) ?? null;
        if (where.id !== undefined) return users.find((u) => u.id === where.id) ?? null;
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const user = { id: `user-${++userIdCounter}`, ...data };
        users.push(user);
        return user;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const user = users.find((u) => u.id === where.id);
        if (user) Object.assign(user, data);
        return user;
      }),
      count: jest.fn(async ({ where }: any = {}) => where?.role ? users.filter((u) => u.role === where.role).length : users.length),
    },
    session: {
      create: jest.fn(async ({ data }: any) => {
        const session = { id: `session-${++sessionIdCounter}`, active: true, lastActiveAt: new Date(), ...data };
        sessions.push(session);
        return session;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const session = sessions.find((s) => s.tokenHash === where.tokenHash);
        if (!session) return null;
        const user = users.find((u) => u.id === session.userId);
        return { ...session, user };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const session = sessions.find((s) => s.id === where.id);
        if (session) Object.assign(session, data);
        return session;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const s of sessions) {
          if ((where.tokenHash !== undefined && s.tokenHash === where.tokenHash) ||
              (where.id !== undefined && s.id === where.id && (where.active === undefined || s.active === where.active))) {
            Object.assign(s, data);
            count++;
          }
        }
        return { count };
      }),
      findMany: jest.fn(async () => sessions.map((s) => ({ ...s, user: users.find((u) => u.id === s.userId) }))),
    },
  },
}));

import {
  registerUser,
  loginUser,
  validateSession,
  revokeSession,
  findOrCreateGoogleUser,
  createUserByAdmin,
  updateUserRole,
  revokeSessionById,
  AuthError,
} from "../../src/services/authService";

describe("authService", () => {
  beforeEach(() => {
    users = [];
    sessions = [];
    userIdCounter = 0;
    sessionIdCounter = 0;
    mockEnv.adminEmails = [];
  });

  describe("registerUser", () => {
    it("stores a bcrypt hash, never the plaintext password", async () => {
      await registerUser("new@example.com", "correct horse battery staple", {});
      expect(users).toHaveLength(1);
      expect(users[0].passwordHash).not.toBe("correct horse battery staple");
      expect(users[0].passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt hash format
    });

    it("rejects a second registration with the same email", async () => {
      await registerUser("dupe@example.com", "password123", {});
      await expect(registerUser("dupe@example.com", "different-password", {})).rejects.toThrow(AuthError);
    });

    it("normalises email casing so Foo@X.com and foo@x.com collide", async () => {
      await registerUser("Foo@Example.com", "password123", {});
      await expect(registerUser("foo@example.com", "password123", {})).rejects.toThrow(AuthError);
    });

    it("makes the very first user admin when ADMIN_EMAILS is unset", async () => {
      const { user } = await registerUser("first@example.com", "password123", {});
      expect(user.role).toBe("admin");
    });

    it("does not make the second user admin", async () => {
      await registerUser("first@example.com", "password123", {});
      const { user: second } = await registerUser("second@example.com", "password123", {});
      expect(second.role).toBe("user");
    });

    it("makes a user admin if their email is in ADMIN_EMAILS, even if not first", async () => {
      mockEnv.adminEmails = ["boss@example.com"];
      await registerUser("first@example.com", "password123", {}); // would be admin-by-first-user if allowlist were empty
      const { user } = await registerUser("boss@example.com", "password123", {});
      expect(user.role).toBe("admin");
      expect(users.find((u) => u.email === "first@example.com").role).toBe("user");
    });

    it("returns a usable session token alongside the user", async () => {
      const { rawToken, expiresAt } = await registerUser("session@example.com", "password123", {});
      expect(typeof rawToken).toBe("string");
      expect(rawToken.length).toBeGreaterThan(20);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("loginUser", () => {
    beforeEach(async () => {
      await registerUser("login@example.com", "correct-password", {});
    });

    it("succeeds with the correct password", async () => {
      const { user } = await loginUser("login@example.com", "correct-password", {});
      expect(user.email).toBe("login@example.com");
    });

    it("rejects the wrong password", async () => {
      await expect(loginUser("login@example.com", "wrong-password", {})).rejects.toThrow(AuthError);
    });

    it("rejects an unknown email with the same generic message as a wrong password", async () => {
      let unknownEmailError: AuthError | undefined;
      let wrongPasswordError: AuthError | undefined;
      try {
        await loginUser("nobody@example.com", "whatever", {});
      } catch (err) {
        unknownEmailError = err as AuthError;
      }
      try {
        await loginUser("login@example.com", "wrong-password", {});
      } catch (err) {
        wrongPasswordError = err as AuthError;
      }
      expect(unknownEmailError?.message).toBe(wrongPasswordError?.message);
      expect(unknownEmailError?.status).toBe(401);
    });
  });

  describe("findOrCreateGoogleUser", () => {
    it("creates a brand new account for a first-time Google sign-in", async () => {
      const { user } = await findOrCreateGoogleUser("google-sub-1", "new-google@example.com", {});
      expect(users).toHaveLength(1);
      expect(user.email).toBe("new-google@example.com");
      expect(user.googleId).toBe("google-sub-1");
      expect(user.passwordHash).toBeUndefined();
    });

    it("returns the same account on a second sign-in with the same Google identity", async () => {
      const first = await findOrCreateGoogleUser("google-sub-2", "repeat@example.com", {});
      const second = await findOrCreateGoogleUser("google-sub-2", "repeat@example.com", {});
      expect(users).toHaveLength(1);
      expect(second.user.id).toBe(first.user.id);
    });

    it("links Google to an existing password account with the same email instead of creating a duplicate", async () => {
      await registerUser("shared@example.com", "correct-password", {});
      const { user } = await findOrCreateGoogleUser("google-sub-3", "shared@example.com", {});

      expect(users).toHaveLength(1); // still one account, not two
      expect(user.googleId).toBe("google-sub-3");
      expect(user.passwordHash).toBeDefined(); // the original password still works too

      // The password login path still works after linking.
      const loggedIn = await loginUser("shared@example.com", "correct-password", {});
      expect(loggedIn.user.id).toBe(user.id);
    });

    it("makes the very first-ever user admin even when they sign up via Google", async () => {
      const { user } = await findOrCreateGoogleUser("google-sub-4", "first@example.com", {});
      expect(user.role).toBe("admin");
    });

    it("returns a usable session token", async () => {
      const { rawToken } = await findOrCreateGoogleUser("google-sub-5", "session@example.com", {});
      const session = await validateSession(rawToken);
      expect(session?.user.email).toBe("session@example.com");
    });
  });

  describe("validateSession", () => {
    it("returns the session+user for a freshly issued token", async () => {
      const { rawToken } = await registerUser("valid@example.com", "password123", {});
      const session = await validateSession(rawToken);
      expect(session?.user.email).toBe("valid@example.com");
    });

    it("returns null for a token that was never issued", async () => {
      expect(await validateSession("not-a-real-token")).toBeNull();
    });

    it("returns null once the session has been revoked (logout)", async () => {
      const { rawToken } = await registerUser("revoke@example.com", "password123", {});
      await revokeSession(rawToken);
      expect(await validateSession(rawToken)).toBeNull();
    });

    it("returns null for an expired session", async () => {
      const { rawToken } = await registerUser("expired@example.com", "password123", {});
      sessions[0].expiresAt = new Date(Date.now() - 1000);
      expect(await validateSession(rawToken)).toBeNull();
    });
  });

  describe("admin account controls", () => {
    it("creates a password account without storing plaintext", async () => {
      const user = await createUserByAdmin("Managed@Example.com", "managed-password", "user");
      expect(user.email).toBe("managed@example.com");
      expect(users[0].passwordHash).toMatch(/^\$2[aby]\$/);
      expect(users[0].passwordHash).not.toBe("managed-password");
    });

    it("rejects duplicate admin-created accounts", async () => {
      await createUserByAdmin("managed@example.com", "managed-password", "user");
      await expect(createUserByAdmin("MANAGED@example.com", "another-password", "user")).rejects.toThrow("already exists");
    });

    it("promotes a user to admin", async () => {
      const first = await registerUser("admin@example.com", "password123", {});
      const second = await registerUser("user@example.com", "password123", {});
      const updated = await updateUserRole(second.user.id, "admin", first.user.id);
      expect(updated.role).toBe("admin");
    });

    it("prevents an admin from demoting their own account", async () => {
      const { user } = await registerUser("admin@example.com", "password123", {});
      await expect(updateUserRole(user.id, "user", user.id)).rejects.toThrow("own admin access");
    });

    it("prevents demoting the final admin", async () => {
      const first = await registerUser("first@example.com", "password123", {});
      const second = await registerUser("second@example.com", "password123", {});
      await expect(updateUserRole(first.user.id, "user", second.user.id)).rejects.toThrow("final admin");
    });

    it("revokes an active session by id", async () => {
      await registerUser("session@example.com", "password123", {});
      expect(await revokeSessionById(sessions[0].id)).toBe(true);
      expect(sessions[0].active).toBe(false);
    });
  });
});
