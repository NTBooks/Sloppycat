import { describe, expect, it } from "vitest";
import { diffSnapshots } from "../src/diff";
import { isLookalike, similarity } from "../src/lookalike";
import { lookalikeSignal, signalsFor } from "../src/signals";
import type { SnapshotItem } from "../src/types";

const now = "2026-09-22T00:00:00.000Z";
function item(p: Partial<SnapshotItem> & { itemId: string; title: string }): SnapshotItem {
  return { platform: "spotify", kind: "album", url: `https://x/${p.itemId}`, firstSeen: now, source: "profile", ...p };
}

describe("diffSnapshots", () => {
  it("finds added, removed and changed items", () => {
    const before = [item({ itemId: "a", title: "One" }), item({ itemId: "b", title: "Two" })];
    const after = [item({ itemId: "a", title: "One (Remastered)" }), item({ itemId: "c", title: "Three" })];
    const d = diffSnapshots(before, after);
    expect(d.added.map((i) => i.itemId)).toEqual(["c"]);
    expect(d.removed.map((i) => i.itemId)).toEqual(["b"]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]!.fields).toEqual(["title"]);
  });

  it("ignores firstSeen and imageUrl churn", () => {
    const before = [item({ itemId: "a", title: "One", imageUrl: "x" })];
    const after = [item({ itemId: "a", title: "One", imageUrl: "y", firstSeen: "2027-01-01" })];
    expect(diffSnapshots(before, after).changed).toHaveLength(0);
  });
});

describe("lookalike", () => {
  it("flags subtitle-padded clones", () => {
    expect(isLookalike("The Long Field: A Novel", "The Long Field")).toBe(true);
    expect(isLookalike("A Widow's Guide to Dead Bastards", "A Widows Guide To Dead Bastards (Workbook)")).toBe(true);
  });
  it("flags one-letter typosquats", () => {
    expect(isLookalike("Fourth Wing", "Fourth Winq")).toBe(true);
  });
  it("does not flag unrelated titles", () => {
    expect(isLookalike("Blue Room", "Red Planet")).toBe(false);
    expect(similarity("How to Write a Novel", "How to Cook Rice")).toBeLessThan(0.82);
  });
});

describe("signals", () => {
  const history = [
    item({ itemId: "1", title: "A", label: "℗ 2019 Blue Note Records" }),
    item({ itemId: "2", title: "B", label: "℗ 2021 Blue Note Records" }),
    item({ itemId: "3", title: "C", label: "℗ 2023 Impulse!" }),
  ];

  it("flags DistroKid placeholder labels and first-time labels", () => {
    const fake = item({ itemId: "9", title: "Midnight Jazz Vibes", label: "8412 Records DK" });
    const kinds = signalsFor(fake, [...history, fake]).map((s) => s.kind);
    expect(kinds).toContain("distributor_placeholder");
    expect(kinds).toContain("first_time_label");
  });

  it("does not flag a known label", () => {
    const real = item({ itemId: "4", title: "D", label: "℗ 2026 Blue Note Records" });
    expect(signalsFor(real, history)).toEqual([]);
  });

  it("stays quiet on first-time label when history is too thin", () => {
    const fake = item({ itemId: "9", title: "X", label: "Some Label" });
    expect(signalsFor(fake, history.slice(0, 1))).toEqual([]);
  });

  it("flags independently published Amazon books with no reviews", () => {
    const book = item({ platform: "amazon", itemId: "B0FAKE0001", title: "X", kind: "book", label: "Independently published", meta: { reviewCount: 0 } });
    expect(signalsFor(book, []).map((s) => s.kind)).toEqual(["indie_zero_reviews"]);
  });

  it("builds a lookalike signal against watched titles and ignores the original", () => {
    const watched = [item({ itemId: "real", title: "The Long Field", platform: "amazon", kind: "book" })];
    const clone = item({ itemId: "clone", title: "The Long Field: Summary & Analysis", platform: "amazon", kind: "book", source: "search" });
    expect(lookalikeSignal(clone, watched)?.kind).toBe("lookalike");
    expect(lookalikeSignal(watched[0]!, watched)).toBeNull();
  });
});
