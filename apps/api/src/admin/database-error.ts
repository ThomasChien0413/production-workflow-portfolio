import { ConflictError } from "../auth/errors.js";

/** Inspect SQLSTATE only: ORM messages may contain queries and parameters. */
export function accountConstraintConflict(error: unknown): ConflictError | null {
  const seen = new Set<object>();
  let current = error;
  // DrizzleQueryError wraps postgres-js errors in cause. Bound malformed/cyclic
  // chains and leave every non-unique error to the normal sanitized 500 handler.
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null || seen.has(current)) return null;
    seen.add(current);
    const detail = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (detail.code === "23505") {
      if (detail.constraint_name === "users_username_lower_unique") {
        return new ConflictError("使用者名稱已存在");
      }
      if (detail.constraint_name === "role_assignments_single_active_global_role") {
        return new ConflictError("業務、協理及總經理各只能有一位啟用中的使用者");
      }
      return new ConflictError("資料與現有設定衝突");
    }
    current = detail.cause;
  }
  return null;
}
