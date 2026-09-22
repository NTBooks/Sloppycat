import { describe, expect, it } from "vitest";
import { lookalikeSignal, sameCreator } from "../src/signals";
import type { SnapshotItem } from "../src/types";

const ARTIST_ID = "3yY2gUcIsjMr8hjo51PoJ8";
const item = (extra: Partial<SnapshotItem> & { itemId: string; title: string }): SnapshotItem => ({
  platform: "spotify",
  kind: "album",
  url: `https://open.spotify.com/album/${extra.itemId}`,
  firstSeen: "2026-09-22T00:00:00Z",
  source: "search",
  ...extra,
});

const watched = [item({ itemId: "aaaaaaaaaaaaaaaaaaaaaa", title: "Texis", source: "profile" })];
const creator = { name: "Sleigh Bells", id: ARTIST_ID };

describe("lookalikeSignal against the artist's own catalogue", () => {
  // The bug this covers: the same record turns up in search under a second id for another market
  // or a remaster, scores 100% against its own title, and gets reported as a clone of itself.
  it("does not flag the artist's own record that came back under a different id", () => {
    const own = item({ itemId: "bbbbbbbbbbbbbbbbbbbbbb", title: "TEXIS", subtitle: "Sleigh Bells" });
    expect(lookalikeSignal(own, watched, creator)).toBeNull();
  });

  it("recognises their own record by artist id even when the name is written differently", () => {
    const own = item({ itemId: "cccccccccccccccccccccc", title: "Texis", subtitle: "SLEIGH BELLS (Deluxe)", meta: { artistId: ARTIST_ID } });
    expect(lookalikeSignal(own, watched, creator)).toBeNull();
  });

  it("still flags the same title published by somebody else, which is the actual scam", () => {
    const clone = item({ itemId: "dddddddddddddddddddddd", title: "Texis", subtitle: "Midnight Jazz Collective" });
    expect(lookalikeSignal(clone, watched, creator)).toMatchObject({ kind: "lookalike", ofTitle: "Texis" });
  });

  it("flags a dressed-up version of the title by someone else", () => {
    const clone = item({ itemId: "eeeeeeeeeeeeeeeeeeeeee", title: "Texis (Deluxe Edition)", subtitle: "Someone Else" });
    expect(lookalikeSignal(clone, watched, creator)).not.toBeNull();
  });

  // Without a creator the old behaviour stands, so nothing that used to be caught stops being caught.
  it("behaves as before when there is no creator to compare against", () => {
    const own = item({ itemId: "ffffffffffffffffffffff", title: "TEXIS", subtitle: "Sleigh Bells" });
    expect(lookalikeSignal(own, watched)).not.toBeNull();
  });
});

describe("sameCreator", () => {
  it("ignores case, punctuation, accents and a leading article", () => {
    expect(sameCreator("Sleigh Bells", "sleigh bells")).toBe(true);
    expect(sameCreator("The Smiths", "Smiths")).toBe(true);
    expect(sameCreator("Beyoncé", "Beyonce")).toBe(true);
    expect(sameCreator("Simon & Garfunkel", "Simon and Garfunkel")).toBe(true);
  });

  it("does not collapse different people, or guess when a name is missing", () => {
    expect(sameCreator("Sleigh Bells", "Sleigh Bell")).toBe(false);
    expect(sameCreator(undefined, "Sleigh Bells")).toBe(false);
    expect(sameCreator("", "")).toBe(false);
  });
});
