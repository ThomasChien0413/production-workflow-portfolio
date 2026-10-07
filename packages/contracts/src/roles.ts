import { z } from "zod";

export const roleCodes = [
  "ADMIN",
  "GENERAL_MANAGER",
  "ASSOCIATE",
  "SALES",
] as const;

export const roleLabels = {
  ADMIN: "ADMIN",
  GENERAL_MANAGER: "總經理",
  ASSOCIATE: "協理",
  SALES: "業務",
} as const satisfies Record<(typeof roleCodes)[number], string>;

export const roleCodeSchema = z.enum(roleCodes);
export type RoleCode = z.infer<typeof roleCodeSchema>;

/**
 * What someone does inside a department.
 *
 * `ORDER_TAKER` was added on 2026-08-15 for 平板剪, where the person who takes
 * a customer's order opens the 裁剪需求表 and fills the order side of it before
 * the 主管 fills in the production side. It is a department membership rather
 * than a global role because a global role is a company-wide singleton — the
 * database enforces one active holder each — and order-taking is a job several
 * people may hold, in more than one department.
 */
export const membershipKinds = ["MANAGER", "ORDER_TAKER", "STAFF"] as const;
export const membershipKindSchema = z.enum(membershipKinds);
export type MembershipKind = z.infer<typeof membershipKindSchema>;

/**
 * Department identities are stored and transmitted as MANAGER/STAFF but are
 * always shown to users as 主管/員工 (AGENTS.md §2). The mapping lives here so a
 * screen cannot invent its own and drift from the wire format — sending the
 * Chinese label as the value is rejected by the API with a validation error.
 */
export const membershipKindLabels = {
  MANAGER: "主管",
  ORDER_TAKER: "訂單人員",
  STAFF: "員工",
} as const satisfies Record<(typeof membershipKinds)[number], string>;

export const departmentSeeds = [
  { code: "SLITTING", slug: "slitting", displayName: "分條" },
  { code: "CUT", slug: "cut", displayName: "CUT" },
  { code: "STAMPING", slug: "stamping", displayName: "沖壓" },
  { code: "FLAT_SHEAR", slug: "flat-shear", displayName: "平板剪" },
  { code: "SHAO_DUN", slug: "shao-dun", displayName: "燒頓" },
  { code: "WAREHOUSE", slug: "warehouse", displayName: "倉管" },
] as const;

export const departmentCodeSchema = z.enum(
  departmentSeeds.map((department) => department.code) as [
    (typeof departmentSeeds)[number]["code"],
    ...(typeof departmentSeeds)[number]["code"][],
  ],
);
export type DepartmentCode = z.infer<typeof departmentCodeSchema>;
