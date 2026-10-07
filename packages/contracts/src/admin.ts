import { z } from "zod";
import { newPasswordSchema, usernameSchema } from "./auth.js";
import {
  membershipKindSchema,
  roleCodeSchema,
  roleCodes,
  roleLabels,
} from "./roles.js";

const passwordSchema = newPasswordSchema;

export const adminMembershipInputSchema = z
  .object({
    departmentId: z.string().uuid(),
    kind: membershipKindSchema,
  })
  .strict();

function hasDuplicateMemberships(
  memberships: ReadonlyArray<{ departmentId: string; kind: string }>,
): boolean {
  return (
    new Set(
      memberships.map(
        (membership) => `${membership.departmentId}:${membership.kind}`,
      ),
    ).size !== memberships.length
  );
}

function hasDuplicateRoles(roles: ReadonlyArray<string>): boolean {
  return new Set(roles).size !== roles.length;
}

const resolvedCreateAdminUserRequestSchema = z
  .object({
    username: usernameSchema,
    displayName: z.string().trim().min(1).max(120),
    initialPassword: passwordSchema,
    active: z.boolean().default(true),
    roles: z.array(roleCodeSchema).max(roleCodes.length).default([]),
    memberships: z.array(adminMembershipInputSchema).max(18).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (hasDuplicateRoles(value.roles)) {
      context.addIssue({
        code: "custom",
        message: "角色不可重複",
        path: ["roles"],
      });
    }
    if (hasDuplicateMemberships(value.memberships)) {
      context.addIssue({
        code: "custom",
        message: "同一部門身分不可重複設定",
        path: ["memberships"],
      });
    }
    if (value.active && value.roles.length === 0 && value.memberships.length === 0) {
      context.addIssue({
        code: "custom",
        message: "啟用中的帳號至少需要一個角色或部門身分",
        path: ["roles"],
      });
    }
    if (!value.active && (value.roles.length > 0 || value.memberships.length > 0)) {
      context.addIssue({
        code: "custom",
        message: "停用帳號不可同時啟用角色或部門身分",
        path: ["active"],
      });
    }
  });

// Keep the wire key and resolved service shape compatible. A supplied alias is
// validated normally; only an omitted login name defaults to the person's name.
export const createAdminUserRequestSchema = z.preprocess((input) => {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const value = input as Record<string, unknown>;
    if (value.username === undefined) return { ...value, username: value.displayName };
  }
  return input;
}, resolvedCreateAdminUserRequestSchema);

export const updateAdminUserRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    active: z.boolean().optional(),
    roles: z.array(roleCodeSchema).max(roleCodes.length).optional(),
    memberships: z.array(adminMembershipInputSchema).max(18).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: "custom", message: "至少需要一項變更" });
    }
    if (value.roles && hasDuplicateRoles(value.roles)) {
      context.addIssue({
        code: "custom",
        message: "角色不可重複",
        path: ["roles"],
      });
    }
    if (value.memberships && hasDuplicateMemberships(value.memberships)) {
      context.addIssue({
        code: "custom",
        message: "同一部門身分不可重複設定",
        path: ["memberships"],
      });
    }
    if (
      value.active === false &&
      ((value.roles?.length ?? 0) > 0 || (value.memberships?.length ?? 0) > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "停用帳號不可同時啟用角色或部門身分",
        path: ["active"],
      });
    }
  });

export const resetAdminUserPasswordRequestSchema = z
  .object({ newPassword: passwordSchema })
  .strict();

export const adminUserIdParamsSchema = z
  .object({ userId: z.string().uuid() })
  .strict();

export const adminUserListQuerySchema = z
  .object({
    active: z.enum(["true", "false"]).optional(),
    q: z.string().trim().max(120).optional(),
  })
  .strict()
  .transform((value) => ({
    active: value.active === undefined ? undefined : value.active === "true",
    q: value.q || undefined,
  }));

export const adminRoleCatalog = roleCodes.map((code) => ({
  code,
  label: roleLabels[code],
  singleton: code !== "ADMIN",
}));

export type CreateAdminUserRequest = z.infer<
  typeof createAdminUserRequestSchema
>;
export type UpdateAdminUserRequest = z.infer<
  typeof updateAdminUserRequestSchema
>;
export type AdminMembershipInput = z.infer<typeof adminMembershipInputSchema>;
