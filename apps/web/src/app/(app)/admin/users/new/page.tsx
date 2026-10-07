import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@workflow/ui";
import { listAdminDepartments, listAdminRoles } from "@/lib/admin";
import { CreateUserForm } from "./create-user-form";

export const metadata: Metadata = { title: "新增帳號 · Workflow Portfolio" };

export default async function NewAdminUserPage() {
  const [roles, departments] = await Promise.all([
    listAdminRoles(),
    listAdminDepartments(),
  ]);

  return (
    <div className="cc-stack" style={{ maxWidth: "var(--cc-content-max)" }}>
      <div className="cc-page__header">
        <h1 className="cc-h1">新增帳號</h1>
        <Link className="cc-btn cc-btn--secondary" href="/admin/users">
          返回清單
        </Link>
      </div>
      <Card>
        <CreateUserForm roles={roles} departments={departments} />
      </Card>
    </div>
  );
}
