import { describe, expect, it } from "vitest";
import { customLoginName } from "./login-name";

describe("name-first login presentation", () => {
  it.each(["王小明", "Alex Example", "José"])("does not repeat a default real name %s", (name) => {
    expect(customLoginName({ username: name.toLowerCase(), displayName: name })).toBeNull();
  });
  it("compares surrounding whitespace and canonical Unicode consistently", () => {
    expect(customLoginName({ username: "josé", displayName: " Jose\u0301 " })).toBeNull();
  });
  it("keeps a chosen alias and the admin login visible", () => {
    expect(customLoginName({ username: "王小明-二", displayName: "王小明" })).toBe("王小明-二");
    expect(customLoginName({ username: "admin", displayName: "系統管理員" })).toBe("admin");
  });
});
