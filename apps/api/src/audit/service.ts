import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  lte,
  or,
  type SQL,
} from "drizzle-orm";
import type { AuditListQuery } from "@workflow/contracts";
import { auditEvents, users, type Database } from "@workflow/database";

const sensitiveMetadataKey =
  /password|secret|token|authorization|cookie|codeverifier|nonce|rawbody|servervalues|sheetvalues|^values?$|^changes$|payload|definition/i;

/**
 * Audit writers already store metadata-only summaries. This final response
 * boundary prevents a future writer from accidentally turning the ADMIN audit
 * endpoint into a secret or production-value disclosure path.
 */
export function sanitizeAuditMetadata(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 12) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditMetadata(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sensitiveMetadataKey.test(key)
          ? "[REDACTED]"
          : sanitizeAuditMetadata(item, depth + 1),
      ]),
    );
  }
  return value;
}
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export class AuditService {
  constructor(private readonly db: Database) {}

  async list(query: AuditListQuery) {
    const conditions: SQL[] = [];
    if (query.action) conditions.push(eq(auditEvents.action, query.action));
    if (query.targetType) {
      conditions.push(eq(auditEvents.targetType, query.targetType));
    }
    if (query.targetId) conditions.push(eq(auditEvents.targetId, query.targetId));
    if (query.actorUserId) {
      conditions.push(eq(auditEvents.actorUserId, query.actorUserId));
    }
    if (query.from) {
      conditions.push(gte(auditEvents.createdAt, new Date(query.from)));
    }
    if (query.to) conditions.push(lte(auditEvents.createdAt, new Date(query.to)));
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      const search = or(
        ilike(auditEvents.action, pattern),
        ilike(auditEvents.targetType, pattern),
        ilike(auditEvents.targetId, pattern),
        ilike(users.username, pattern),
        ilike(users.displayName, pattern),
      );
      if (search) conditions.push(search);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const baseSelection = {
      id: auditEvents.id,
      actorUserId: auditEvents.actorUserId,
      actorUsername: users.username,
      actorDisplayName: users.displayName,
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      requestId: auditEvents.requestId,
      ipAddress: auditEvents.ipAddress,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt,
    };

    const [rows, totalRows] = await Promise.all([
      this.db
        .select(baseSelection)
        .from(auditEvents)
        .leftJoin(users, eq(users.id, auditEvents.actorUserId))
        .where(where)
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ value: count() })
        .from(auditEvents)
        .leftJoin(users, eq(users.id, auditEvents.actorUserId))
        .where(where),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        actor:
          row.actorUserId && row.actorUsername && row.actorDisplayName
            ? {
                id: row.actorUserId,
                username: row.actorUsername,
                displayName: row.actorDisplayName,
              }
            : null,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        requestId: row.requestId,
        ipAddress: row.ipAddress,
        metadata: sanitizeAuditMetadata(row.metadata) as Record<string, unknown>,
        createdAt: row.createdAt,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: totalRows[0]?.value ?? 0,
    };
  }
}
