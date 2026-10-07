/**
 * A read against the API that could not be completed.
 *
 * In its own module because both `lib/api.ts` and `lib/session.ts` throw it,
 * and `lib/api.ts` takes the API origin from `lib/session.ts` — importing the
 * error from there instead would make the two modules circular.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly path: string,
    /** Null when the request never got a response at all. */
    readonly status: number | null,
    cause?: unknown,
  ) {
    super(
      status === null
        ? `無法連線到伺服器（${path}）`
        : `伺服器回應 ${status}（${path}）`,
      { cause },
    );
    this.name = "ApiRequestError";
  }
}
