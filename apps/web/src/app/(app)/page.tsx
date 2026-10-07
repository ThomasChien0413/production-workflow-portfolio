import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, Badge, Card } from "@workflow/ui";
import { membershipKindLabels } from "@workflow/contracts";
import { listDepartments } from "@/lib/departments";
import { getSessionUser } from "@/lib/session";
import { PushReminder } from "@/components/push-reminder";
import { customLoginName } from "@/lib/login-name";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, params] = await Promise.all([getSessionUser(), searchParams]);
  if (!user) redirect("/login");

  // 生產單, 通知 and 系統管理 used to be tiles here. They are in the shell's
  // navigation at every width now, and §3.2.8 says one route gets one entry
  // point — so the home screen is the department launcher and nothing else.
  const departments = await listDepartments();
  const passwordChanged = params["passwordChanged"] === "1";

  // All identities by department id, so a multi-role member sees the complete
  // assignment rather than whichever database row happened to arrive last.
  const memberships = new Map<string, typeof user.memberships>();
  for (const entry of user.memberships) {
    const current = memberships.get(entry.departmentId) ?? [];
    memberships.set(entry.departmentId, [...current, entry]);
  }

  return (
    <main className="cc-page cc-stack" style={{ margin: "0 auto" }}>
      <div className="cc-page__header">
        <div>
          <h1 className="cc-h1">{user.displayName}</h1>
          {customLoginName(user) ? <p className="cc-body-sm cc-muted" style={{ overflowWrap: "anywhere" }}>登入名稱：{customLoginName(user)}</p> : null}
        </div>
      </div>

      {passwordChanged ? (
        <Alert tone="success" title="密碼已變更">
          其他裝置上的工作階段皆已結束，下次使用時需要重新登入。
        </Alert>
      ) : null}

      {user.passwordWarning ? (
        <Alert
          tone="danger"
          title="此帳號仍使用預設密碼"
          assertive
          actions={
            <Link className="cc-btn cc-btn--danger" href="/change-password">
              立即變更密碼
            </Link>
          }
        >
          預設密碼為已知的啟用憑證，並非機密。變更後將登出其他所有工作階段。此提示會持續顯示，直到密碼變更為止。
        </Alert>
      ) : null}

      <PushReminder />

      {/*
        The launcher. All six departments are shown to everyone — an operator
        needs to see where a sheet went after a handoff, not only the department
        they belong to. Membership is marked, not used to hide anything; what a
        user may actually read or change is enforced by the API per sheet.
      */}
      <section className="cc-stack" aria-labelledby="departments-heading">
        <div>
          <h2 className="cc-h2" id="departments-heading">
            部門
          </h2>
          <p className="cc-body-sm cc-muted">選擇部門以檢視該部門目前的生產單。</p>
        </div>

        {departments.length === 0 ? (
          <Card>
            <div className="cc-empty">
              <p className="cc-empty__title">尚無部門資料</p>
              <p className="cc-empty__text">
                目前無法載入部門清單，請重新整理，或聯絡系統管理員。
              </p>
            </div>
          </Card>
        ) : (
          <div className="cc-tilegrid">
            {departments.map((department) => {
              const departmentMemberships = memberships.get(department.id) ?? [];
              return (
                <Link
                  key={department.id}
                  href={`/departments/${department.slug}`}
                  className={`cc-tile${departmentMemberships.length > 0 ? " cc-tile--member" : ""}`}
                >
                  <span className="cc-tile__name">{department.displayName}</span>
                  <span className="cc-tile__foot">
                    {departmentMemberships.length > 0 ? (
                      <Badge tone="info">
                        我的部門・
                        {departmentMemberships
                          .map((entry) => membershipKindLabels[entry.kind])
                          .join("、")}
                      </Badge>
                    ) : (
                      <span className="cc-tile__meta">檢視生產單</span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
