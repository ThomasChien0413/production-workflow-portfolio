/**
 * Calendar dates in Taipei, and the instants they begin and end at.
 *
 * The operator picks a day; the API filters on an instant (`AuditListQuery`
 * takes ISO datetimes with an offset). Converting between the two is where the
 * quiet bugs live, so it happens here and nowhere else.
 *
 * `new Date("2026-08-11").toISOString()` is the wrong answer twice over: it
 * reads the date as UTC midnight, and anything derived from the browser clock
 * uses whatever zone that machine is set to. A manager checking the London
 * office's laptop would then get a range shifted by eight hours and quietly
 * miss the first shift of the day. Every boundary here is anchored to Taipei
 * regardless of where the code runs.
 */

/**
 * Taiwan has not observed daylight saving since 1979, so the offset is a
 * constant rather than something to look up per date. If that ever changes,
 * this is the one place that has to know.
 */
export const TAIPEI_OFFSET = "+08:00";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM-DD` string that names a day that exists, or undefined.
 *
 * The shape check alone would accept 2026-02-31, and parsing does not reject
 * it either — V8 rolls it forward to 3 March and reports a valid date. So the
 * day has to survive a round trip: parse it, ask the Taipei calendar what day
 * that instant is, and require the same answer back.
 */
export function asCalendarDate(value: string | undefined): string | undefined {
  if (!value || !DATE_ONLY.test(value)) return undefined;
  const instant = Date.parse(`${value}T12:00:00${TAIPEI_OFFSET}`);
  if (Number.isNaN(instant)) return undefined;
  return taipeiToday(new Date(instant)) === value ? value : undefined;
}

/** The first instant of that Taipei day. */
export function taipeiDayStart(date: string): string {
  return `${date}T00:00:00.000${TAIPEI_OFFSET}`;
}

/**
 * The last instant of that Taipei day.
 *
 * The API compares with `<=`, so the end has to be inside the day rather than
 * at the next midnight — otherwise a range ending on the 10th would also
 * return an event stamped exactly 00:00:00 on the 11th, and two adjacent
 * ranges would both claim it. Sub-millisecond stamps are outside this, which
 * is the deliberate trade: never claiming a foreign day matters more.
 */
export function taipeiDayEnd(date: string): string {
  return `${date}T23:59:59.999${TAIPEI_OFFSET}`;
}

/** Today, as the calendar in Taipei has it, whatever zone the clock is in. */
export function taipeiToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is what a date input expects.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** `days` back from `date`, inclusive of `date` itself — 7 days means 7 days. */
export function taipeiDaysBefore(date: string, days: number): string {
  const start = Date.parse(taipeiDayStart(date));
  return taipeiToday(new Date(start - (days - 1) * 86_400_000));
}

const WIDE_OR_NARROW_SPACES = /[\u00a0\u2009\u202f]/g;

/**
 * A date and time in Taipei, short form ("2026/10/1 上午10:37"), the same on
 * the server and in the browser.
 *
 * Node's ICU puts a thin space (U+2009) between the date and 上午 where
 * Chromium puts an ordinary space. The text is the same to a reader, but a
 * client component rendered on the server then fails hydration, and React
 * throws the server's HTML away. Every separator becomes an ordinary space.
 */
export function formatTaipeiDateTime(value: string | Date | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  })
    .format(typeof value === "string" ? new Date(value) : value)
    .replace(WIDE_OR_NARROW_SPACES, " ");
}
