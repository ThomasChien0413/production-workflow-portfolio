import { describe, expect, it } from "vitest";
import {
  asCalendarDate,
  formatTaipeiDateTime,
  taipeiDayEnd,
  taipeiDayStart,
  taipeiDaysBefore,
  taipeiToday,
} from "./taipei";

describe("asCalendarDate", () => {
  it("accepts a real day", () => {
    expect(asCalendarDate("2026-08-11")).toBe("2026-08-11");
  });

  it("rejects a day that does not exist", () => {
    // The shape is right, which is exactly why this needs checking.
    expect(asCalendarDate("2026-02-31")).toBeUndefined();
  });

  it("rejects anything that is not a bare date", () => {
    expect(asCalendarDate("2026-08-11T00:00:00Z")).toBeUndefined();
    expect(asCalendarDate("yesterday")).toBeUndefined();
    expect(asCalendarDate("")).toBeUndefined();
    expect(asCalendarDate(undefined)).toBeUndefined();
  });
});

describe("day boundaries", () => {
  it("anchors both ends to Taipei, not to the running machine", () => {
    expect(taipeiDayStart("2026-08-11")).toBe("2026-08-11T00:00:00.000+08:00");
    expect(taipeiDayEnd("2026-08-11")).toBe("2026-08-11T23:59:59.999+08:00");
  });

  it("puts the end of one day before the start of the next", () => {
    // The bug this guards against is an end boundary at the following
    // midnight, which the API's inclusive comparison would count twice.
    expect(Date.parse(taipeiDayEnd("2026-08-11"))).toBeLessThan(
      Date.parse(taipeiDayStart("2026-08-12")),
    );
  });

  it("covers a full 24 hours less one millisecond", () => {
    const span =
      Date.parse(taipeiDayEnd("2026-08-11")) - Date.parse(taipeiDayStart("2026-08-11"));
    expect(span).toBe(86_400_000 - 1);
  });
});

describe("taipeiToday", () => {
  it("reads the Taipei calendar, not UTC", () => {
    // 16:30 UTC is already past midnight in Taipei, so the two disagree —
    // which is the whole reason this helper exists.
    const evening = new Date("2026-08-11T16:30:00.000Z");
    expect(taipeiToday(evening)).toBe("2026-08-12");
    expect(evening.toISOString().slice(0, 10)).toBe("2026-08-11");
  });

  it("keeps the same day when the two agree", () => {
    expect(taipeiToday(new Date("2026-08-11T02:00:00.000Z"))).toBe("2026-08-11");
  });
});

describe("taipeiDaysBefore", () => {
  it("counts the given day as one of them", () => {
    // 近 7 天 ending on the 11th means the 5th through the 11th.
    expect(taipeiDaysBefore("2026-08-11", 7)).toBe("2026-08-05");
    expect(taipeiDaysBefore("2026-08-11", 1)).toBe("2026-08-11");
  });

  it("crosses a month boundary", () => {
    expect(taipeiDaysBefore("2026-03-02", 30)).toBe("2026-02-01");
  });
});

describe("formatTaipeiDateTime", () => {
  it("formats in Taipei with ordinary spaces only, so server and browser agree", () => {
    const text = formatTaipeiDateTime("2026-10-01T02:37:00.000Z");
    expect(text).toBe("2026/10/1 上午10:37");
    expect(text).not.toMatch(/[   ]/);
    expect(formatTaipeiDateTime(new Date("2026-10-01T02:37:00.000Z"))).toBe(text);
  });

  it("shows a dash for no time", () => {
    expect(formatTaipeiDateTime(null)).toBe("—");
  });
});
