import postgres from "postgres";
import { WORKFLOW_USERS } from "./support";

/**
 * Release singleton roles and operational memberships even when a workflow
 * assertion fails. The accounts and their immutable sheet history stay in the
 * disposable database, matching the product's account-retention rule; the next
 * setup reactivates the same named fixtures through the real administrator API.
 */
export default async function globalTeardown() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const usernames = Object.values(WORKFLOW_USERS).map((user) => user.username);
    const rows = await sql<{ id: string }[]>`
      select id from users where username in ${sql(usernames)}
    `;
    const userIds = rows.map((row) => row.id);
    if (userIds.length === 0) return;

    await sql.begin(async (transaction) => {
      const now = new Date();
      // Workflow events enqueue push jobs. Remove only jobs and notification
      // history addressed to these synthetic recipients so a later worker
      // integration test cannot claim browser-fixture work.
      await transaction`
        delete from outbox_jobs
        where payload ->> 'notificationId' in (
          select id::text
          from notifications
          where recipient_user_id in ${transaction(userIds)}
        )
      `;
      await transaction`
        delete from notifications
        where recipient_user_id in ${transaction(userIds)}
      `;
      await transaction`
        update sessions
        set revoked_at = coalesce(revoked_at, ${now})
        where user_id in ${transaction(userIds)}
      `;
      await transaction`
        update role_assignments
        set active = false
        where user_id in ${transaction(userIds)}
      `;
      await transaction`
        delete from department_subpage_permissions
        where user_id in ${transaction(userIds)}
      `;
      await transaction`
        update department_memberships
        set active = false
        where user_id in ${transaction(userIds)}
      `;
      await transaction`
        delete from push_subscriptions
        where user_id in ${transaction(userIds)}
      `;
      await transaction`
        update users
        set active = false, updated_at = ${now}
        where id in ${transaction(userIds)}
      `;
    });
  } finally {
    await sql.end();
  }
}
