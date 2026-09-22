import { describe, expect, it } from "vitest";
import { isCompanionTitle, isLookalike, similarity, DEFAULT_LOOKALIKE_THRESHOLD } from "../src/lookalike";
import { describeSignal } from "../src/signals";

describe("companion titles the blended score cannot reach", () => {
  // The case from a real alert list: a one-word title scores 0.80, just under the threshold,
  // for exactly the padding the threshold is supposed to catch.
  it("catches a summary edition of a one-word title, which used to slip through", () => {
    expect(similarity("Texis: Summary & Analysis", "Texis")).toBeLessThan(DEFAULT_LOOKALIKE_THRESHOLD);
    expect(isLookalike("Texis: Summary & Analysis", "Texis")).toBe(true);
  });

  it("catches the usual variations on the pattern", () => {
    for (const t of [
      "Texis - Study Guide",
      "Workbook for Texis",
      "Texis: Key Insights and Analysis",
      "Texis Summary",
    ]) {
      expect(isCompanionTitle(t, "Texis"), t).toBe(true);
    }
  });

  // Parentheticals are stripped before comparison, so "Texis (Unofficial Companion)" reduces to
  // the bare title and the exact-match rule has it before the companion rule is reached.
  it("leaves a parenthesised companion to the exact-match rule", () => {
    expect(isCompanionTitle("Texis (Unofficial Companion)", "Texis")).toBe(false);
    expect(isLookalike("Texis (Unofficial Companion)", "Texis")).toBe(true);
  });

  it("still works when the original title is long", () => {
    expect(isCompanionTitle("The Long Field: Summary & Analysis", "The Long Field")).toBe(true);
  });
});

describe("what the companion rule must not catch", () => {
  it("does not fire on a longer unrelated title that happens to start with the same word", () => {
    expect(isCompanionTitle("Blue Moon Rising", "Blue")).toBe(false);
    expect(isLookalike("Blue Moon Rising", "Blue")).toBe(false);
  });

  it("does not fire when the padding is ordinary title wording", () => {
    expect(isCompanionTitle("Texis Live In Berlin", "Texis")).toBe(false);
    expect(isCompanionTitle("Texis and the Sea", "Texis")).toBe(false);
  });

  // The markers are only read among the words a candidate adds, so an author whose own title
  // contains one is not permanently suspicious of themselves.
  it("ignores a marker that belongs to the watched title itself", () => {
    expect(isCompanionTitle("A Widow's Guide to Dead Bastards", "A Widow's Guide to Dead Bastards")).toBe(false);
    expect(isCompanionTitle("Study Notes", "Study Notes")).toBe(false);
  });

  it("does not fire on a shorter or equal title", () => {
    expect(isCompanionTitle("Texis", "Texis: Summary & Analysis")).toBe(false);
  });

  it("leaves the existing score-based cases exactly as they were", () => {
    expect(isLookalike("The Long Field: A Novel", "The Long Field")).toBe(true);
    expect(isLookalike("Fourth Wing", "Fourth Winq")).toBe(true);
    expect(isLookalike("Blue Room", "Red Planet")).toBe(false);
  });
});

describe("describeSignal explains which rule caught it", () => {
  it("says what a companion title did, rather than quoting a score that looks weak", () => {
    const text = describeSignal({ kind: "lookalike", ofTitle: "Texis", score: 0.8, companion: true });
    expect(text).toContain("Texis");
    expect(text).not.toContain("80%");
  });

  it("still quotes the score for an ordinary near-match", () => {
    const text = describeSignal({ kind: "lookalike", ofTitle: "Texis", score: 0.9 });
    expect(text).toContain("90%");
  });
});
