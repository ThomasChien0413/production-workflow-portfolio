import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createSheetRequestSchema,
  departmentSubpageItemParamsSchema,
  departmentSheetHistoryQuerySchema,
  departmentStaffParamsSchema,
  sheetDueDateRequestSchema,
  sheetRowMarkRequestSchema,
  sheetStatusRequestSchema,
  sheetFieldHistoryQuerySchema,
  sheetIdParamsSchema,
  sheetListQuerySchema,
  sheetLifecycleRequestSchema,
  sheetMoveSubpageRequestSchema,
  sheetPatchRequestSchema,
  sheetSubmitRequestSchema,
  sheetApproveRequestSchema,
  sheetRejectRequestSchema,
} from "@workflow/contracts";
import type { ApiConfig } from "../config.js";
import { createAuthGuards } from "../auth/guards.js";
import type { AuthService, RequestSecurityContext } from "../auth/service.js";
import type { SheetRealtimeHub } from "./realtime.js";
import type { SheetService } from "./service.js";
import {
  pdfContentDisposition,
  pdfFilename,
  type SheetPdfRenderer,
} from "./pdf.js";
import { ServiceUnavailableError } from "../auth/errors.js";

function securityContext(request: FastifyRequest): RequestSecurityContext {
  return {
    requestId: request.id,
    ipAddress: request.ip ?? null,
    userAgent: request.headers["user-agent"] ?? null,
  };
}

function isReplayed(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "replayed" in result &&
    result.replayed === true
  );
}

function changedFields(result: unknown): string[] {
  if (
    typeof result !== "object" ||
    result === null ||
    !("changedFields" in result) ||
    !Array.isArray(result.changedFields)
  ) {
    return [];
  }
  return result.changedFields.filter(
    (field): field is string => typeof field === "string",
  );
}

function approvalInvalidated(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "approvalInvalidated" in result &&
    result.approvalInvalidated === true
  );
}

export async function registerSheetRoutes(
  app: FastifyInstance,
  authService: AuthService,
  sheetService: SheetService,
  realtime: SheetRealtimeHub,
  pdfRenderer: SheetPdfRenderer,
  config: ApiConfig,
): Promise<void> {
  const guards = createAuthGuards(authService, config);
  const readGuards = [guards.requireSession];
  const writeGuards = [guards.requireSession, guards.requireCsrf];

  app.get("/api/templates", { preHandler: readGuards }, async (request) => ({
    templates: await sheetService.listAvailableTemplates(request.authSession!.user),
  }));

  app.get("/api/departments/:departmentId/subpages/:subpageId/creation-options", { preHandler: readGuards }, async (request) => {
    const { departmentId, subpageId } = departmentSubpageItemParamsSchema.parse(request.params);
    return { templates: await sheetService.listAvailableTemplates(request.authSession!.user, { departmentId, subpageId }) };
  });

  app.get(
    "/api/departments/:departmentId/staff",
    { preHandler: readGuards },
    async (request) => {
      const { departmentId } = departmentStaffParamsSchema.parse(request.params);
      return {
        staff: await sheetService.listDepartmentStaff(
          request.authSession!.user,
          departmentId,
        ),
      };
    },
  );

  app.get(
    "/api/departments/:departmentId/sheet-history",
    { preHandler: readGuards },
    async (request) => {
      const { departmentId } = departmentStaffParamsSchema.parse(request.params);
      const query = departmentSheetHistoryQuerySchema.parse(request.query);
      return await sheetService.listDepartmentSheetHistory(
        request.authSession!.user,
        departmentId,
        query,
      );
    },
  );

  app.get("/api/sheets", { preHandler: readGuards }, async (request) => {
    const query = sheetListQuerySchema.parse(request.query);
    return {
      sheets: await sheetService.list(request.authSession!.user, {
        state: query.state,
        departmentId: query.departmentId,
        subpageId: query.subpageId,
      }),
    };
  });

  app.post("/api/sheets", { preHandler: writeGuards }, async (request, reply) => {
    const result = await sheetService.create(
      request.authSession!.user,
      createSheetRequestSchema.parse(request.body),
      securityContext(request),
    );
    return reply.code(result.replayed ? 200 : 201).send({ sheet: result });
  });

  app.get("/api/sheets/:sheetId", { preHandler: readGuards }, async (request) => {
    const { sheetId } = sheetIdParamsSchema.parse(request.params);
    return { sheet: await sheetService.detail(request.authSession!.user, sheetId) };
  });

  app.get(
    "/api/sheets/:sheetId/pdf",
    { preHandler: readGuards },
    async (request, reply) => {
      const { sheetId } = sheetIdParamsSchema.parse(request.params);
      const snapshot = await sheetService.pdfSnapshot(
        request.authSession!.user,
        sheetId,
      );
      let pdf: Uint8Array;
      try {
        pdf = await pdfRenderer.render(snapshot);
      } catch (error) {
        if (error instanceof ServiceUnavailableError) reply.header("retry-after", "5");
        throw error;
      }
      await sheetService.recordPdfDownload(
        request.authSession!.user,
        snapshot,
        securityContext(request),
      );
      const filename = pdfFilename(
        snapshot.definition.displayName,
        snapshot.sheetId,
        new Date(),
      );
      return reply
        .header("content-type", "application/pdf")
        .header("content-disposition", pdfContentDisposition(filename, snapshot.sheetId))
        .header("cache-control", "private, no-store")
        .header("content-length", String(pdf.byteLength))
        .send(Buffer.from(pdf));
    },
  );

  app.get(
    "/api/sheets/:sheetId/field-history",
    { preHandler: readGuards },
    async (request) => {
      const { sheetId } = sheetIdParamsSchema.parse(request.params);
      const query = sheetFieldHistoryQuerySchema.parse(request.query);
      return await sheetService.fieldHistory(
        request.authSession!.user,
        sheetId,
        query,
      );
    },
  );

  app.patch("/api/sheets/:sheetId/values", { preHandler: writeGuards }, async (request) => {
    const { sheetId } = sheetIdParamsSchema.parse(request.params);
    const result = await sheetService.patchValues(
      request.authSession!.user,
      sheetId,
      sheetPatchRequestSchema.parse(request.body),
      securityContext(request),
    );
    if (!isReplayed(result)) {
      await realtime.publish(
        sheetId,
        "sheet.patch.applied",
        changedFields(result),
      );
      if (approvalInvalidated(result)) {
        await realtime.publish(sheetId, "sheet.approval.changed");
      }
    }
    return {
      result,
    };
  });

  app.post("/api/sheets/:sheetId/submit", { preHandler: writeGuards }, async (request) => {
    const { sheetId } = sheetIdParamsSchema.parse(request.params);
    const result = await sheetService.submit(
      request.authSession!.user,
      sheetId,
      sheetSubmitRequestSchema.parse(request.body),
      securityContext(request),
    );
    if (!isReplayed(result)) {
      await realtime.publish(sheetId, "sheet.approval.changed");
    }
    return { result };
  });

  // 核准 and 退回 on 分條申請單, the one reviewed form (the user, 2026-10-01).
  app.post("/api/sheets/:sheetId/approve", { preHandler: writeGuards }, async (request) => {
    const { sheetId } = sheetIdParamsSchema.parse(request.params);
    const result = await sheetService.approve(
      request.authSession!.user,
      sheetId,
      sheetApproveRequestSchema.parse(request.body),
      securityContext(request),
    );
    if (!isReplayed(result)) {
      await realtime.publish(sheetId, "sheet.approval.changed");
    }
    return { result };
  });

  app.post("/api/sheets/:sheetId/reject", { preHandler: writeGuards }, async (request) => {
    const { sheetId } = sheetIdParamsSchema.parse(request.params);
    const result = await sheetService.reject(
      request.authSession!.user,
      sheetId,
      sheetRejectRequestSchema.parse(request.body),
      securityContext(request),
    );
    if (!isReplayed(result)) {
      await realtime.publish(sheetId, "sheet.approval.changed");
    }
    return { result };
  });

  // Nothing is assigned any more (the user, 2026-09-30); the 交期 is set on
  // its own by the department's 主管.
  app.post("/api/sheets/:sheetId/due-date", { preHandler: writeGuards }, async (request) => {
    const { sheetId } = sheetIdParamsSchema.parse(request.params);
    const result = await sheetService.setDueDate(
      request.authSession!.user,
      sheetId,
      sheetDueDateRequestSchema.parse(request.body),
      securityContext(request),
    );
    if (!isReplayed(result)) {
      await realtime.publish(sheetId, "sheet.status.changed");
    }
    return { result };
  });

  // 分條's 主管 ticks off 分條申請單's rows once it has arrived and its review
  // is done (the user, 2026-10-03).
  app.post("/api/sheets/:sheetId/row-marks", { preHandler: writeGuards }, async (request) => {
    const { sheetId } = sheetIdParamsSchema.parse(request.params);
    const result = await sheetService.setRowMark(
      request.authSession!.user,
      sheetId,
      sheetRowMarkRequestSchema.parse(request.body),
      securityContext(request),
    );
    if (!isReplayed(result)) {
      await realtime.publish(sheetId, "sheet.status.changed");
    }
    return { result };
  });

  // 待生產, 生產中 and 已完成, set by hand in any order (the user,
  // 2026-09-30); this replaced separate start and complete actions.
  app.post("/api/sheets/:sheetId/status", { preHandler: writeGuards }, async (request) => {
    const { sheetId } = sheetIdParamsSchema.parse(request.params);
    const result = await sheetService.setStatus(
      request.authSession!.user,
      sheetId,
      sheetStatusRequestSchema.parse(request.body),
      securityContext(request),
    );
    if (!isReplayed(result)) {
      await realtime.publish(sheetId, "sheet.status.changed");
    }
    return { result };
  });

  app.post("/api/sheets/:sheetId/subpage", { preHandler: writeGuards }, async (request) => {
    const { sheetId } = sheetIdParamsSchema.parse(request.params);
    const result = await sheetService.moveSubpage(
      request.authSession!.user,
      sheetId,
      sheetMoveSubpageRequestSchema.parse(request.body),
      securityContext(request),
    );
    if (!isReplayed(result)) await realtime.publish(sheetId, "sheet.subpage.changed");
    return { result };
  });

  app.post("/api/sheets/:sheetId/archive", { preHandler: writeGuards }, async (request) => {
    const { sheetId } = sheetIdParamsSchema.parse(request.params);
    const result = await sheetService.archive(
      request.authSession!.user,
      sheetId,
      sheetLifecycleRequestSchema.parse(request.body),
      securityContext(request),
    );
    if (!isReplayed(result)) {
      await realtime.publish(sheetId, "sheet.status.changed");
    }
    return { result };
  });

  // An archived sheet may be deleted at once rather than a year later (the
  // user, 2026-10-04). Nothing is left to broadcast to: open pages find it gone.
  app.post("/api/sheets/:sheetId/delete", { preHandler: writeGuards }, async (request) => {
    const { sheetId } = sheetIdParamsSchema.parse(request.params);
    const result = await sheetService.remove(
      request.authSession!.user,
      sheetId,
      sheetLifecycleRequestSchema.parse(request.body),
      securityContext(request),
    );
    return { result };
  });

  // A finished sheet is archived, not handed on (the user, 2026-10-04); its
  // 主管 may bring an archived one back to its subpage.
  app.post("/api/sheets/:sheetId/restore", { preHandler: writeGuards }, async (request) => {
    const { sheetId } = sheetIdParamsSchema.parse(request.params);
    const result = await sheetService.restore(
      request.authSession!.user,
      sheetId,
      sheetLifecycleRequestSchema.parse(request.body),
      securityContext(request),
    );
    if (!isReplayed(result)) {
      await realtime.publish(sheetId, "sheet.status.changed");
    }
    return { result };
  });
}
