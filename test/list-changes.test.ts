import { beforeEach, describe, expect, it } from "vitest";
import { CHANGE_LABEL, MAX_CHANGES, changesBetween, markAllSeen, recordChanges, summarize } from "../src/lists/changes";
import * as storage from "../src/storage";
import type { ListChange, ListDocument } from "../src/types";

const LIST = "https://example.test/jane.md";
const PROFILE = "https://open.spotify.com/artist/0123456789abcdefghijkl";

function doc(extra: Partial<ListDocument> = {}): ListDocument {
  return {
    title: "Jane Doe — verified catalog",
    type: "creator",
    creator: [{ platform: "spotify", profile: PROFILE }],
    mine: [],
    notMine: [],
    ...extra,
  };
}

/** Enough of chrome.storage.local for the changelog to be written and read back. */
function fakeStorage() {
  let data: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: data[key] }),
        set: async (patch: Record<string, unknown>) => {
          data = { ...data, ...patch };
        },
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
  };
}

describe("changesBetween", () => {
  it("reports a row that appeared in Mine, with the creator profile attached", () => {
    const prev = doc();
    const next = doc({ mine: [{ platform: "spotify", id: "abc", title: "Blue Room", disclosure: { vocals: "human" } }] });
    const out = changesBetween(LIST, prev, next);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "verified",
      platform: "spotify",
      itemId: "abc",
      title: "Blue Room",
      creatorProfile: PROFILE,
      listTitle: "Jane Doe — verified catalog",
      source: LIST,
    });
  });

  it("reports a new accusation and carries its note", () => {
    const prev = doc();
    const next = doc({ notMine: [{ platform: "spotify", id: "fake1", title: "Blue Rooom", note: "uploaded by a distributor" }] });
    const out = changesBetween(LIST, prev, next);
    expect(out).toEqual([expect.objectContaining({ kind: "flagged", itemId: "fake1", note: "uploaded by a distributor" })]);
  });

  it("reports a withdrawn accusation, so a mark disappearing is visible too", () => {
    const prev = doc({ notMine: [{ platform: "spotify", id: "fake1", title: "Blue Rooom" }] });
    const next = doc();
    const out = changesBetween(LIST, prev, next);
    expect(out).toEqual([expect.objectContaining({ kind: "retracted", itemId: "fake1" })]);
  });

  it("treats not-mine becoming mine as one decision, not a retraction and a confirmation", () => {
    const prev = doc({ notMine: [{ platform: "spotify", id: "abc", title: "Blue Room" }] });
    const next = doc({ mine: [{ platform: "spotify", id: "abc", title: "Blue Room" }] });
    const out = changesBetween(LIST, prev, next);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("verified");
  });

  it("says nothing when the file was re-fetched unchanged", () => {
    const d = doc({ mine: [{ platform: "spotify", id: "abc", title: "Blue Room" }], notMine: [{ platform: "spotify", id: "fake1", title: "Blue Rooom" }] });
    expect(changesBetween(LIST, d, structuredClone(d))).toEqual([]);
  });

  it("keys on platform and id together, so the same id on two platforms is two rows", () => {
    const prev = doc({ mine: [{ platform: "spotify", id: "abc", title: "Blue Room" }] });
    const next = doc({
      mine: [
        { platform: "spotify", id: "abc", title: "Blue Room" },
        { platform: "deezer", id: "abc", title: "Blue Room" },
      ],
    });
    const out = changesBetween(LIST, prev, next);
    expect(out).toEqual([expect.objectContaining({ platform: "deezer", kind: "verified" })]);
  });
});

describe("recordChanges", () => {
  beforeEach(fakeStorage);

  it("treats the first fetch of a list as the baseline rather than news", async () => {
    const next = doc({ mine: [{ platform: "spotify", id: "abc", title: "Blue Room" }] });
    expect(await recordChanges(LIST, undefined, next)).toEqual([]);
    expect(await storage.get("listChanges")).toEqual([]);
  });

  it("writes newest first and marks entries unseen", async () => {
    await recordChanges(LIST, doc(), doc({ mine: [{ platform: "spotify", id: "one", title: "One" }] }), "2026-09-01T00:00:00.000Z");
    await recordChanges(
      LIST,
      doc({ mine: [{ platform: "spotify", id: "one", title: "One" }] }),
      doc({ mine: [{ platform: "spotify", id: "one", title: "One" }, { platform: "spotify", id: "two", title: "Two" }] }),
      "2026-09-02T00:00:00.000Z",
    );
    const log = await storage.get("listChanges");
    expect(log.map((c) => c.itemId)).toEqual(["two", "one"]);
    expect(log.every((c) => !c.seen)).toBe(true);

    await markAllSeen();
    expect((await storage.get("listChanges")).every((c) => c.seen)).toBe(true);
  });

  it("caps the log so a churning list cannot fill storage", async () => {
    const rows = Array.from({ length: MAX_CHANGES + 50 }, (_, i) => ({ platform: "spotify" as const, id: `id${i}`, title: `T${i}` }));
    await recordChanges(LIST, doc(), doc({ mine: rows }));
    expect(await storage.get("listChanges")).toHaveLength(MAX_CHANGES);
  });
});

describe("summarize", () => {
  const change = (kind: ListChange["kind"], title: string, listTitle = "Jane Doe — verified catalog"): ListChange => ({
    id: `${kind}-${title}`,
    at: "2026-09-22T00:00:00.000Z",
    source: LIST,
    listTitle,
    listType: "creator",
    kind,
    platform: "spotify",
    itemId: title,
    title,
    seen: false,
  });

  it("names the release when only one thing happened", () => {
    expect(summarize([change("verified", "Blue Room")])).toEqual({
      title: "A release was confirmed",
      message: '"Blue Room" · Jane Doe — verified catalog',
    });
  });

  it("counts by kind when a refresh brought several", () => {
    const s = summarize([change("verified", "A"), change("flagged", "B"), change("flagged", "C")]);
    expect(s.title).toBe("3 updates from your lists");
    expect(s.message).toBe("1 confirmed, 2 flagged · Jane Doe — verified catalog");
  });

  it("does not name every list when the update spans more than two", () => {
    const s = summarize([change("flagged", "A", "One"), change("flagged", "B", "Two"), change("flagged", "C", "Three")]);
    expect(s.message).toBe("3 flagged · 3 lists you subscribe to");
  });

  it("labels each kind in the changelog", () => {
    expect(Object.keys(CHANGE_LABEL).sort()).toEqual(["flagged", "retracted", "verified"]);
  });
});
