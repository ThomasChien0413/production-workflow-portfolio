import { describe, expect, it } from "vitest";
import { cutPatrolInspectionV1, stampingProductDemandV1 } from "@workflow/contracts";
import { fieldRules, initialValues, validateFieldValue } from "./values.js";

describe("a box with a line to write on", () => {
  const rules = fieldRules(stampingProductDemandV1);
  const key = "demands.0.delivery";
  const rule = rules.get(key)!;

  it("takes a box, or 其他 with what was written after it", () => {
    for (const value of ["", "庫存", "其他", "其他：2/23"]) {
      expect(() => validateFieldValue(key, rule, value)).not.toThrow();
    }
  });

  it("refuses anything the boxes cannot show", () => {
    for (const value of ["2/23", "庫存：2/23", "外購"]) {
      expect(() => validateFieldValue(key, rule, value)).toThrow(/只能勾選/);
    }
  });
});

describe("首件/巡迴檢驗單's printed matrices", () => {
  const rules = fieldRules(cutPatrolInspectionV1);

  it("writes a row ticked across several columns in its first alone", () => {
    expect(rules.has("firstPiece.crack.standard")).toBe(true);
    expect(rules.has("firstPiece.crack.reading1")).toBe(false);
    expect(rules.has("firstPiece.crack.reading3")).toBe(false);
    expect(rules.has("firstPiece.crack.verdict")).toBe(true);
    expect(rules.has("firstPiece.a.reading2")).toBe(true);
  });

  it("holds ✓ or ✗ in 判定 whatever the row, and 有 or 無 across the readings", () => {
    const verdict = rules.get("firstPiece.a.verdict")!;
    expect(() => validateFieldValue("firstPiece.a.verdict", verdict, "✓")).not.toThrow();
    expect(() => validateFieldValue("firstPiece.a.verdict", verdict, "OK")).toThrow(/只能勾選/);
    const crack = rules.get("firstPiece.crack.standard")!;
    expect(() => validateFieldValue("firstPiece.crack.standard", crack, "有")).not.toThrow();
    expect(() => validateFieldValue("firstPiece.crack.standard", crack, "0.5")).toThrow(/只能勾選/);
    // A plain reading is text.
    expect(() => validateFieldValue("firstPiece.a.reading1", rules.get("firstPiece.a.reading1")!, "0.51")).not.toThrow();
  });

  it("writes each round's time, the drawing's 類型 and 鋼捲號", () => {
    for (const part of ["day", "hour", "minute"]) {
      expect(rules.has(`rounds.checkedAt.round6.${part}`)).toBe(true);
    }
    expect(rules.get("coreType")?.choices).toEqual(["C型", "環型"]);
    expect(rules.has("coilNumbers")).toBe(true);
    expect(rules.get("rounds.verdict.round1")?.choices).toEqual(["NG", "OK"]);
  });

  it("starts every one of them empty", () => {
    const values = initialValues(cutPatrolInspectionV1) as Record<string, Record<string, Record<string, unknown>>>;
    expect(values.rounds!.checkedAt!.round1).toEqual({ day: "", hour: "", minute: "" });
    expect(values.coreType).toBe("");
    expect(values.coilNumbers).toBe("");
  });
});
