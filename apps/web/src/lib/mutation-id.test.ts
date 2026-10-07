import { afterEach, describe, expect, it, vi } from "vitest";
import { newMutationId } from "./mutation-id";

// A UUID as the API accepts it for a clientMutationId.
const uuid = { safeParse: (value: string) => ({ success: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }) };

describe("newMutationId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID where the page has it", () => {
    expect(uuid.safeParse(newMutationId()).success).toBe(true);
  });

  // http://<address>:3000 is not a secure page, so randomUUID is missing there.
  it("builds a version-4 UUID from getRandomValues where randomUUID is missing", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
    const ids = Array.from({ length: 50 }, () => newMutationId());
    for (const id of ids) {
      expect(uuid.safeParse(id).success).toBe(true);
      expect(id[14]).toBe("4");
      expect("89ab").toContain(id[19]!);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});
