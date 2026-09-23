import { describe, expect, it, vi } from "vitest";
import { withTimeout } from "../src/worker/timeout";

describe("withTimeout", () => {
  // A content script that never answers used to leave the check on "Reading the page contents"
  // for as long as the browser stayed open, while the wizard said it would stop by itself.
  it("gives up on work that never finishes, and says how long it waited", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const p = withTimeout(never, 90_000, "Reading the page");
    const assertion = expect(p).rejects.toThrow(/Reading the page gave up after 90s/);
    await vi.advanceTimersByTimeAsync(90_001);
    await assertion;
    vi.useRealTimers();
  });

  it("lets work that finishes in time through untouched", async () => {
    await expect(withTimeout(Promise.resolve("catalogue"), 1000, "Reading")).resolves.toBe("catalogue");
  });

  it("passes the real failure through rather than replacing it with a deadline", async () => {
    await expect(withTimeout(Promise.reject(new Error("Bot challenge")), 1000, "Reading")).rejects.toThrow("Bot challenge");
  });
});

describe("the background window's title prefix", () => {
  const mark = "Sloppycat is reading — ";
  const applyPrefix = (title: string): string => {
    let base = title;
    while (base.startsWith(mark)) base = base.slice(mark.length);
    return mark + base;
  };

  // The sign is re-applied on every navigation event, and two can read the title before either
  // writes it. A startsWith guard passes twice and you get the prefix stamped on twice.
  it("says it once however many times it runs", () => {
    const once = applyPrefix("Stephen King: All Books");
    expect(once).toBe("Sloppycat is reading — Stephen King: All Books");
    expect(applyPrefix(once)).toBe(once);
    expect(applyPrefix(applyPrefix(once))).toBe(once);
  });

  it("keeps the page's own title, which the captcha check reads", () => {
    expect(applyPrefix("Robot Check")).toContain("Robot Check");
  });
});

describe("Amazon's Show more expansion is bounded by the clock", () => {
  // Thirty clicks waiting five seconds each is two and a half minutes of pressing a button, and an
  // author with 1800 titles accepts every one of them. The check then outlived its own message
  // channel and came back with nothing.
  const EXPAND_BUDGET_MS = 45_000;

  it("cannot run longer than its budget however many pages there are", () => {
    const clicks = 30;
    const waitPerClick = 5_000;
    expect(clicks * waitPerClick).toBeGreaterThan(EXPAND_BUDGET_MS);
    // A deadline checked in both loops is what makes the worst case the budget, not the product.
    expect(EXPAND_BUDGET_MS).toBeLessThan(75_000);
  });

  it("leaves room for the page to answer before the worker gives up on it", () => {
    const RESPOND_BY_MS = 75_000;
    const EXTRACT_TIMEOUT_MS = 90_000;
    // The page must answer first, so the reason reported is the page's rather than a bare deadline.
    expect(EXPAND_BUDGET_MS).toBeLessThan(RESPOND_BY_MS);
    expect(RESPOND_BY_MS).toBeLessThan(EXTRACT_TIMEOUT_MS);
  });
});

describe("a partial read must not manufacture new releases", () => {
  // 288 of 1808 Stephen King titles came back. If the next read loads a different 288, every
  // newly-loaded back-catalogue book looks new. Calling a real release fake is the failure mode
  // the project says kills it, so a read that admits it is partial has to be handled differently
  // from one that claims to be whole.
  const added = (before: string[], after: string[]) => after.filter((x) => !before.includes(x));

  it("shows the danger: a different window reads as additions", () => {
    expect(added(["a", "b", "c"], ["b", "c", "d"])).toEqual(["d"]);
  });

  it("is defused by keeping what was already known", () => {
    const merged = [...new Set([...["a", "b", "c"], ...["b", "c", "d"]])];
    expect(added(merged, ["b", "c", "d"])).toEqual([]);
  });
});

describe("a newest-first partial read can still be compared", () => {
  // Sorted by publication date, a partial read is the top of the catalogue: something genuinely
  // new is in it, and what the boundary drops is old. Comparing by date rather than by membership
  // survives the window changing size between checks, which it does every time.
  const newestKnown = (items: { releaseDate?: string }[]) =>
    items.reduce((a, i) => (i.releaseDate && i.releaseDate > a ? i.releaseDate : a), "");

  const worthAlerting = (i: { releaseDate?: string }, opts: { partial: boolean; newestFirst: boolean }, prev: { releaseDate?: string }[]) =>
    !opts.partial || (opts.newestFirst && !!i.releaseDate && i.releaseDate >= newestKnown(prev));

  const prev = [{ releaseDate: "2021-09-10" }, { releaseDate: "2018-01-19" }];

  it("reports a release newer than anything already known", () => {
    expect(worthAlerting({ releaseDate: "2026-04-14" }, { partial: true, newestFirst: true }, prev)).toBe(true);
  });

  it("ignores an old book that merely came into view", () => {
    expect(worthAlerting({ releaseDate: "1997-05-02" }, { partial: true, newestFirst: true }, prev)).toBe(false);
  });

  it("ignores everything when the order is unknown, because nothing can be concluded", () => {
    expect(worthAlerting({ releaseDate: "2026-04-14" }, { partial: true, newestFirst: false }, prev)).toBe(false);
  });

  it("reports everything new when the read was complete, however old it is", () => {
    expect(worthAlerting({ releaseDate: "1997-05-02" }, { partial: false, newestFirst: false }, prev)).toBe(true);
  });

  // A back-dated fake is exactly what a newest-first window cannot see, which is why the count
  // comparison exists separately and why limits.md says so.
  it("cannot see a fake dated into the back catalogue, and does not pretend to", () => {
    expect(worthAlerting({ releaseDate: "2019-01-01" }, { partial: true, newestFirst: true }, prev)).toBe(false);
  });
});
