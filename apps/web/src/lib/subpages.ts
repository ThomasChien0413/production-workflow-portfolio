import type {
  DepartmentSubpage as DepartmentSubpageView,
  DepartmentSubpagePage,
  SubpageEligibleTemplate,
  SubpageEligibleUser,
  SubpageIdentityPermission,
} from "@workflow/contracts";
import { apiOptional, apiRequire } from "./api";
import type { AvailableTemplate } from "./sheet-model";

export type { DepartmentSubpageView, DepartmentSubpagePage, SubpageEligibleTemplate, SubpageEligibleUser, SubpageIdentityPermission };

export async function getDepartmentSubpages(departmentId: string): Promise<DepartmentSubpagePage> {
  return (await apiRequire<DepartmentSubpagePage>(`/api/departments/${departmentId}/subpages`)) ?? {
    canManage: false,
    subpages: [],
    eligibleTemplates: [],
    eligibleUsers: [],
  };
}

export async function getOptionalDepartmentSubpages(departmentId: string): Promise<DepartmentSubpagePage> {
  return apiOptional(`/api/departments/${departmentId}/subpages`, {
    canManage: false,
    subpages: [],
    eligibleTemplates: [],
    eligibleUsers: [],
  });
}

export async function getSubpageCreationOptions(departmentId: string, subpageId: string): Promise<AvailableTemplate[]> {
  const result = await apiRequire<{ templates: AvailableTemplate[] }>(`/api/departments/${departmentId}/subpages/${subpageId}/creation-options`);
  return result?.templates ?? [];
}
