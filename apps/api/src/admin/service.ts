import argon2 from "argon2";
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  roleLabels,
  type AdminMembershipInput,
  type CreateAdminUserRequest,
  type RoleCode,
  type UpdateAdminUserRequest,
} from "@workflow/contracts";
import {
  auditEvents,
  departmentMemberships,
  departments,
  pushSubscriptions,
  roleAssignments,
  sessions,
  users,
  type Database,
} from "@workflow/database";
import { changesOwnPassword } from "@workflow/domain";
import { ConflictError, ResourceNotFoundError } from "../auth/errors.js";
import type { RequestSecurityContext } from "../auth/service.js";
import { accountConstraintConflict } from "./database-error.js";

const singletonRoles = [
  "GENERAL_MANAGER",
  "ASSOCIATE",
  "SALES",
] as const satisfies ReadonlyArray<RoleCode>;

/**
 * Roles that may manage accounts. A holder of either one cannot strip it from
 * themselves — that is how someone locks the whole company out of account
 * management with a single save. Another manager can still do it for them.
 */
const accountManagerRoles = [
  "ADMIN",
  "GENERAL_MANAGER",
] as const satisfies ReadonlyArray<RoleCode>;

type UserListFilters = {
  active?: boolean | undefined;
  q?: string | undefined;
};

type SafeUserSnapshot = {
  active: boolean;
  displayName: string;
  roles: RoleCode[];
  memberships: AdminMembershipInput[];
};

function sortRoles(roles: ReadonlyArray<RoleCode>): RoleCode[] {
  return [...roles].sort();
}

function sortMemberships(
  memberships: ReadonlyArray<AdminMembershipInput>,
): AdminMembershipInput[] {
  return [...memberships].sort(
    (left, right) =>
      left.departmentId.localeCompare(right.departmentId) ||
      left.kind.localeCompare(right.kind),
  );
}

function safeSnapshot(
  active: boolean,
  displayName: string,
  roles: ReadonlyArray<RoleCode>,
  memberships: ReadonlyArray<AdminMembershipInput>,
): SafeUserSnapshot {
  return {
    active,
    displayName,
    roles: sortRoles(roles),
    memberships: sortMemberships(memberships),
  };
}

export class AdminUserService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listUsers(filters: UserListFilters = {}) {
    const conditions = [];
    if (filters.active !== undefined) {
      conditions.push(eq(users.active, filters.active));
    }
    if (filters.q) {
      conditions.push(
        or(
          ilike(users.username, `%${filters.q}%`),
          ilike(users.displayName, `%${filters.q}%`),
        )!,
      );
    }

    const rows = await this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        active: users.active,
        passwordWarning: users.passwordWarning,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(users.displayName), asc(users.username));

    return this.attachAssignments(rows);
  }

  async getUser(userId: string) {
    const [row] = await this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        active: users.active,
        passwordWarning: users.passwordWarning,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new ResourceNotFoundError("找不到指定的使用者");
    const [result] = await this.attachAssignments([row]);
    if (!result) throw new ResourceNotFoundError("找不到指定的使用者");
    return result;
  }

  async listDepartments() {
    return this.db
      .select({
        id: departments.id,
        code: departments.code,
        slug: departments.slug,
        displayName: departments.displayName,
        active: departments.active,
      })
      .from(departments)
      .orderBy(asc(departments.createdAt));
  }

  async createUser(
    input: CreateAdminUserRequest,
    actorUserId: string,
    context: RequestSecurityContext,
  ) {
    const passwordHash = await argon2.hash(input.initialPassword, {
      type: argon2.argon2id,
    });
    const username = input.username.toLowerCase();

    try {
      const userId = await this.db.transaction(async (tx) => {
        await this.assertDepartmentsExist(tx, input.memberships);
        await this.assertSingletonRolesAvailable(tx, input.roles);

        const [created] = await tx
          .insert(users)
          .values({
            username,
            displayName: input.displayName,
            passwordHash,
            passwordWarning: true,
            active: input.active,
          })
          .returning({ id: users.id });
        if (!created) throw new Error("Failed to create user");

        if (input.roles.length > 0) {
          await tx.insert(roleAssignments).values(
            input.roles.map((role) => ({
              userId: created.id,
              role,
              active: true,
            })),
          );
        }
        if (input.memberships.length > 0) {
          await tx.insert(departmentMemberships).values(
            input.memberships.map((membership) => ({
              userId: created.id,
              departmentId: membership.departmentId,
              kind: membership.kind,
              active: true,
            })),
          );
        }

        await tx.insert(auditEvents).values({
          actorUserId,
          action: "ADMIN_USER_CREATED",
          targetType: "USER",
          targetId: created.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          metadata: {
            username,
            assignment: safeSnapshot(
              input.active,
              input.displayName,
              input.roles,
              input.memberships,
            ),
          },
        });

        return created.id;
      });

      return await this.getUser(userId);
    } catch (error) {
      this.rethrowConstraint(error);
      throw error;
    }
  }

  async updateUser(
    userId: string,
    input: UpdateAdminUserRequest,
    actorUserId: string,
    context: RequestSecurityContext,
  ) {
    const now = this.now();
    if (userId === actorUserId && input.active === false) {
      throw new ConflictError("不可停用目前登入的管理員帳號");
    }

    try {
      await this.db.transaction(async (tx) => {
        const [currentUser] = await tx
          .select({
            id: users.id,
            displayName: users.displayName,
            active: users.active,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!currentUser) throw new ResourceNotFoundError("找不到指定的使用者");

        const currentRoleRows = await tx
          .select({ role: roleAssignments.role })
          .from(roleAssignments)
          .where(
            and(
              eq(roleAssignments.userId, userId),
              eq(roleAssignments.active, true),
            ),
          );
        const currentMembershipRows = await tx
          .select({
            departmentId: departmentMemberships.departmentId,
            kind: departmentMemberships.kind,
          })
          .from(departmentMemberships)
          .where(
            and(
              eq(departmentMemberships.userId, userId),
              eq(departmentMemberships.active, true),
            ),
          );

        // Self-lockout guard. Checked against the roles the actor actually
        // holds rather than assuming ADMIN: 總經理 also manages accounts, and
        // demanding an ADMIN role they never had would block every self-edit.
        if (userId === actorUserId && input.roles) {
          const managerRoles: readonly RoleCode[] = accountManagerRoles;
          const held = currentRoleRows
            .map((row) => row.role)
            .filter((role) => managerRoles.includes(role));
          if (held.length > 0 && !held.some((role) => input.roles!.includes(role))) {
            throw new ConflictError("不可移除目前登入帳號的帳號管理權限");
          }
        }

        const active = input.active ?? currentUser.active;
        const roles = active
          ? (input.roles ?? currentRoleRows.map((row) => row.role))
          : [];
        const memberships = active
          ? (input.memberships ?? currentMembershipRows)
          : [];
        const displayName = input.displayName ?? currentUser.displayName;

        if (
          !active &&
          ((input.roles?.length ?? 0) > 0 ||
            (input.memberships?.length ?? 0) > 0)
        ) {
          throw new ConflictError("停用帳號不可啟用角色或部門身分");
        }
        if (active && roles.length === 0 && memberships.length === 0) {
          throw new ConflictError(
            "啟用中的帳號至少需要一個角色或部門身分",
          );
        }

        await this.assertDepartmentsExist(tx, memberships);
        await this.assertSingletonRolesAvailable(tx, roles, userId);

        const before = safeSnapshot(
          currentUser.active,
          currentUser.displayName,
          currentRoleRows.map((row) => row.role),
          currentMembershipRows,
        );
        const after = safeSnapshot(active, displayName, roles, memberships);

        await tx
          .update(users)
          .set({ active, displayName, updatedAt: this.now() })
          .where(eq(users.id, userId));

        if (input.roles !== undefined || !active) {
          await tx
            .update(roleAssignments)
            .set({ active: false })
            .where(eq(roleAssignments.userId, userId));
          for (const role of roles) {
            await tx
              .insert(roleAssignments)
              .values({ userId, role, active: true })
              .onConflictDoUpdate({
                target: [roleAssignments.userId, roleAssignments.role],
                set: { active: true },
              });
          }
        }

        if (input.memberships !== undefined || !active) {
          await tx
            .update(departmentMemberships)
            .set({ active: false })
            .where(eq(departmentMemberships.userId, userId));
          for (const membership of memberships) {
            await tx
              .insert(departmentMemberships)
              .values({
                userId,
                departmentId: membership.departmentId,
                kind: membership.kind,
                active: true,
              })
              .onConflictDoUpdate({
                target: [
                  departmentMemberships.userId,
                  departmentMemberships.departmentId,
                  departmentMemberships.kind,
                ],
                set: { active: true },
              });
          }
        }

        if (
          !active ||
          input.roles !== undefined ||
          input.memberships !== undefined
        ) {
          await tx
            .update(sessions)
            .set({ revokedAt: now })
            .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
        }
        // A deactivated account is told nothing more on its devices.
        if (!active) {
          await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
        }

        await tx.insert(auditEvents).values({
          actorUserId,
          action: "ADMIN_USER_UPDATED",
          targetType: "USER",
          targetId: userId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          metadata: { before, after },
        });
      });

      return await this.getUser(userId);
    } catch (error) {
      this.rethrowConstraint(error);
      throw error;
    }
  }

  async resetPassword(
    userId: string,
    newPassword: string,
    actorUserId: string,
    context: RequestSecurityContext,
  ): Promise<void> {
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });
    const now = this.now();

    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(users)
        .set({
          passwordHash,
          passwordWarning: true,
          failedLoginAttempts: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: null,
          passwordChangedAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      if (!updated[0]) throw new ResourceNotFoundError("找不到指定的使用者");

      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(eq(sessions.userId, userId));
      await tx.insert(auditEvents).values({
        actorUserId,
        action: "ADMIN_PASSWORD_RESET",
        targetType: "USER",
        targetId: userId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
      });
    });
  }

  private async attachAssignments<
    T extends {
      id: string;
      username: string;
      displayName: string;
      active: boolean;
      passwordWarning: boolean;
      createdAt: Date;
      updatedAt: Date;
    },
  >(rows: T[]) {
    if (rows.length === 0) return [];
    const userIds = rows.map((row) => row.id);
    const [roleRows, membershipRows, deviceRows] = await Promise.all([
      this.db
        .select({ userId: roleAssignments.userId, role: roleAssignments.role })
        .from(roleAssignments)
        .where(
          and(
            inArray(roleAssignments.userId, userIds),
            eq(roleAssignments.active, true),
          ),
        ),
      this.db
        .select({
          userId: departmentMemberships.userId,
          departmentId: departments.id,
          departmentCode: departments.code,
          departmentName: departments.displayName,
          kind: departmentMemberships.kind,
        })
        .from(departmentMemberships)
        .innerJoin(
          departments,
          eq(departments.id, departmentMemberships.departmentId),
        )
        .where(
          and(
            inArray(departmentMemberships.userId, userIds),
            eq(departmentMemberships.active, true),
          ),
        ),
      // Phones and browsers with notifications on (the user, 2026-10-04).
      this.db
        .select({
          userId: pushSubscriptions.userId,
          devices: sql<number>`count(*)::int`,
          lastSuccessAt: sql<Date | null>`max(${pushSubscriptions.lastSuccessAt})`,
        })
        .from(pushSubscriptions)
        .where(inArray(pushSubscriptions.userId, userIds))
        .groupBy(pushSubscriptions.userId),
    ]);

    return rows.map((row) => {
      const devices = deviceRows.find((device) => device.userId === row.id);
      const roles = sortRoles(
        roleRows
          .filter((assignment) => assignment.userId === row.id)
          .map((assignment) => assignment.role),
      );
      return {
        ...row,
        // Only someone who changes their own password still has a default one
        // to change (the user, 2026-10-04); everyone else's is set for them.
        passwordWarning: row.passwordWarning && changesOwnPassword({ roles }),
        roles,
        memberships: membershipRows
          .filter((membership) => membership.userId === row.id)
          .sort(
            (left, right) =>
              left.departmentName.localeCompare(right.departmentName, "zh-Hant") ||
              left.kind.localeCompare(right.kind),
          ),
        pushDevices: {
          count: devices?.devices ?? 0,
          lastSuccessAt: devices?.lastSuccessAt ? new Date(devices.lastSuccessAt) : null,
        },
      };
    });
  }

  private async assertDepartmentsExist(
    db: Parameters<Parameters<Database["transaction"]>[0]>[0],
    memberships: ReadonlyArray<AdminMembershipInput>,
  ): Promise<void> {
    if (memberships.length === 0) return;
    const ids = memberships.map((membership) => membership.departmentId);
    const rows = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(inArray(departments.id, ids), eq(departments.active, true)));
    if (rows.length !== new Set(ids).size) {
      throw new ConflictError("指定的部門不存在或已停用");
    }
  }

  private async assertSingletonRolesAvailable(
    db: Parameters<Parameters<Database["transaction"]>[0]>[0],
    roles: ReadonlyArray<RoleCode>,
    excludedUserId?: string,
  ): Promise<void> {
    const requestedSingletons = roles.filter((role) =>
      singletonRoles.includes(role as (typeof singletonRoles)[number]),
    );
    if (requestedSingletons.length === 0) return;

    const conditions = [
      inArray(roleAssignments.role, requestedSingletons),
      eq(roleAssignments.active, true),
      eq(users.active, true),
    ];
    if (excludedUserId) conditions.push(ne(roleAssignments.userId, excludedUserId));

    const [conflict] = await db
      .select({ role: roleAssignments.role })
      .from(roleAssignments)
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .where(and(...conditions))
      .limit(1);
    if (conflict) {
      throw new ConflictError(`${roleLabels[conflict.role]}已有啟用中的使用者`);
    }
  }

  private rethrowConstraint(error: unknown): void {
    const conflict = accountConstraintConflict(error);
    if (conflict) throw conflict;
  }
}
