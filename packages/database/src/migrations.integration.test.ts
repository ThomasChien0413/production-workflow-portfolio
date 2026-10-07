import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("migration 0007 modular department roles", () => {
  it("preserves existing identities and widens uniqueness to department plus kind", async () => {
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const schema = `migration_0007_${randomUUID().replaceAll("-", "")}`;
    try {
      await sql`create schema ${sql(schema)}`;
      await sql`set search_path to ${sql(schema)}`;
      await sql`
        create table department_memberships (
          user_id uuid not null,
          department_id uuid not null,
          kind text not null,
          active boolean not null default true,
          created_at timestamptz not null default now(),
          constraint department_memberships_user_id_department_id_pk
            primary key (user_id, department_id)
        )
      `;
      await sql`
        create index department_memberships_department_idx
        on department_memberships (department_id, kind, active)
      `;

      const existing = [
        {
          userId: "00000000-0000-4000-8000-000000000001",
          departmentId: "10000000-0000-4000-8000-000000000001",
          kind: "MANAGER",
          active: true,
        },
        {
          userId: "00000000-0000-4000-8000-000000000002",
          departmentId: "10000000-0000-4000-8000-000000000001",
          kind: "STAFF",
          active: false,
        },
        {
          userId: "00000000-0000-4000-8000-000000000003",
          departmentId: "10000000-0000-4000-8000-000000000002",
          kind: "ORDER_TAKER",
          active: true,
        },
      ] as const;
      for (const row of existing) {
        await sql`
          insert into department_memberships (user_id, department_id, kind, active)
          values (${row.userId}, ${row.departmentId}, ${row.kind}, ${row.active})
        `;
      }

      const migration = await readFile(
        new URL("../migrations/0007_modular_department_roles.sql", import.meta.url),
        "utf8",
      );
      await sql.unsafe(migration.replaceAll("--> statement-breakpoint", ""));

      const rows = await sql<
        { userId: string; departmentId: string; kind: string; active: boolean }[]
      >`
        select user_id as "userId", department_id as "departmentId", kind, active
        from department_memberships
        order by user_id
      `;
      expect(rows).toEqual(existing);

      await sql`
        insert into department_memberships (user_id, department_id, kind)
        values (
          ${existing[0].userId},
          ${existing[0].departmentId},
          'STAFF'
        )
      `;
      await expect(
        sql`
          insert into department_memberships (user_id, department_id, kind)
          values (
            ${existing[0].userId},
            ${existing[0].departmentId},
            'STAFF'
          )
        `,
      ).rejects.toMatchObject({ code: "23505" });

      const [primaryKey] = await sql<{ definition: string }[]>`
        select pg_get_constraintdef(constraint_row.oid) as definition
        from pg_constraint constraint_row
        inner join pg_namespace namespace_row
          on namespace_row.oid = constraint_row.connamespace
        where namespace_row.nspname = ${schema}
          and constraint_row.conname = 'department_memberships_user_department_kind_pk'
      `;
      expect(primaryKey?.definition).toBe(
        "PRIMARY KEY (user_id, department_id, kind)",
      );
    } finally {
      await sql`drop schema if exists ${sql(schema)} cascade`;
      await sql.end();
    }
  });
});

describe.skipIf(!testDatabaseUrl)("migration 0009 subpage creation policy", () => {
  // On a fresh database the migration runs before any department exists, so
  // what it backfilled into 未分類 was really the seed's doing; the seed makes
  // no default subpage since 2026-10-03. What still holds: a new subpage
  // starts with no forms and no identity grants, for its 主管 to set.
  it("leaves new subpages manager-only", async () => {
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    let createdSubpageId: string | null = null;
    try {
      const [created] = await sql<{ id: string }[]>`
        insert into department_subpages (department_id, name, position)
        select id, ${`migration-0009-${randomUUID().slice(0, 8)}`}, 100
        from departments where code = 'CUT'
        returning id
      `;
      if (!created) throw new Error("Could not create migration test subpage");
      createdSubpageId = created.id;
      const [defaults] = await sql<{ templates: number; identities: number }[]>`
        select
          (select count(*)::int from department_subpage_templates where subpage_id = ${createdSubpageId}) as templates,
          (select count(*)::int from department_subpage_identity_permissions where subpage_id = ${createdSubpageId}) as identities
      `;
      expect(defaults).toEqual({ templates: 0, identities: 0 });
      await sql`
        insert into department_subpage_identity_permissions
          (subpage_id, kind, can_view, can_create)
        values (${createdSubpageId}, 'STAFF', true, true)
      `;
      await expect(sql`
        insert into department_subpage_identity_permissions
          (subpage_id, kind, can_view)
        values (${createdSubpageId}, 'STAFF', true)
      `).rejects.toMatchObject({ code: "23505" });
      await expect(sql`
        insert into department_subpage_identity_permissions
          (subpage_id, kind, can_view, can_edit)
        values (${createdSubpageId}, 'ORDER_TAKER', false, true)
      `).rejects.toMatchObject({ code: "23514" });
    } finally {
      if (createdSubpageId) await sql`delete from department_subpages where id = ${createdSubpageId}`;
      await sql.end();
    }
  });
});
