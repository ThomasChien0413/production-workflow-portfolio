import { z } from "zod";
import { membershipKindSchema, roleCodeSchema } from "./roles.js";

// Real names and manager-chosen aliases, never invisible/control characters.
const usernamePattern = /^[\p{L}\p{M}\p{N} ._'’·-]+$/u;

/**
 * A new, reset or initial password needs at least 8 characters (the user,
 * 2026-10-01; it was 12). Sign-in itself checks no length, so the bootstrap
 * legacy short login credentials can still authenticate until changed. The
 * portfolio bootstrap uses its distinct public, local-only demo password.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

export const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const usernameSchema = z
  .string()
  .refine((value) => !/[\p{C}\p{Zl}\p{Zp}]/u.test(value), {
    message: "登入名稱不可包含控制字元或隱藏字元",
  })
  .trim()
  .normalize("NFC")
  .min(1, "請輸入登入名稱")
  .max(64, "登入名稱不可超過 64 個字元")
  .regex(usernamePattern, "登入名稱可使用中英文姓名、數字、空格及 . _ - ' ’ · 符號");

export const loginRequestSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(256),
});

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: newPasswordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "新密碼不可與目前密碼相同",
    path: ["newPassword"],
  });

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  roles: z.array(roleCodeSchema),
  memberships: z.array(
    z.object({
      departmentId: z.string().uuid(),
      departmentCode: z.string(),
      departmentName: z.string(),
      kind: membershipKindSchema,
    }),
  ),
  passwordWarning: z.boolean(),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;
