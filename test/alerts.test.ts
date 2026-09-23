import { describe, expect, it } from "vitest";
import { MAX_RESOLVED, RESOLVED_KEEP_MS, pruneAlerts, sameReleaseDateOrLater } from "../src/alerts";
import * as storage from "../src/storage";
import type { Alert } from "../src/types";

const NOW = Date.parse("2026-09-22T12:00:00Z");

function alert(id: string, ageMs: number, resolution?: Alert["resolution"]): Alert {
  const at = new Date(NOW - ageMs).toISOString();
  return {
    id,
    profileKey: "spotify:x",
    createdAt: at,
    change: "added",
    signals: [],
    item: { platform: "spotify", itemId: id, title: id, kind: "single", url: "", firstSeen: at, source: "profile" },
    ...(resolution ? { resolution, resolvedAt: at } : {}),
  };
}

const byId = (list: Alert[]) => Object.fromEntries(list.map((a) => [a.id, a]));

describe("pruneAlerts", () => {
  it("never drops an alert nobody has dealt with, however old", () => {
    const out = pruneAlerts(byId([alert("old", RESOLVED_KEEP_MS * 3)]), NOW);
    expect(Object.keys(out)).toEqual(["old"]);
  });

  it("drops resolved alerts once they are past the keep window", () => {
    const out = pruneAlerts(byId([alert("recent", 1000, "dismissed"), alert("stale", RESOLVED_KEEP_MS + 1000, "mine")]), NOW);
    expect(Object.keys(out)).toEqual(["recent"]);
  });

  it("keeps only the newest resolved alerts past the cap", () => {
    const many = Array.from({ length: MAX_RESOLVED + 20 }, (_, i) => alert(`a${i}`, i * 1000, "dismissed"));
    const out = pruneAlerts(byId(many), NOW);
    expect(Object.keys(out)).toHaveLength(MAX_RESOLVED);
    expect(out["a0"]).toBeDefined();
    expect(out[`a${MAX_RESOLVED + 19}`]).toBeUndefined();
  });
});

describe("sameReleaseDateOrLater", () => {
  // Compared as text, "2024" sorts before "2024-06-01", so a release from the newest year known was
  // read as older than the newest release, and a partial read let it through without an alert.
  it("compares a bare year with a full date at the year", () => {
    expect(sameReleaseDateOrLater("2024", "2024-06-01")).toBe(true);
    expect(sameReleaseDateOrLater("2023", "2024-06-01")).toBe(false);
    expect(sameReleaseDateOrLater("2024-07-01", "2024")).toBe(true);
  });

  it("compares full dates as dates", () => {
    expect(sameReleaseDateOrLater("2024-06-02", "2024-06-01")).toBe(true);
    expect(sameReleaseDateOrLater("2024-05-30", "2024-06-01")).toBe(false);
  });

  it("treats anything as new when nothing is known yet", () => {
    expect(sameReleaseDateOrLater("1999", "")).toBe(true);
  });
});

describe("storage.update", () => {
  // Two updates to one key used to both read the old value, and the later write threw the earlier
  // one away. The worker does this all the time: logging a line while recording a result.
  it("applies concurrent updates to the same key one after another", async () => {
    let data: Record<string, unknown> = { runCounter: 0 };
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: async (key: string) => {
            await new Promise((r) => setTimeout(r, 1));
            return { [key]: data[key] };
          },
          set: async (patch: Record<string, unknown>) => {
            await new Promise((r) => setTimeout(r, 1));
            data = { ...data, ...patch };
          },
        },
        onChanged: { addListener() {}, removeListener() {} },
      },
    };
    await Promise.all(Array.from({ length: 10 }, () => storage.update("runCounter", (n) => n + 1)));
    expect(data["runCounter"]).toBe(10);
  });

  it("does not let a set be undone by an update queued before it", async () => {
    let data: Record<string, unknown> = { runCounter: 0 };
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: data[key] }),
          set: async (patch: Record<string, unknown>) => {
            await new Promise((r) => setTimeout(r, 1));
            data = { ...data, ...patch };
          },
        },
        onChanged: { addListener() {}, removeListener() {} },
      },
    };
    const u = storage.update("runCounter", (n) => n + 1);
    const s = storage.set("runCounter", 100);
    await Promise.all([u, s]);
    expect(data["runCounter"]).toBe(100);
  });
});
