import { describe, expect, it } from "vitest";
import { ADHOC_LIMIT, isGone, RenderBudget, RENDERS_PER_PROFILE, RUN_SLACK } from "../src/render-guard";
import { looksLikeAmazonChallenge } from "../src/adapters/shared";

describe("RenderBudget during a run", () => {
  // The whole point of sizing the allowance to the queue: a scheduled check must never be cut
  // short for doing exactly what it was asked to do, however many profiles that is.
  it("covers the worst honest case for every profile queued", () => {
    for (const profiles of [1, 3, 20]) {
      const b = new RenderBudget();
      b.startRun(profiles);
      // Amazon snapshot + bio page + a lookalike search, for every profile, with slack to spare.
      for (let i = 0; i < profiles * 3; i++) b.spend();
      expect(b.remaining()).toBeGreaterThanOrEqual(RUN_SLACK);
    }
  });

  it("is a count, not a rate, so a slow run is never mistaken for a loop", () => {
    let now = 0;
    const b = new RenderBudget(ADHOC_LIMIT, 1000, () => now);
    b.startRun(2);
    for (let i = 0; i < 2 * RENDERS_PER_PROFILE + RUN_SLACK; i++) {
      now += 60_000; // an hour of very slow page loads changes nothing
      b.spend();
    }
    expect(() => b.spend()).toThrow(/more page loads than the profiles/);
  });

  it("goes back to the standing limit once the run ends", () => {
    const b = new RenderBudget();
    b.startRun(5);
    b.spend();
    b.endRun();
    expect(b.remaining()).toBe(ADHOC_LIMIT);
  });
});

describe("RenderBudget outside a run", () => {
  // Claim checks fire from pages the user opens, which is the path a render loop comes back
  // through, so this one is a rate and it is tight.
  it("stops a loop instead of letting it keep opening pages", () => {
    const b = new RenderBudget(3, 60_000, () => 1000);
    b.spend();
    b.spend();
    b.spend();
    expect(() => b.spend()).toThrow(/stopped after 3 page loads/);
  });

  it("forgets page loads once they fall out of the window", () => {
    let now = 0;
    const b = new RenderBudget(2, 1000, () => now);
    b.spend();
    b.spend();
    expect(() => b.spend()).toThrow();
    now = 1500;
    expect(() => b.spend()).not.toThrow();
  });
});

describe("isGone", () => {
  it("recognizes the errors Chrome raises for a tab or window that went away", () => {
    expect(isGone(new Error("No tab with id: 345140653"))).toBe(true);
    expect(isGone(new Error("No window with id: 12"))).toBe(true);
    expect(isGone(new Error("The tab was closed."))).toBe(true);
    expect(isGone("Frame with id 0 was removed")).toBe(true);
  });

  it("leaves real failures alone, so a broken profile is not mistaken for a closed tab", () => {
    expect(isGone(new Error("HTTP 503"))).toBe(false);
    expect(isGone(new Error("Bot challenge at https://www.amazon.com/stores/author/B0/allbooks"))).toBe(false);
    expect(isGone(undefined)).toBe(false);
  });
});

describe("the background window's sign does not blind the challenge check", () => {
  // The window prefixes the page title to say whose window it is. Amazon serves a captcha as
  // "Robot Check", and matching that title too strictly would turn a challenge into a silent
  // empty catalogue, which is the one failure mode nobody would notice.
  it("still recognises a Robot Check page once the title is prefixed", () => {
    const captcha = "<html><head><title>Sloppycat is reading — Robot Check</title></head><body></body></html>";
    expect(looksLikeAmazonChallenge(captcha)).toBe(true);
  });

  it("recognises the untouched page as before", () => {
    expect(looksLikeAmazonChallenge("<html><head><title>Robot Check</title></head></html>")).toBe(true);
  });

  it("does not call an ordinary page a challenge", () => {
    expect(looksLikeAmazonChallenge("<html><head><title>Sloppycat is reading — Jane Doe: Books</title></head></html>")).toBe(false);
  });
});
