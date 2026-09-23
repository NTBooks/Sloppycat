// The rails around hidden-tab rendering. Kept out of the service worker so they can be tested:
// getting either of these wrong is what turns one check into a stream of page loads.

/**
 * Page loads a single profile can justify in one run: an Amazon snapshot and its bio page are two,
 * a lookalike search is a third, and the fourth is slack. Anything past that for the profiles
 * actually queued is not the run doing its job.
 */
export const RENDERS_PER_PROFILE = 4;
export const RUN_SLACK = 10;

/**
 * Page loads allowed outside a run, where the trigger is a page the user opened rather than the
 * schedule. This is the path a render loop comes back through, so it is kept tight.
 */
export const ADHOC_LIMIT = 10;
export const ADHOC_WINDOW_MS = 5 * 60 * 1000;

/**
 * A ceiling on page loads, so no bug above this line can turn into a stream of them.
 *
 * A run gets an allowance sized to the work it actually has: a plain count, not a rate, because a
 * big catalogue legitimately takes longer than any window worth setting, and a run that gets slower
 * is not a run that has gone wrong. Between runs the rate limit applies instead.
 */
export class RenderBudget {
  private times: number[] = [];
  private runLeft: number | null = null;

  constructor(
    private readonly adhocLimit = ADHOC_LIMIT,
    private readonly adhocWindowMs = ADHOC_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Open an allowance for a run over this many profiles. */
  startRun(profiles: number): void {
    this.runLeft = profiles * RENDERS_PER_PROFILE + RUN_SLACK;
  }

  endRun(): void {
    this.runLeft = null;
  }

  /** Record one page load, or throw if that would go over the ceiling. */
  spend(): void {
    if (this.runLeft !== null) {
      if (this.runLeft <= 0) {
        throw new Error(
          "Sloppycat stopped this check after more page loads than the profiles it was checking can account for. Nothing further was opened.",
        );
      }
      this.runLeft--;
      return;
    }
    const t = this.now();
    this.times = this.times.filter((x) => t - x < this.adhocWindowMs);
    if (this.times.length >= this.adhocLimit) {
      throw new Error(
        `Sloppycat stopped after ${this.adhocLimit} page loads in ${Math.round(this.adhocWindowMs / 60000)} minutes outside a scheduled check. Nothing further was opened.`,
      );
    }
    this.times.push(t);
  }

  /** How many are left. For tests, and for saying so when something asks. */
  remaining(): number {
    if (this.runLeft !== null) return this.runLeft;
    const t = this.now();
    return Math.max(0, this.adhocLimit - this.times.filter((x) => t - x < this.adhocWindowMs).length);
  }
}

/**
 * True for the errors Chrome raises once the tab or window went away under us. These are the user
 * closing the background window, not anything wrong with the profile being checked.
 */
export function isGone(e: unknown): boolean {
  return /No tab with id|No window with id|tab was closed|Tab not found|Frame with id|The tab was closed/i.test(
    e instanceof Error ? e.message : String(e),
  );
}

export const RENDER_CLOSED =
  "The background window Sloppycat reads pages in was closed mid-check. Nothing is wrong with the profile; the next check will try again.";

/**
 * Marks a Spotify page as one the extension opened for itself, as the URL fragment. The capture
 * script only keeps the page's request headers, which carry its short-lived login tokens, on a page
 * loaded with this, so a Spotify tab the user opened never has them copied anywhere outside Spotify's
 * own code. A fragment never reaches the server.
 */
export const OWN_PAGE_MARK = "sloppycat-read";
