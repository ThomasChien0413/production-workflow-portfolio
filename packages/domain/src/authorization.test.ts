import { describe, expect, it } from "vitest";
import {
  canRouteWork,
  changesOwnPassword,
  isCompanyReader,
  managesDepartment,
  type ActorSnapshot,
} from "./authorization.js";

function actor(overrides: Partial<ActorSnapshot> = {}): ActorSnapshot {
  return {
    userId: "someone",
    roles: [],
    memberships: [],
    ...overrides,
  };
}

// Reading, creating, editing and submitting are authorised per department
// subpage in the API; these two remain department-level manager authority.
describe("department management", () => {
  it("lets a manager assign and hand off only in the department they manage", () => {
    const manager = actor({
      userId: "manager",
      memberships: [{ departmentId: "department-cut", kind: "MANAGER" }],
    });

    expect(managesDepartment(manager, "department-cut")).toBe(true);
    expect(canRouteWork(manager, "department-cut")).toBe(true);
    expect(managesDepartment(manager, "department-stamping")).toBe(false);
    expect(canRouteWork(manager, "department-stamping")).toBe(false);
  });

  it.each(["ORDER_TAKER", "STAFF"] as const)(
    "does not treat a %s membership as management",
    (kind) => {
      const member = actor({
        memberships: [{ departmentId: "department-cut", kind }],
      });

      expect(managesDepartment(member, "department-cut")).toBe(false);
      expect(canRouteWork(member, "department-cut")).toBe(false);
    },
  );

  // The user, 2026-09-30: ADMIN and 總經理 hold a 主管's authority everywhere.
  it.each(["ADMIN", "GENERAL_MANAGER"] as const)(
    "lets %s manage every department without a membership",
    (role) => {
      const company = actor({ roles: [role] });
      expect(managesDepartment(company, "department-cut")).toBe(true);
      expect(managesDepartment(company, "department-stamping")).toBe(true);
      expect(canRouteWork(company, "department-cut")).toBe(true);
    },
  );

  it.each(["ASSOCIATE", "SALES"] as const)(
    "does not let the global %s role manage a department on its own",
    (role) => {
      expect(managesDepartment(actor({ roles: [role] }), "department-cut")).toBe(
        false,
      );
    },
  );

  it("combines identities without leaking one department's into another", () => {
    const person = actor({
      memberships: [
        { departmentId: "department-cut", kind: "ORDER_TAKER" },
        { departmentId: "department-cut", kind: "MANAGER" },
        { departmentId: "department-stamping", kind: "STAFF" },
      ],
    });

    expect(managesDepartment(person, "department-cut")).toBe(true);
    expect(managesDepartment(person, "department-stamping")).toBe(false);
  });
});

describe("changing one's own password", () => {
  it("is for ADMIN and 總經理 alone, who set everyone else's", () => {
    expect(changesOwnPassword(actor({ roles: ["ADMIN"] }))).toBe(true);
    expect(changesOwnPassword(actor({ roles: ["GENERAL_MANAGER"] }))).toBe(true);
    for (const role of ["ASSOCIATE", "SALES"] as const) {
      expect(changesOwnPassword(actor({ roles: [role] }))).toBe(false);
    }
    expect(
      changesOwnPassword(actor({ memberships: [{ departmentId: "cut", kind: "MANAGER" }] })),
    ).toBe(false);
  });
});

describe("company-wide readers", () => {
  it("are ADMIN, 總經理, 協理 and 業務, who alone have 審核", () => {
    for (const role of ["ADMIN", "GENERAL_MANAGER", "ASSOCIATE", "SALES"] as const) {
      expect(isCompanyReader(actor({ roles: [role] }))).toBe(true);
    }
  });

  it("are not department members, however many identities they hold", () => {
    expect(
      isCompanyReader(
        actor({
          memberships: [
            { departmentId: "cut", kind: "MANAGER" },
            { departmentId: "cut", kind: "ORDER_TAKER" },
            { departmentId: "cut", kind: "STAFF" },
          ],
        }),
      ),
    ).toBe(false);
    expect(isCompanyReader(actor())).toBe(false);
  });
});
