import { expect, test as setup } from "@playwright/test";
import postgres from "postgres";
import {
  AUTH_FILE,
  DEACTIVATION_TARGET,
  E2E_SUBPAGE,
  SEEDED_ADMIN,
  WORKFLOW_AUTH_FILES,
  WORKFLOW_USERS,
  type WorkflowUserKey,
} from "./support";

type SafeUser = { id: string; username: string };
type Department = { id: string; code: string };

async function ensureWorkflowUser(
  page: import("@playwright/test").Page,
  writeHeaders: Record<string, string>,
  key: WorkflowUserKey,
  departments: ReadonlyMap<string, Department>,
): Promise<SafeUser> {
  const fixture = WORKFLOW_USERS[key];
  const departmentCode = "departmentCode" in fixture ? fixture.departmentCode : null;
  const department = departmentCode ? departments.get(departmentCode) : null;
  expect(
    departmentCode === null || department,
    `Seeded department ${departmentCode ?? ""} is required for ${fixture.username}`,
  ).toBeTruthy();

  const memberships =
    department && "membershipKind" in fixture
      ? [{ departmentId: department.id, kind: fixture.membershipKind }]
      : [];
  const desired = {
    displayName: fixture.displayName,
    active: true,
    roles: [...fixture.roles],
    memberships,
  };

  const lookup = await page.request.get(
    `/api/users?q=${encodeURIComponent(fixture.username)}`,
  );
  expect(lookup.ok(), `Account lookup failed with ${lookup.status()}`).toBeTruthy();
  const existing = ((await lookup.json()) as { users: SafeUser[] }).users.find(
    (user) => user.username === fixture.username,
  );

  let user: SafeUser;
  if (existing) {
    const updated = await page.request.patch(`/api/users/${existing.id}`, {
      headers: writeHeaders,
      data: desired,
    });
    const updatedText = await updated.text();
    expect(
      updated.ok(),
      `Could not refresh ${fixture.username}. The workflow suite requires an isolated seeded database with no competing singleton reviewer accounts. ${updatedText}`,
    ).toBeTruthy();
    user = (JSON.parse(updatedText) as { user: SafeUser }).user;

    const reset = await page.request.post(`/api/users/${user.id}/password-reset`, {
      headers: writeHeaders,
      data: { newPassword: fixture.password },
    });
    expect(
      reset.ok(),
      `Password reset failed for ${fixture.username}: ${await reset.text()}`,
    ).toBeTruthy();
  } else {
    const created = await page.request.post("/api/users", {
      headers: writeHeaders,
      data: {
        username: fixture.username,
        initialPassword: fixture.password,
        ...desired,
      },
    });
    const createdText = await created.text();
    expect(
      created.ok(),
      `Could not create ${fixture.username}. The workflow suite requires an isolated seeded database with no competing singleton reviewer accounts. ${createdText}`,
    ).toBeTruthy();
    user = (JSON.parse(createdText) as { user: SafeUser }).user;
  }

  return user;
}

async function prepareWorkflowSubpages(users: ReadonlyArray<SafeUser>) {
  const databaseUrl = process.env.DATABASE_URL;
  expect(databaseUrl, "DATABASE_URL is required to prepare the workflow subpages").toBeTruthy();
  const sql = postgres(databaseUrl ?? "", { max: 1, prepare: false });
  try {
    // The seed makes no subpage, so the suite makes its own in every
    // department and ticks each department's forms in it, as a 主管 would.
    await sql`
      insert into department_subpages (department_id, name, position)
      select id, ${E2E_SUBPAGE}, 0 from departments
      on conflict do nothing
    `;
    await sql`
      insert into department_subpage_templates (subpage_id, template_id)
      select subpage.id, template.id
      from department_subpages subpage
      join departments department on department.id = subpage.department_id
      join sheet_templates template on template.active
      join sheet_template_versions version
        on version.template_id = template.id
       and version.version = template.current_version_number
       and version.published_at is not null
      where subpage.name = ${E2E_SUBPAGE}
        and version.definition->>'status' = 'APPROVED'
        and jsonb_exists(version.definition->'allowedCreatorDepartmentCodes', department.code)
      on conflict do nothing
    `;
    const userIds = users.map((user) => user.id);
    await sql`
      insert into department_subpage_identity_permissions (
        subpage_id, kind, can_view, can_create, can_edit, can_submit,
        created_at, updated_at
      )
      select distinct
        subpage.id, membership.kind, true, true, true, true, now(), now()
      from department_memberships membership
      join department_subpages subpage
        on subpage.department_id = membership.department_id
       and subpage.name = ${E2E_SUBPAGE}
      where membership.user_id = any(${userIds}::uuid[])
        and membership.active = true
        and membership.kind <> 'MANAGER'
      on conflict (subpage_id, kind) do update set
        can_view = true,
        can_create = true,
        can_edit = true,
        can_submit = true,
        updated_at = now()
    `;
  } finally {
    await sql.end();
  }
}

async function authenticateWorkflowUsers(
  browser: import("@playwright/test").Browser,
  origin: string,
) {
  for (const key of Object.keys(WORKFLOW_USERS) as WorkflowUserKey[]) {
    const fixture = WORKFLOW_USERS[key];
    const workflowContext = await browser.newContext();
    try {
      const response = await workflowContext.request.post(
        `${origin}/api/auth/login`,
        {
          headers: { origin },
          data: { username: fixture.username, password: fixture.password },
        },
      );
      expect(
        response.ok(),
        `Workflow sign-in failed for ${fixture.username}: ${await response.text()}`,
      ).toBeTruthy();
      await workflowContext.storageState({ path: WORKFLOW_AUTH_FILES[key] });
    } finally {
      await workflowContext.close();
    }
  }
}

/**
 * Sign in exactly once for the whole run and persist the cookies.
 *
 * Signing in per test trips the API's login throttle — 20 attempts per 15
 * minutes (apps/api/src/auth/routes.ts) — and the suite would fail with 429 on
 * a real protection working as designed. Relaxing that limit for tests would
 * have removed the very control DESIGN.md section 13 requires, so the fix
 * belongs here instead.
 */
setup("authenticate once and prepare operational fixtures", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const origin = baseURL ?? "";
  const response = await page.request.post("/api/auth/login", {
    headers: { origin },
    data: SEEDED_ADMIN,
  });

  expect(
    response.ok(),
    `Sign-in failed with ${response.status()}. Has the database been migrated and seeded? ${await response.text()}`,
  ).toBeTruthy();

  // Written before the fixture below, so a run that finds the fixture already
  // present still leaves usable cookies behind.
  await context.storageState({ path: AUTH_FILE });

  /**
   * A second account, so the deactivation flow has something to act on that is
   * not the signed-in administrator.
   *
   * A freshly seeded database contains only the bootstrap admin, and an account
   * manager cannot deactivate itself — without this fixture the flow could only
   * ever be observed in its disabled state, which is exactly what it looked
   * like in CI. Created through the real API rather than by writing rows, so
   * the fixture cannot drift from what the product allows. The test cancels
   * rather than confirms, so this account stays active and the setup is
   * idempotent across runs.
   */
  const csrf = (await context.cookies()).find(
    (cookie) => cookie.name === "workflow_csrf",
  )?.value;
  expect(csrf, "login must set the readable CSRF cookie").toBeTruthy();
  const writeHeaders = { origin, "x-csrf-token": csrf ?? "" };

  const existing = await page.request.get(
    `/api/users?q=${encodeURIComponent(DEACTIVATION_TARGET.username)}`,
  );
  expect(existing.ok(), `Account lookup failed with ${existing.status()}`).toBeTruthy();
  const found = ((await existing.json()) as { users: { username: string }[] }).users.some(
    (user) => user.username === DEACTIVATION_TARGET.username,
  );
  const departments = await page.request.get("/api/departments");
  expect(
    departments.ok(),
    `Department lookup failed with ${departments.status()}`,
  ).toBeTruthy();
  const departmentRows = ((await departments.json()) as {
    departments: Department[];
  }).departments;
  const [department] = departmentRows;
  expect(department, "the six seeded departments are required").toBeTruthy();

  if (!found) {
    const created = await page.request.post("/api/users", {
      headers: writeHeaders,
      data: {
        username: DEACTIVATION_TARGET.username,
        displayName: DEACTIVATION_TARGET.displayName,
        initialPassword: DEACTIVATION_TARGET.password,
        // An active account needs at least one role or department, and a
        // department membership avoids competing for a singleton business role.
        memberships: [{ departmentId: department!.id, kind: "STAFF" }],
      },
    });
    expect(
      created.ok(),
      `Fixture account creation failed with ${created.status()}: ${await created.text()}`,
    ).toBeTruthy();
  }

  const departmentByCode = new Map(
    departmentRows.map((row) => [row.code, row] as const),
  );
  const workflowUsers: SafeUser[] = [];
  for (const key of Object.keys(WORKFLOW_USERS) as WorkflowUserKey[]) {
    workflowUsers.push(
      await ensureWorkflowUser(page, writeHeaders, key, departmentByCode),
    );
  }

  // The only direct database fixture write: the subpages a 主管 would make.
  await prepareWorkflowSubpages(workflowUsers);
  await authenticateWorkflowUsers(browser, origin);
});
