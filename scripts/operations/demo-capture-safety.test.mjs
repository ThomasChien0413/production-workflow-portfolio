import assert from "node:assert/strict";
import { test } from "node:test";
import { containsOnlyBlankValues } from "../demo/capture-safety.mjs";

test("portfolio recapture accepts nested canonical blanks but no saved text/numbers/decisions", () => {
  assert.equal(containsOnlyBlankValues({ date: null, rows: [{ specification: "", quantity: "" }] }), true);
  for (const value of [{ text: "saved" }, { rows: [{ quantity: 0 }] }, { decision: true }, { text: " " }]) {
    assert.equal(containsOnlyBlankValues(value), false);
  }
});
