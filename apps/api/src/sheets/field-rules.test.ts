import { describe, expect, it } from "vitest";
import {
  cutCharacteristicInspectionV1,
  cutCustomerOrderShihlinV1,
  cutDailyReportV1,
  cutFinishedInspectionV1,
  cutProcessingOrderV1,
} from "@workflow/contracts";
import { fieldRules } from "./values.js";

/**
 * A field key absent from fieldRules is refused by patchValues. These pin
 * that nothing a sheet can never show is writable: a value stored under
 * printed text, a computed cell, a spacer or a covered cell would be data
 * no screen or PDF displays.
 */
describe("writable field keys", () => {
  it("leaves printed text out, and keeps the boxes beside it", () => {
    const rules = fieldRules(cutFinishedInspectionV1);
    // 檢查工具 is printed with its answer, 游標卡尺.
    expect(rules.has("toolLabel")).toBe(false);
    expect(rules.has("tool")).toBe(false);
    expect(rules.has("reviewer")).toBe(true);
    expect(rules.has("verdict")).toBe(true);

    const order = fieldRules(cutProcessingOrderV1);
    // 加工製令單 prints KG and 製令單交給生產部 in cells of their own.
    expect(order.has("unitWeightUnit")).toBe(false);
    expect(order.has("productionHandoverNote")).toBe(false);
  });

  it("leaves 士電's computed 總重 and its spacer out of every row", () => {
    const rules = fieldRules(cutCustomerOrderShihlinV1);
    for (const row of [0, 5]) {
      expect(rules.has(`orders.${row}.totalWeight`)).toBe(false);
      expect(rules.has(`orders.${row}.weightGap`)).toBe(false);
      // 總重's factors stay writable.
      expect(rules.has(`orders.${row}.quantity`)).toBe(true);
      expect(rules.has(`orders.${row}.unitWeight`)).toBe(true);
    }
  });

  it("still leaves covered cells out", () => {
    const team = fieldRules(cutDailyReportV1);
    expect(team.has("entries.0.name")).toBe(true);
    expect(team.has("entries.1.name")).toBe(false);
    const characteristic = fieldRules(cutCharacteristicInspectionV1);
    expect(characteristic.has("tests.0.sample")).toBe(false);
    expect(characteristic.has("tests.0.a")).toBe(true);
    expect(characteristic.has("tests.1.sample")).toBe(true);
  });
});
