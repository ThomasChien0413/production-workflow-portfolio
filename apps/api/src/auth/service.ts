import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { SessionUser } from "@workflow/contracts";
import { changesOwnPassword } from "@workflow/domain";
import {
  auditEvents,
  departmentMemberships,
  departments,
  roleAssignments,
  sessions,
  users,
  type Database,
} from "@workflow/database";
import type { ApiConfig } from "../config.js";
import { AuthenticationError, AuthorizationError } from "./errors.js";

const dummyPasswordHashPromise = argon2.hash(
  "workflow-dummy-password-used-only-to-equalize-login-timing",
  { type: argon2.argon2id },
);

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type RequestSecurityContext = {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
};

export type AuthenticatedSession = {
  sessionId: string;
  user: SessionUser;
};

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly config: ApiConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async login(
    usernameInput: string,
    password: string,
    context: RequestSecurityContext,
  ): Promise<{
    sessionToken: string;
    csrfToken: string;
    expiresAt: Date;
    user: SessionUser;
  }> {
    const username = usernameInput.trim().toLowerCase();
    const now = this.now();
    const [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = ${username}`)
      .limit(1);

    if (!user) {
      await argon2.verify(await dummyPasswordHashPromise, password);
      await this.db.insert(auditEvents).values({
        action: "AUTH_LOGIN_FAILED",
        targetType: "USER",
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: { username },
      });
      throw new AuthenticationError();
    }

    if (!user.active) {
      await this.recordAuthEvent(user.id, "AUTH_LOGIN_INACTIVE", context);
      throw new AuthenticationError();
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      await this.recordAuthEvent(user.id, "AUTH_LOGIN_LOCKED", context);
      throw new AuthenticationError();
    }

    const passwordMatches = await argon2.verify(user.passwordHash, password);
    if (!passwordMatches) {
      await this.recordFailedAttempt(user, now, context);
      throw new AuthenticationError();
    }

    const sessionToken = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlMs);

    const [createdSession] = await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          failedLoginAttempts: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: null,
          updatedAt: now,
        })
        .where(eq(users.id, user.id));

      const sessionRows = await tx
        .insert(sessions)
        .values({
          userId: user.id,
          tokenHash: hashToken(sessionToken),
          csrfTokenHash: hashToken(csrfToken),
          expiresAt,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        })
        .returning({ id: sessions.id });

      await tx.insert(auditEvents).values({
        actorUserId: user.id,
        action: "AUTH_LOGIN_SUCCEEDED",
        targetType: "SESSION",
        targetId: sessionRows[0]?.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
      });

      return sessionRows;
    });

    if (!createdSession) throw new Error("Failed to create session");

    return {
      sessionToken,
      csrfToken,
      expiresAt,
      user: await this.loadSessionUser(user.id),
    };
  }

  async authenticate(sessionToken: string): Promise<AuthenticatedSession> {
    const now = this.now();
    const [row] = await this.db
      .select({ sessionId: sessions.id, userId: users.id })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(sessionToken)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          eq(users.active, true),
        ),
      )
      .limit(1);

    if (!row) throw new AuthenticationError("登入狀態已失效，請重新登入");

    return {
      sessionId: row.sessionId,
      user: await this.loadSessionUser(row.userId),
    };
  }

  async verifyCsrf(sessionId: string, csrfToken: string): Promise<void> {
    const [session] = await this.db
      .select({ csrfTokenHash: sessions.csrfTokenHash })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session || session.csrfTokenHash !== hashToken(csrfToken)) {
      throw new AuthorizationError("安全驗證失敗，請重新整理後再試");
    }
  }

  async logout(
    sessionId: string,
    userId: string,
    context: RequestSecurityContext,
  ): Promise<void> {
    const now = this.now();
    await this.db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
      await tx.insert(auditEvents).values({
        actorUserId: userId,
        action: "AUTH_LOGOUT",
        targetType: "SESSION",
        targetId: sessionId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
      });
    });
  }

  async changePassword(
    sessionId: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: RequestSecurityContext,
  ): Promise<SessionUser> {
    // Only ADMIN and 總經理 change their own password (the user, 2026-10-04);
    // everyone else's is set for them in 帳號管理.
    const roles = await this.activeRoles(userId);
    if (!changesOwnPassword({ roles })) {
      throw new AuthorizationError("密碼由系統管理者或總經理設定，請聯絡他們變更。");
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new AuthenticationError("目前密碼不正確");
    }

    const now = this.now();
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash,
          passwordWarning: false,
          passwordChangedAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, userId));
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), ne(sessions.id, sessionId)));
      await tx.insert(auditEvents).values({
        actorUserId: userId,
        action: "AUTH_PASSWORD_CHANGED",
        targetType: "USER",
        targetId: userId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
      });
    });

    return this.loadSessionUser(userId);
  }

  private async loadSessionUser(userId: string): Promise<SessionUser> {
    const [user] = await this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        passwordWarning: users.passwordWarning,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new AuthenticationError();

    const roles = await this.activeRoles(userId);

    const memberships = await this.db
      .select({
        departmentId: departments.id,
        departmentCode: departments.code,
        departmentName: departments.displayName,
        kind: departmentMemberships.kind,
      })
      .from(departmentMemberships)
      .innerJoin(departments, eq(departments.id, departmentMemberships.departmentId))
      .where(
        and(
          eq(departmentMemberships.userId, userId),
          eq(departmentMemberships.active, true),
          eq(departments.active, true),
        ),
      )
      .orderBy(asc(departments.displayName), asc(departmentMemberships.kind));

    return {
      ...user,
      // The default-password warning is for those who may act on it.
      passwordWarning: user.passwordWarning && changesOwnPassword({ roles }),
      roles,
      memberships,
    };
  }

  private async activeRoles(userId: string) {
    const assignedRoles = await this.db
      .select({ role: roleAssignments.role })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.active, true)));
    return assignedRoles.map((assignment) => assignment.role);
  }

  private async recordFailedAttempt(
    user: typeof users.$inferSelect,
    now: Date,
    context: RequestSecurityContext,
  ): Promise<void> {
    const inWindow =
      user.failedLoginWindowStartedAt !== null &&
      now.getTime() - user.failedLoginWindowStartedAt.getTime() <=
        this.config.loginAttemptWindowMs;
    const failedLoginAttempts = inWindow ? user.failedLoginAttempts + 1 : 1;
    const shouldLock = failedLoginAttempts >= this.config.loginLockThreshold;

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          failedLoginAttempts,
          failedLoginWindowStartedAt: inWindow
            ? user.failedLoginWindowStartedAt
            : now,
          lockedUntil: shouldLock
            ? new Date(now.getTime() + this.config.loginLockMs)
            : null,
          updatedAt: now,
        })
        .where(eq(users.id, user.id));
      await tx.insert(auditEvents).values({
        actorUserId: user.id,
        action: shouldLock ? "AUTH_ACCOUNT_LOCKED" : "AUTH_LOGIN_FAILED",
        targetType: "USER",
        targetId: user.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: { failedLoginAttempts },
      });
    });
  }

  private async recordAuthEvent(
    userId: string,
    action: string,
    context: RequestSecurityContext,
  ): Promise<void> {
    await this.db.insert(auditEvents).values({
      actorUserId: userId,
      action,
      targetType: "USER",
      targetId: userId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
    });
  }
}
