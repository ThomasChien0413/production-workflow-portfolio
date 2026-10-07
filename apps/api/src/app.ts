import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import websocket from "@fastify/websocket";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { createDatabase } from "@workflow/database";
import { registerAuditRoutes } from "./audit/routes.js";
import { AuditService } from "./audit/service.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { AdminUserService } from "./admin/service.js";
import { registerNotificationRoutes } from "./notifications/routes.js";
import { NotificationService } from "./notifications/service.js";
import { registerPushRoutes } from "./push/routes.js";
import { PushService } from "./push/service.js";
import { registerTemplateRoutes } from "./templates/routes.js";
import { TemplateService } from "./templates/service.js";
import { registerSheetRoutes } from "./sheets/routes.js";
import { SheetRealtimeHub } from "./sheets/realtime.js";
import { SheetService } from "./sheets/service.js";
import { DepartmentSubpageService } from "./subpages/service.js";
import { registerDepartmentSubpageRoutes } from "./subpages/routes.js";
import {
  PlaywrightSheetPdfRenderer,
  type SheetPdfRenderer,
} from "./sheets/pdf.js";
import { registerAuthRoutes } from "./auth/routes.js";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ExternalServiceError,
  ResourceNotFoundError,
  ServiceUnavailableError,
  SheetConflictError,
} from "./auth/errors.js";
import { AuthService } from "./auth/service.js";
import type { ApiConfig } from "./config.js";
import { safeRequestPath } from "./request-logging.js";
import {
  FileAttachmentStorage,
  S3AttachmentStorage,
  type AttachmentStorage,
} from "@workflow/attachment-storage";
import { registerSheetAttachmentRoutes } from "./attachments/routes.js";
import {
  AttachmentCapacity,
  SheetAttachmentService,
} from "./attachments/service.js";

function isHttpError(
  error: unknown,
): error is { statusCode: number; code?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  );
}

export class InvalidJsonBodyError extends SyntaxError {
  readonly statusCode = 400;
  readonly code = "FST_ERR_CTP_INVALID_JSON_BODY";

  constructor() {
    super("Invalid JSON request body");
    this.name = "InvalidJsonBodyError";
  }
}

export function parseJsonRequestBody(body: string | Buffer): unknown {
  try {
    return JSON.parse(typeof body === "string" ? body : body.toString("utf8"));
  } catch {
    throw new InvalidJsonBodyError();
  }
}

export type AppDependencies = {
  pdfRenderer?: SheetPdfRenderer;
  attachmentStorage?: AttachmentStorage;
};

export async function buildApp(
  config: ApiConfig,
  dependencies: AppDependencies = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: config.nodeEnv === "test" ? "silent" : "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.body.password",
          "req.body.currentPassword",
          "req.body.newPassword",
        ],
        censor: "[REDACTED]",
      },
    },
    trustProxy: config.nodeEnv === "production",
  });
  const connection = createDatabase(config.databaseUrl);
  const authService = new AuthService(connection.db, config);
  const adminUserService = new AdminUserService(connection.db);
  const auditService = new AuditService(connection.db);
  const notificationService = new NotificationService(connection.db);
  const pushService = new PushService(connection.db);
  const templateService = new TemplateService(connection.db);
  const sheetService = new SheetService(connection.db);
  const departmentSubpageService = new DepartmentSubpageService(connection.db);
  const pdfRenderer = dependencies.pdfRenderer ?? new PlaywrightSheetPdfRenderer();
  const attachmentStorage =
    dependencies.attachmentStorage ??
    (config.attachmentStorageDriver === "s3"
      ? new S3AttachmentStorage(config.awsRegion!, config.attachmentS3Bucket!)
      : new FileAttachmentStorage(config.attachmentLocalDirectory));
  const attachmentService = new SheetAttachmentService(
    connection.db,
    sheetService,
    attachmentStorage,
    config.attachmentS3Prefix,
    new AttachmentCapacity(config.attachmentUploadConcurrency),
  );
  const sheetRealtimeHub = new SheetRealtimeHub(
    authService,
    sheetService,
    config,
  );

  app.decorateRequest("authSession", null);
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_request, body, done) => {
      try {
        done(null, parseJsonRequestBody(body));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );
  await app.register(sensible);
  await app.register(cookie);
  await app.register(cors, {
    origin: config.appOrigin,
    credentials: true,
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(multipart, {
    limits: {
      files: 2,
      fields: 0,
      fileSize: config.attachmentMaxBytes,
    },
    throwFileSizeLimit: true,
  });
  await app.register(rateLimit, { global: false });
  await app.register(websocket);

  app.addHook("onRequest", async (request, reply) => {
    const unsafeMethod = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const origin = request.headers.origin;
    if (unsafeMethod && origin && origin.replace(/\/$/, "") !== config.appOrigin) {
      return reply.forbidden("不允許的請求來源");
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        path: safeRequestPath(request.url),
        statusCode: reply.statusCode,
      },
      "Request completed",
    );
  });

  app.get("/api/health", async () => {
    await connection.client`select 1`;
    return {
      status: "ok",
      service: "workflow-api",
      timestamp: new Date().toISOString(),
    };
  });

  sheetRealtimeHub.register(app);

  await registerAuthRoutes(app, authService, config);
  await registerAdminRoutes(app, authService, adminUserService, config);
  await registerAuditRoutes(app, authService, auditService, config);
  await registerNotificationRoutes(
    app,
    authService,
    notificationService,
    config,
  );
  await registerPushRoutes(app, authService, pushService, notificationService, config);
  await registerTemplateRoutes(app, authService, templateService, config);
  await registerDepartmentSubpageRoutes(app, authService, departmentSubpageService, sheetRealtimeHub, config);
  await registerSheetRoutes(
    app,
    authService,
    sheetService,
    sheetRealtimeHub,
    pdfRenderer,
    config,
  );
  await registerSheetAttachmentRoutes(
    app,
    authService,
    attachmentService,
    sheetRealtimeHub,
    config,
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof InvalidJsonBodyError) {
      return reply.code(400).send({
        error: error.code,
        message: "要求內容的 JSON 格式無效",
        requestId: request.id,
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: "輸入資料格式不正確",
        issues: error.issues,
        requestId: request.id,
      });
    }
    if (
      error instanceof AuthenticationError ||
      error instanceof AuthorizationError ||
      error instanceof ConflictError ||
      error instanceof ExternalServiceError ||
      error instanceof ServiceUnavailableError ||
      error instanceof SheetConflictError ||
      error instanceof ResourceNotFoundError
    ) {
      if (error instanceof ServiceUnavailableError) reply.header("retry-after", "5");
      return reply.code(error.statusCode).send({
        error: error.name,
        message: error.message,
        ...(error instanceof SheetConflictError
          ? { details: error.details }
          : {}),
        requestId: request.id,
      });
    }
    if (isHttpError(error) && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: error.code ?? "REQUEST_REJECTED",
        message:
          error.statusCode === 429
            ? "嘗試次數過多，請稍後再試"
            : "此要求無法處理",
        requestId: request.id,
      });
    }

    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: "系統暫時無法處理此要求",
      requestId: request.id,
    });
  });

  app.addHook("onClose", async () => {
    await pdfRenderer.close();
    await connection.close();
  });

  return app;
}
