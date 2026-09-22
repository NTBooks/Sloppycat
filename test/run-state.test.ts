import { describe, expect, it } from "vitest";
import { isRunning, RUN_STALE_MS, type RunState } from "../src/types";

const at = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();
const run = (extra: Partial<RunState> = {}): RunState => ({ startedAt: at(1000), queue: ["spotify:a"], done: 0, log: [], ...extra });

describe("isRunning", () => {
  it("is true for a run that started recently and has not ended", () => {
    expect(isRunning(run())).toBe(true);
  });

  it("is false once the run says it ended", () => {
    expect(isRunning(run({ endedAt: at(0) }))).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(isRunning(null)).toBe(false);
    expect(isRunning(undefined)).toBe(false);
  });

  // Chrome stops the worker between events. A run it was in the middle of never writes endedAt,
  // and a Check button stuck on "Checking..." forever is worse than one that recovers late.
  it("gives up on a run that has made no progress in too long", () => {
    expect(isRunning(run({ startedAt: at(RUN_STALE_MS + 1000) }))).toBe(false);
    expect(isRunning(run({ startedAt: at(RUN_STALE_MS - 30_000) }))).toBe(true);
  });

  // Staleness is measured from the last step, not the start, so a long run is never timed out by
  // the UI while the worker is still working through it.
  it("stays live through a long run that keeps reporting progress", () => {
    const long = run({ startedAt: at(4 * RUN_STALE_MS), beatAt: at(10_000) });
    expect(isRunning(long)).toBe(true);
  });

  it("goes stale once the steps stop, however recently the run started", () => {
    const dead = run({ startedAt: at(RUN_STALE_MS - 1000), beatAt: at(RUN_STALE_MS + 1000) });
    expect(isRunning(dead)).toBe(false);
  });
});
