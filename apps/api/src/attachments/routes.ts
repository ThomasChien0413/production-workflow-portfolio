import { rm } from "node:fs/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  attachmentIdempotencyKeySchema,
  sheetAttachmentContentQuerySchema,
  sheetAttachmentIdParamsSchema,
  sheetAttachmentListQuerySchema,
  sheetIdParamsSchema,
} from "@workflow/contracts";
import type { ApiConfig } from "../config.js";
import { createAuthGuards } from "../auth/guards.js";
import type { AuthService, RequestSecurityContext } from "../auth/service.js";
import type { SheetRealtimeHub } from "../sheets/realtime.js";
import { AttachmentRangeError, attachmentContentDisposition } from "./http.js";
import type { SheetAttachmentService } from "./service.js";
import { readPdfMultipartToTemp } from "./upload.js";

function securityContext(request: FastifyRequest): RequestSecurityContext {
  return {
    requestId: request.id,
    ipAddress: request.ip ?? null,
    userAgent: request.headers["user-agent"] ?? null,
  };
}

function idempotencyKey(request: FastifyRequest): string {
  return attachmentIdempotencyKeySchema.parse(request.headers["idempotency-key"]);
}

export async function registerSheetAttachmentRoutes(
  app: FastifyInstance,
  authService: AuthService,
  attachments: SheetAttachmentService,
  realtime: SheetRealtimeHub,
  config: ApiConfig,
): Promise<void> {
  const guards = createAuthGuards(authService, config);
  const readGuards = [guards.requireSession];
  const writeGuards = [guards.requireSession, guards.requireCsrf];

  app.get(
    "/api/sheets/:sheetId/attachments",
    { preHandler: readGuards },
    async (request) => {
      const { sheetId } = sheetIdParamsSchema.parse(request.params);
      const { page } = sheetAttachmentListQuerySchema.parse(request.query);
      return await attachments.list(request.authSession!.user, sheetId, page);
    },
  );

  app.post(
    "/api/sheets/:sheetId/attachments",
    { preHandler: writeGuards },
    async (request, reply) => {
      const { sheetId } = sheetIdParamsSchema.parse(request.params);
      const key = idempotencyKey(request);
      await attachments.requireModifiable(request.authSession!.user, sheetId);
      const release = attachments.acquireUploadCapacity();
      let prepared: Awaited<ReturnType<typeof readPdfMultipartToTemp>> | null = null;
      try {
        prepared = await readPdfMultipartToTemp(
          request,
          config.attachmentTempDirectory,
          config.attachmentMaxBytes,
        );
        const result = await attachments.upload(
          request.authSession!.user,
          sheetId,
          key,
          prepared,
          securityContext(request),
        );
        if (!result.replayed) {
          await realtime.publish(sheetId, "sheet.attachment.changed");
        }
        return reply.code(result.replayed ? 200 : 201).send(result);
      } finally {
        if (prepared) await rm(prepared.tempPath, { force: true });
        release();
      }
    },
  );

  app.get(
    "/api/sheets/:sheetId/attachments/:attachmentId/content",
    { preHandler: readGuards },
    async (request, reply) => {
      const { sheetId, attachmentId } = sheetAttachmentIdParamsSchema.parse(
        request.params,
      );
      const { disposition } = sheetAttachmentContentQuerySchema.parse(request.query);
      try {
        const result = await attachments.open(
          request.authSession!.user,
          sheetId,
          attachmentId,
          disposition,
          typeof request.headers.range === "string"
            ? request.headers.range
            : undefined,
          securityContext(request),
        );
        const partial = Boolean(result.range);
        if (result.range) {
          reply.header(
            "content-range",
            `bytes ${result.range.start}-${result.range.end}/${result.attachment.sizeBytes}`,
          );
        }
        return reply
          .code(partial ? 206 : 200)
          .header("content-type", "application/pdf")
          .header(
            "content-disposition",
            attachmentContentDisposition(
              disposition,
              result.attachment.originalFilename,
            ),
          )
          .header("accept-ranges", "bytes")
          .header("content-length", String(result.object.contentLength))
          .header("cache-control", "private, no-store")
          .header("x-content-type-options", "nosniff")
          .header("content-security-policy", "sandbox")
          .send(result.object.stream);
      } catch (error) {
        if (error instanceof AttachmentRangeError) {
          reply.header("content-range", `bytes */${error.sizeBytes}`);
        }
        throw error;
      }
    },
  );

  app.delete(
    "/api/sheets/:sheetId/attachments/:attachmentId",
    { preHandler: writeGuards },
    async (request) => {
      const { sheetId, attachmentId } = sheetAttachmentIdParamsSchema.parse(
        request.params,
      );
      const result = await attachments.remove(
        request.authSession!.user,
        sheetId,
        attachmentId,
        idempotencyKey(request),
        securityContext(request),
      );
      if (!result.replayed) {
        await realtime.publish(sheetId, "sheet.attachment.changed");
      }
      return { result };
    },
  );
}
