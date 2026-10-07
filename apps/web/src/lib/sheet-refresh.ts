export type SheetRefreshTask = () => void;

const REFRESH_DEBOUNCE_MS = 75;

/**
 * How long a refresh may stay unsettled before it is released anyway.
 *
 * Serialising means the coordinator waits to be told a refresh finished. If
 * that word never comes — a transition that does not resolve, an effect that
 * misses the pending edge, a provider torn down mid-flight — every later
 * structural change queues behind a refresh that is already over, and the page
 * silently stops updating. That is strictly worse than the overlap this class
 * exists to prevent: an overlap shows the wrong state for a moment, a jam shows
 * it until someone reloads. A 分條申請單 sat at 待協理審核 through a whole
 * ten-second assertion after the 協理 had approved it.
 *
 * Generous against a slow refresh — these take a few hundred milliseconds — and
 * short enough that a person watching a status badge sees it correct itself.
 */
const REFRESH_RELEASE_TIMEOUT_MS = 2_000;

/**
 * Serializes structural sheet refreshes for one sheet page.
 *
 * A mutation response and its matching WebSocket event can be separated by
 * more than the debounce window. The first request may therefore already be
 * rendering a new RSC tree when the second arrives. Starting another refresh
 * at that point lets the trees race and can leave React displaying the older
 * sheet state even though both responses contain fresh data.
 *
 * The page provider tells the coordinator when its React transition settles.
 * Requests received meanwhile are folded into one trailing refresh, so a real
 * second structural change is not lost and refreshes never overlap.
 */
export class SheetRefreshCoordinator {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private release: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private trailing = false;
  private latestTask: SheetRefreshTask | undefined;

  schedule(task: SheetRefreshTask): void {
    this.latestTask = task;

    if (this.active) {
      this.trailing = true;
      return;
    }

    this.arm();
  }

  settle(): void {
    // Released here whether the provider reported settling or the
    // watchdog gave up waiting for it.
    if (this.release) clearTimeout(this.release);
    this.release = undefined;
    if (!this.active) return;

    this.active = false;
    if (!this.trailing) return;

    this.trailing = false;
    this.arm();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.release) clearTimeout(this.release);
    this.timer = undefined;
    this.release = undefined;
    this.latestTask = undefined;
    this.active = false;
    this.trailing = false;
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);

    const timer = setTimeout(() => {
      if (this.timer !== timer) return;

      this.timer = undefined;
      const task = this.latestTask;
      this.latestTask = undefined;
      if (!task) return;

      this.active = true;
      this.release = setTimeout(() => {
        this.release = undefined;
        this.settle();
      }, REFRESH_RELEASE_TIMEOUT_MS);
      task();
    }, REFRESH_DEBOUNCE_MS);

    this.timer = timer;
  }
}
