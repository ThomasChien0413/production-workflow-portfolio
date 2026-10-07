import { z } from "zod";
import { membershipKindSchema } from "./roles.js";

export const configurableSubpageKindSchema = z.enum(["ORDER_TAKER", "STAFF"]);

export const departmentSubpageParamsSchema = z.object({
  departmentId: z.string().uuid(),
}).strict();

export const departmentSubpageItemParamsSchema = z.object({
  departmentId: z.string().uuid(),
  subpageId: z.string().uuid(),
}).strict();

export const subpageCapabilitiesSchema = z.object({
  canView: z.boolean(),
  canCreate: z.boolean(),
  canEdit: z.boolean(),
  canSubmit: z.boolean(),
}).strict();

export const subpageIdentityPermissionSchema = subpageCapabilitiesSchema.extend({
  kind: configurableSubpageKindSchema,
}).superRefine((permission, context) => {
  if (!permission.canView && (permission.canCreate || permission.canEdit || permission.canSubmit)) {
    context.addIssue({ code: "custom", message: "建立、修改或送審權限需要查看權限", path: ["canView"] });
  }
});

export const replaceSubpageIdentityPermissionsRequestSchema = z.object({
  clientMutationId: z.string().uuid(),
  revision: z.number().int().positive(),
  permissions: z.array(subpageIdentityPermissionSchema).length(2),
}).strict().refine((value) => new Set(value.permissions.map((item) => item.kind)).size === 2, {
  message: "請設定訂單人員與員工兩種身分",
  path: ["permissions"],
});

export const replaceSubpageTemplatesRequestSchema = z.object({
  clientMutationId: z.string().uuid(),
  revision: z.number().int().positive(),
  templateIds: z.array(z.string().uuid()).max(100),
}).strict().refine((value) => new Set(value.templateIds).size === value.templateIds.length, {
  message: "表單範本不可重複",
  path: ["templateIds"],
});

export const createDepartmentSubpageRequestSchema = z.object({
  clientMutationId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
}).strict();

export const updateDepartmentSubpageRequestSchema = z.object({
  clientMutationId: z.string().uuid(),
  revision: z.number().int().positive(),
  name: z.string().trim().min(1).max(80).optional(),
  position: z.number().int().nonnegative().optional(),
}).strict().refine((value) => value.name !== undefined || value.position !== undefined, {
  message: "至少需要一項變更",
});

export const deleteDepartmentSubpageRequestSchema = z.object({
  clientMutationId: z.string().uuid(),
  revision: z.number().int().positive(),
}).strict();

export const departmentSubpageSchema = z.object({
  id: z.string().uuid(),
  departmentId: z.string().uuid(),
  name: z.string().min(1),
  position: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  sheetCount: z.number().int().nonnegative(),
  capabilities: subpageCapabilitiesSchema,
  identityPermissions: z.array(subpageIdentityPermissionSchema),
  enabledTemplateIds: z.array(z.string().uuid()),
}).strict();

export const subpageEligibleTemplateSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1),
  documentCode: z.string(),
  version: z.number().int().positive(),
}).strict();

export const subpageEligibleUserSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1),
  kinds: z.array(membershipKindSchema).min(1),
  manager: z.boolean(),
}).strict();

export const departmentSubpagePageSchema = z.object({
  canManage: z.boolean(),
  subpages: z.array(departmentSubpageSchema),
  eligibleTemplates: z.array(subpageEligibleTemplateSchema),
  eligibleUsers: z.array(subpageEligibleUserSchema),
}).strict();

export type CreateDepartmentSubpageRequest = z.infer<typeof createDepartmentSubpageRequestSchema>;
export type UpdateDepartmentSubpageRequest = z.infer<typeof updateDepartmentSubpageRequestSchema>;
export type DeleteDepartmentSubpageRequest = z.infer<typeof deleteDepartmentSubpageRequestSchema>;
export type DepartmentSubpage = z.infer<typeof departmentSubpageSchema>;
export type SubpageIdentityPermission = z.infer<typeof subpageIdentityPermissionSchema>;
export type SubpageEligibleTemplate = z.infer<typeof subpageEligibleTemplateSchema>;
export type SubpageEligibleUser = z.infer<typeof subpageEligibleUserSchema>;
export type ReplaceSubpageIdentityPermissionsRequest = z.infer<typeof replaceSubpageIdentityPermissionsRequestSchema>;
export type ReplaceSubpageTemplatesRequest = z.infer<typeof replaceSubpageTemplatesRequestSchema>;
export type DepartmentSubpagePage = z.infer<typeof departmentSubpagePageSchema>;
