import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, Card } from "@workflow/ui";
import { changesOwnPassword } from "@workflow/domain";
import { getSessionUser } from "@/lib/session";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "變更密碼 · Workflow Portfolio" };

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Only ADMIN and 總經理 change their own password (the user, 2026-10-04);
  // 設定 tells everyone else who sets theirs.
  if (!changesOwnPassword(user)) redirect("/settings");

  return (
    <main className="cc-auth">
      <div className="cc-auth__panel cc-stack">
        {/*
          Reachable whether or not the warning is showing — a user may change a
          password they simply want to rotate, not only a flagged default one.
        */}
        {user.passwordWarning ? (
          <Alert tone="danger" title="此帳號仍使用預設密碼">
            預設密碼為已知的啟用憑證，並非機密。請立即變更。
          </Alert>
        ) : null}

        <Card header={<h1 className="cc-h2">變更密碼</h1>}>
          <ChangePasswordForm />
        </Card>

        <p className="cc-caption" style={{ textAlign: "center" }}>
          <Link href="/">返回首頁</Link>
        </p>
      </div>
    </main>
  );
}
