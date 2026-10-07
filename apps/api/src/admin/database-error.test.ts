import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { ConflictError } from "../auth/errors.js";
import { accountConstraintConflict } from "./database-error.js";

const uniqueError = (constraint_name: string) => Object.assign(new Error("private database details"), { code: "23505", constraint_name });
const wrapped = (cause: Error) => new DrizzleQueryError("INSERT INTO users ...", ["private synthetic parameter"], cause);

describe("account constraint error translation", () => {
  it.each([false, true])("maps duplicate names to 409 with ORM wrapper=%s", (wrap) => {
    const cause = uniqueError("users_username_lower_unique");
    const conflict = accountConstraintConflict(wrap ? wrapped(cause) : cause);
    expect(conflict).toBeInstanceOf(ConflictError);
    expect(conflict?.statusCode).toBe(409);
    expect(conflict?.message).toBe("使用者名稱已存在");
    expect(conflict?.message).not.toContain("INSERT");
    expect(conflict?.message).not.toContain("private");
  });

  it("keeps singleton-role conflict wording through nested wrappers", () => {
    const error = wrapped(wrapped(uniqueError("role_assignments_single_active_global_role")));
    expect(accountConstraintConflict(error)?.message).toBe("業務、協理及總經理各只能有一位啟用中的使用者");
  });

  it("retains the generic 409 for other unique constraints", () => {
    expect(accountConstraintConflict(wrapped(uniqueError("other_unique")))?.message).toBe("資料與現有設定衝突");
  });

  it.each([undefined, null, "23505", new Error("unique-looking text 23505"), { code: 23505 }, { code: "23503" }, { code: "08006" }])("does not translate a non-unique error %j", (error) => {
    expect(accountConstraintConflict(error)).toBeNull();
  });

  it("bounds cyclic and excessively deep cause chains", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(accountConstraintConflict(cyclic)).toBeNull();
    let error: Error = uniqueError("users_username_lower_unique");
    for (let index = 0; index < 10; index += 1) error = wrapped(error);
    expect(accountConstraintConflict(error)).toBeNull();
  });
});
