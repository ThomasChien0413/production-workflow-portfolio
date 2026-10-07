import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@workflow/ui";
import { getSessionUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "登入 · Workflow Portfolio" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <main className="cc-auth">
      <div className="cc-auth__brand">
        {/* Neutral demo identity, separate from authorized artwork on forms. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed brand
            artwork, not user content. */}
        <img
          className="cc-auth__logo"
          src="/brand/workflow-logo.svg"
          alt="Workflow Portfolio"
          width={131}
          height={48}
        />
        <p className="cc-caption">生產單管理系統</p>
      </div>

      <div className="cc-auth__panel">
        <Card>
          <h1 className="cc-h2" style={{ marginBottom: "var(--cc-space-5)" }}>
            登入
          </h1>
          <LoginForm />
        </Card>
      </div>
    </main>
  );
}
