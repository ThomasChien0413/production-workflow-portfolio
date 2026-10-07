export class AuthenticationError extends Error {
  readonly statusCode = 401;

  constructor(message = "帳號或密碼錯誤") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  readonly statusCode = 403;

  constructor(message = "您沒有執行此操作的權限") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class ResourceNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message = "找不到指定的資料") {
    super(message);
    this.name = "ResourceNotFoundError";
  }
}

export class ConflictError extends Error {
  readonly statusCode = 409;

  constructor(message = "資料已被其他操作更新，請重新整理後再試") {
    super(message);
    this.name = "ConflictError";
  }
}

export class SheetConflictError extends Error {
  readonly statusCode = 409;

  constructor(
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SheetConflictError";
  }
}

export class ExternalServiceError extends Error {
  readonly statusCode = 502;

  constructor(message = "外部服務暫時無法使用") {
    super(message);
    this.name = "ExternalServiceError";
  }
}

export class ServiceUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(message = "服務尚未完成設定") {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}
