/** Demo scripts never migrate, seed or inspect a company/remote database. */
export function assertLocalDemoDatabase(
  databaseUrl: string,
  environment = process.env.NODE_ENV,
  readOnly = false,
): void {
  if (environment === "production") throw new Error("Portfolio database scripts refuse production mode");
  let url: URL;
  let databaseName: string;
  try {
    url = new URL(databaseUrl);
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error("A valid local demo PostgreSQL URL is required");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]", "::1", "postgres"].includes(url.hostname)
  ) {
    throw new Error("Portfolio database scripts accept only loopback or the local Compose postgres service");
  }
  if (
    !/^workflow_demo(?:_[a-z0-9_]+)?$/u.test(databaseName) &&
    !(readOnly && /^workflow_restore_rehearsal_[a-z0-9_]+$/u.test(databaseName))
  ) {
    throw new Error("Portfolio database name must be workflow_demo or its explicitly named demo/test variant");
  }
}
