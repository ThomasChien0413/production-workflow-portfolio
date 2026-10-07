import { describe, expect, it } from "vitest";
import { parseJsonRequestBody } from "./app.js";

describe("API JSON request parsing", () => {
  it("parses a valid JSON request body", () => {
    expect(parseJsonRequestBody(Buffer.from('{"name":"分條"}', "utf8"))).toEqual({
      name: "分條",
    });
  });

  it("classifies malformed JSON as a client error", () => {
    expect.assertions(3);
    try {
      parseJsonRequestBody(Buffer.from("{", "utf8"));
    } catch (error) {
      expect(error).toBeInstanceOf(SyntaxError);
      expect(error).toMatchObject({
        statusCode: 400,
        code: "FST_ERR_CTP_INVALID_JSON_BODY",
      });
      expect(String(error)).not.toContain("node_modules");
    }
  });
});
