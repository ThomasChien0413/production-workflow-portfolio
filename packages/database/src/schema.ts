import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  membershipKinds,
  roleCodes,
  sheetStates,
} from "@workflow/contracts";

export const appRoleEnum = pgEnum("app_role", roleCodes);
export const membershipKindEnum = pgEnum(
  "department_membership_kind",
  membershipKinds,
);
export const sheetStateEnum = pgEnum("sheet_state", sheetStates);
export const approvalRunStateEnum = pgEnum("approval_run_state", [
  "PENDING",
  "APPROVED",
  "RETURNED",
  "INVALIDATED",
]);
export const approvalDecisionEnum = pgEnum("approval_decision", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);
// Phone and browser push replaced LINE (the user, 2026-10-04).
export const notificationChannelEnum = pgEnum("notification_channel", [
  "IN_APP",
  "PUSH",
]);
export const notificationStateEnum = pgEnum("notification_state", [
  "PENDING",
  "DELIVERED",
  "FAILED",
  "READ",
]);
export const outboxStateEnum = pgEnum("outbox_state", [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
]);
export const sheetAttachmentStateEnum = pgEnum("sheet_attachment_state", [
  "PENDING_UPLOAD",
  "AVAILABLE",
  "REMOVED",
  "FAILED_CLEANUP",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: varchar("username", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordWarning: boolean("password_warning").notNull().default(false),
    active: boolean("active").notNull().default(true),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    failedLoginWindowStartedAt: timestamp("failed_login_window_started_at", {
      withTimezone: true,
    }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_username_lower_unique").on(sql`lower(${table.username})`),
    index("users_active_idx").on(table.active),
  ],
);

export const roleAssignments = pgTable(
  "role_assignments",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: appRoleEnum("role").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.role] }),
    uniqueIndex("role_assignments_single_active_global_role")
      .on(table.role)
      .where(sql`${table.active} = true AND ${table.role} <> 'ADMIN'`),
  ],
);

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 32 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 64 }).notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("departments_code_unique").on(table.code),
    uniqueIndex("departments_slug_unique").on(table.slug),
  ],
);

export const departmentMemberships = pgTable(
  "department_memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    kind: membershipKindEnum("kind").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "department_memberships_user_department_kind_pk",
      columns: [table.userId, table.departmentId, table.kind],
    }),
    index("department_memberships_department_idx").on(
      table.departmentId,
      table.kind,
      table.active,
    ),
  ],
);

export const departmentSubpages = pgTable(
  "department_subpages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    position: integer("position").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    check("department_subpages_name_check", sql`length(btrim(${table.name})) > 0`),
    check("department_subpages_position_check", sql`${table.position} >= 0`),
    check("department_subpages_revision_check", sql`${table.revision} > 0`),
    uniqueIndex("department_subpages_department_name_unique").on(
      table.departmentId,
      sql`lower(btrim(${table.name}))`,
    ),
    index("department_subpages_department_position_idx").on(
      table.departmentId,
      table.position,
      table.id,
    ),
  ],
);

export const departmentSubpagePermissions = pgTable(
  "department_subpage_permissions",
  {
    subpageId: uuid("subpage_id")
      .notNull()
      .references(() => departmentSubpages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    canView: boolean("can_view").notNull().default(false),
    canCreate: boolean("can_create").notNull().default(false),
    canEdit: boolean("can_edit").notNull().default(false),
    canSubmit: boolean("can_submit").notNull().default(false),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.subpageId, table.userId] }),
    check(
      "department_subpage_permissions_view_dependency",
      sql`${table.canView} OR (NOT ${table.canCreate} AND NOT ${table.canEdit} AND NOT ${table.canSubmit})`,
    ),
    index("department_subpage_permissions_user_idx").on(table.userId, table.subpageId),
  ],
);

export const departmentSubpageIdentityPermissions = pgTable(
  "department_subpage_identity_permissions",
  {
    subpageId: uuid("subpage_id")
      .notNull()
      .references(() => departmentSubpages.id, { onDelete: "cascade" }),
    kind: membershipKindEnum("kind").notNull(),
    canView: boolean("can_view").notNull().default(false),
    canCreate: boolean("can_create").notNull().default(false),
    canEdit: boolean("can_edit").notNull().default(false),
    canSubmit: boolean("can_submit").notNull().default(false),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    primaryKey({
      name: "department_subpage_identity_permissions_pk",
      columns: [table.subpageId, table.kind],
    }),
    check("department_subpage_identity_kind_check", sql`${table.kind} IN ('ORDER_TAKER', 'STAFF')`),
    check(
      "department_subpage_identity_view_dependency",
      sql`${table.canView} OR (NOT ${table.canCreate} AND NOT ${table.canEdit} AND NOT ${table.canSubmit})`,
    ),
  ],
);

export const departmentSubpageTemplates = pgTable(
  "department_subpage_templates",
  {
    subpageId: uuid("subpage_id")
      .notNull()
      .references(() => departmentSubpages.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => sheetTemplates.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "department_subpage_templates_pk",
      columns: [table.subpageId, table.templateId],
    }),
    index("department_subpage_templates_template_idx").on(table.templateId, table.subpageId),
  ],
);

export const departmentSubpageMutations = pgTable(
  "department_subpage_mutations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    clientMutationId: uuid("client_mutation_id").notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    subpageId: uuid("subpage_id"),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("department_subpage_mutations_actor_key_unique").on(
      table.actorUserId,
      table.clientMutationId,
    ),
    index("department_subpage_mutations_department_idx").on(table.departmentId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    csrfTokenHash: char("csrf_token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: varchar("user_agent", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_active_idx").on(table.userId, table.expiresAt),
  ],
);

/**
 * One phone or browser a person turned notifications on for (the user,
 * 2026-10-04). The endpoint is the push service's address for that device;
 * p256dh and auth are its public keys for encrypting what is sent. A device
 * the push service reports gone is deleted.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: varchar("p256dh", { length: 255 }).notNull(),
    auth: varchar("auth", { length: 255 }).notNull(),
    deviceLabel: varchar("device_label", { length: 120 }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
    index("push_subscriptions_user_idx").on(table.userId),
  ],
);

export const sheetTemplates = pgTable(
  "sheet_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    slug: varchar("slug", { length: 96 }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(false),
    currentVersionNumber: integer("current_version_number"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sheet_templates_department_slug_unique").on(
      table.departmentId,
      table.slug,
    ),
  ],
);

export const sheetTemplateVersions = pgTable(
  "sheet_template_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => sheetTemplates.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    requiresReview: boolean("requires_review").notNull().default(false),
    sourceReference: text("source_reference"),
    changeNotes: text("change_notes"),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sheet_template_versions_number_unique").on(
      table.templateId,
      table.version,
    ),
  ],
);

export const templateClientMutations = pgTable(
  "template_client_mutations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    clientMutationId: uuid("client_mutation_id").notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => sheetTemplates.id, { onDelete: "restrict" }),
    versionId: uuid("version_id").references(() => sheetTemplateVersions.id, {
      onDelete: "restrict",
    }),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("template_client_mutations_actor_key_unique").on(
      table.actorUserId,
      table.clientMutationId,
    ),
    index("template_client_mutations_template_idx").on(table.templateId),
  ],
);

export const productionSheets = pgTable(
  "production_sheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sheetNumber: varchar("sheet_number", { length: 64 }).notNull(),
    templateVersionId: uuid("template_version_id")
      .notNull()
      .references(() => sheetTemplateVersions.id, { onDelete: "restrict" }),
    originDepartmentId: uuid("origin_department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    currentDepartmentId: uuid("current_department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    subpageId: uuid("subpage_id").references(() => departmentSubpages.id, {
      onDelete: "restrict",
    }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    state: sheetStateEnum("state").notNull().default("DRAFT"),
    version: integer("version").notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("production_sheets_number_unique").on(table.sheetNumber),
    index("production_sheets_department_state_idx").on(
      table.currentDepartmentId,
      table.state,
    ),
    index("production_sheets_assignee_due_idx").on(table.assignedUserId, table.dueAt),
    index("production_sheets_subpage_state_idx").on(table.subpageId, table.state),
  ],
);

export const sheetSubpageHistory = pgTable(
  "sheet_subpage_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sheetId: uuid("sheet_id")
      .notNull()
      .references(() => productionSheets.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    fromDepartmentId: uuid("from_department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    fromDepartmentName: varchar("from_department_name", { length: 64 }),
    fromSubpageId: uuid("from_subpage_id").references(() => departmentSubpages.id, {
      onDelete: "set null",
    }),
    fromSubpageName: varchar("from_subpage_name", { length: 80 }),
    toDepartmentId: uuid("to_department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    toDepartmentName: varchar("to_department_name", { length: 64 }),
    toSubpageId: uuid("to_subpage_id").references(() => departmentSubpages.id, {
      onDelete: "set null",
    }),
    toSubpageName: varchar("to_subpage_name", { length: 80 }),
    reason: varchar("reason", { length: 32 }).notNull(),
    requestId: varchar("request_id", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sheet_subpage_history_sheet_created_idx").on(table.sheetId, table.createdAt),
  ],
);

export const sheetValues = pgTable("sheet_values", {
  sheetId: uuid("sheet_id")
    .primaryKey()
    .references(() => productionSheets.id, { onDelete: "cascade" }),
  values: jsonb("values").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sheetFieldVersions = pgTable(
  "sheet_field_versions",
  {
    sheetId: uuid("sheet_id")
      .notNull()
      .references(() => productionSheets.id, { onDelete: "cascade" }),
    fieldKey: varchar("field_key", { length: 128 }).notNull(),
    version: integer("version").notNull(),
    updatedByUserId: uuid("updated_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sheetId, table.fieldKey] })],
);

export const sheetClientMutations = pgTable(
  "sheet_client_mutations",
  {
    sheetId: uuid("sheet_id")
      .notNull()
      .references(() => productionSheets.id, { onDelete: "cascade" }),
    clientMutationId: uuid("client_mutation_id").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sheetId, table.clientMutationId] })],
);

/**
 * A row the receiving department has ticked off (the user, 2026-10-03):
 * 分條申請單's rows, by 分條's 主管. One row here per ticked row; unticking
 * deletes it. Kept apart from the sheet's values, which are the paper form's.
 */
export const sheetRowMarks = pgTable(
  "sheet_row_marks",
  {
    sheetId: uuid("sheet_id")
      .notNull()
      .references(() => productionSheets.id, { onDelete: "cascade" }),
    sectionKey: varchar("section_key", { length: 64 }).notNull(),
    rowIndex: integer("row_index").notNull(),
    markedByUserId: uuid("marked_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sheetId, table.sectionKey, table.rowIndex] }),
    check("sheet_row_marks_row_index_check", sql`${table.rowIndex} >= 0`),
  ],
);

export const sheetAttachments = pgTable(
  "sheet_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sheetId: uuid("sheet_id")
      .notNull()
      .references(() => productionSheets.id, { onDelete: "cascade" }),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    storageKey: text("storage_key").notNull(),
    storageVersionId: text("storage_version_id"),
    state: sheetAttachmentStateEnum("state")
      .notNull()
      .default("PENDING_UPLOAD"),
    availableAt: timestamp("available_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByUserId: uuid("removed_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    cleanupError: text("cleanup_error"),
    ...timestamps,
  },
  (table) => [
    check(
      "sheet_attachments_size_check",
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 104857600`,
    ),
    check(
      "sheet_attachments_sha256_check",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    uniqueIndex("sheet_attachments_storage_key_unique").on(table.storageKey),
    index("sheet_attachments_sheet_state_created_idx").on(
      table.sheetId,
      table.state,
      table.createdAt,
    ),
  ],
);

export const sheetAttachmentMutations = pgTable(
  "sheet_attachment_mutations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    sheetId: uuid("sheet_id")
      .notNull()
      .references(() => productionSheets.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id"),
    action: varchar("action", { length: 32 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("PENDING"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "sheet_attachment_mutations_action_check",
      sql`${table.action} IN ('UPLOAD', 'REMOVE')`,
    ),
    check(
      "sheet_attachment_mutations_status_check",
      sql`${table.status} IN ('PENDING', 'COMPLETED', 'FAILED')`,
    ),
    foreignKey({
      name: "sheet_attachment_mutations_attachment_id_fk",
      columns: [table.attachmentId],
      foreignColumns: [sheetAttachments.id],
    }).onDelete("cascade"),
    uniqueIndex("sheet_attachment_mutations_actor_key_unique").on(
      table.actorUserId,
      table.idempotencyKey,
    ),
    index("sheet_attachment_mutations_sheet_idx").on(table.sheetId),
  ],
);

export const sheetAssignments = pgTable(
  "sheet_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sheetId: uuid("sheet_id")
      .notNull()
      .references(() => productionSheets.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    assignedUserId: uuid("assigned_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assignedByUserId: uuid("assigned_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sheet_assignments_sheet_idx").on(table.sheetId, table.createdAt)],
);

export const sheetRouteParticipants = pgTable(
  "sheet_route_participants",
  {
    sheetId: uuid("sheet_id")
      .notNull()
      .references(() => productionSheets.id, { onDelete: "cascade" }),
    managerUserId: uuid("manager_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sheetId, table.managerUserId] })],
);

export const sheetHandoffs = pgTable(
  "sheet_handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sheetId: uuid("sheet_id")
      .notNull()
      .references(() => productionSheets.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    sourceDepartmentId: uuid("source_department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    destinationDepartmentId: uuid("destination_department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    sentByUserId: uuid("sent_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    note: text("note"),
    priorAssignment: jsonb("prior_assignment").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sheet_handoffs_sequence_unique").on(table.sheetId, table.sequence),
  ],
);

export const approvalRuns = pgTable(
  "approval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sheetId: uuid("sheet_id")
      .notNull()
      .references(() => productionSheets.id, { onDelete: "cascade" }),
    runNumber: integer("run_number").notNull(),
    status: approvalRunStateEnum("status").notNull().default("PENDING"),
    reviewedDataFingerprint: char("reviewed_data_fingerprint", { length: 64 }).notNull(),
    submittedByUserId: uuid("submitted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("approval_runs_sheet_number_unique").on(table.sheetId, table.runNumber),
  ],
);

export const approvalSteps = pgTable(
  "approval_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    approvalRunId: uuid("approval_run_id")
      .notNull()
      .references(() => approvalRuns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    requiredRole: appRoleEnum("required_role").notNull(),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    decision: approvalDecisionEnum("decision").notNull().default("PENDING"),
    comment: text("comment"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("approval_steps_run_sequence_unique").on(
      table.approvalRunId,
      table.sequence,
    ),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    action: varchar("action", { length: 128 }).notNull(),
    targetType: varchar("target_type", { length: 64 }).notNull(),
    targetId: varchar("target_id", { length: 128 }),
    requestId: varchar("request_id", { length: 64 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: varchar("ip_address", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_target_idx").on(table.targetType, table.targetId),
    index("audit_events_created_idx").on(table.createdAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sheetId: uuid("sheet_id").references(() => productionSheets.id, {
      onDelete: "cascade",
    }),
    channel: notificationChannelEnum("channel").notNull(),
    eventType: varchar("event_type", { length: 96 }).notNull(),
    summary: varchar("summary", { length: 500 }).notNull(),
    deepLink: text("deep_link"),
    state: notificationStateEnum("state").notNull().default("PENDING"),
    deduplicationKey: varchar("deduplication_key", { length: 255 }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notifications_deduplication_unique").on(table.deduplicationKey),
    index("notifications_recipient_state_idx").on(
      table.recipientUserId,
      table.state,
      table.createdAt,
    ),
  ],
);

export const notificationAttempts = pgTable(
  "notification_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    outcome: varchar("outcome", { length: 64 }).notNull(),
    providerStatusCode: integer("provider_status_code"),
    sanitizedError: text("sanitized_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_attempt_number_unique").on(
      table.notificationId,
      table.attemptNumber,
    ),
  ],
);

export const outboxJobs = pgTable(
  "outbox_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobType: varchar("job_type", { length: 96 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    state: outboxStateEnum("state").notNull().default("PENDING"),
    deduplicationKey: varchar("deduplication_key", { length: 255 }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 128 }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("outbox_jobs_deduplication_unique").on(table.deduplicationKey),
    index("outbox_jobs_claim_idx").on(table.state, table.availableAt),
  ],
);
