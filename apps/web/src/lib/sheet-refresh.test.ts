import { afterEach, describe, expect, it, vi } from "vitest";
import { SheetRefreshCoordinator } from "./sheet-refresh.js";

/**
 * Past the 75 ms debounce and nowhere near the two-second release. Draining
 * every timer instead would settle the coordinator on the watchdog's behalf,
 * so a test claiming "a refresh is still in flight" would be describing a
 * coordinator that had already finished.
 */
const DEBOUNCE = 100;

describe("SheetRefreshCoordinator", () => {
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("coalesces simultaneous mutation and realtime refresh requests", () => {
    vi.useFakeTimers();
    const coordinator = new SheetRefreshCoordinator();
    const first = vi.fn();
    const latest = vi.fn();

    coordinator.schedule(first);
    coordinator.schedule(latest);
    vi.advanceTimersByTime(DEBOUNCE);

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("does not overlap a refresh requested while a transition is active", () => {
    vi.useFakeTimers();
    const coordinator = new SheetRefreshCoordinator();
    const first = vi.fn();
    const trailing = vi.fn();

    coordinator.schedule(first);
    vi.advanceTimersByTime(DEBOUNCE);
    coordinator.schedule(trailing);
    vi.advanceTimersByTime(DEBOUNCE);

    expect(first).toHaveBeenCalledTimes(1);
    expect(trailing).not.toHaveBeenCalled();

    coordinator.settle();
    vi.advanceTimersByTime(DEBOUNCE);

    expect(trailing).toHaveBeenCalledTimes(1);
  });

  it("coalesces multiple in-flight notifications into one trailing refresh", () => {
    vi.useFakeTimers();
    const coordinator = new SheetRefreshCoordinator();
    const first = vi.fn();
    const superseded = vi.fn();
    const latest = vi.fn();

    coordinator.schedule(first);
    vi.advanceTimersByTime(DEBOUNCE);
    coordinator.schedule(superseded);
    coordinator.schedule(latest);
    coordinator.settle();
    vi.advanceTimersByTime(DEBOUNCE);

    expect(superseded).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("releases a refresh that never reports settling", () => {
    vi.useFakeTimers();
    const coordinator = new SheetRefreshCoordinator();
    const first = vi.fn();
    const later = vi.fn();

    coordinator.schedule(first);
    vi.advanceTimersByTime(DEBOUNCE);
    expect(first).toHaveBeenCalledTimes(1);

    // The provider never calls settle(). Without a release the coordinator
    // stays active forever and every later structural change is queued behind
    // a refresh that already finished — the page silently stops updating.
    coordinator.schedule(later);
    vi.advanceTimersByTime(30_000);

    expect(later).toHaveBeenCalledTimes(1);
  });

  it("allows a later structural change after the prior refresh settles", () => {
    vi.useFakeTimers();
    const coordinator = new SheetRefreshCoordinator();
    const refresh = vi.fn();

    coordinator.schedule(refresh);
    vi.advanceTimersByTime(DEBOUNCE);
    coordinator.settle();
    coordinator.schedule(refresh);
    vi.advanceTimersByTime(DEBOUNCE);

    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
