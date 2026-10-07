-- A department identity is independently assignable. Existing rows already
-- contain one concrete kind and are retained unchanged; widening the primary
-- key permits the other kinds to coexist for the same user and department.
ALTER TABLE "department_memberships" DROP CONSTRAINT "department_memberships_user_id_department_id_pk";--> statement-breakpoint
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_user_department_kind_pk" PRIMARY KEY("user_id","department_id","kind");
