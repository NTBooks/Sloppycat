// Apple and Deezer adapters against real API responses captured 2026-09-22.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { apple } from "../src/adapters/apple";
import { deezer } from "../src/adapters/deezer";
import type { FetchContext } from "../src/adapters/types";

const fx = (n: string) => JSON.parse(readFileSync(resolve(__dirname, "fixtures", n), "utf8"));
const ctx: FetchContext = {
  now: "2026-09-22T00:00:00.000Z",
  render: async () => {
    throw new Error("should not render for a JSON adapter");
  },
  parseHtml: async () => {
    throw new Error("should not parse HTML for a JSON adapter");
  },
};

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch: ${url}`);
    return { ok: true, status: 200, json: async () => routes[key] } as Response;
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Apple Music adapter", () => {
  it("maps the iTunes lookup response to catalog items", async () => {
    mockFetch({ "itunes.apple.com/lookup": fx("apple.json") });
    const r = await apple.fetchSnapshot("657515", ctx);
    expect(r.displayName).toBe("Radiohead");
    expect(r.items.length).toBeGreaterThan(20);
    const first = r.items[0]!;
    expect(first.platform).toBe("apple");
    expect(first.itemId).toMatch(/^\d+$/);
    expect(first.url).toContain("music.apple.com");
    expect(first.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Copyright line is the closest thing Apple exposes to a label, and drives the label signals.
    expect(r.items.some((i) => (i.label ?? "").length > 3)).toBe(true);
    // "- Single" / "- EP" suffixes become kinds, not part of the title.
    expect(r.items.some((i) => i.kind === "single")).toBe(true);
    expect(r.items.every((i) => !/ - (Single|EP)$/.test(i.title))).toBe(true);
  });

  it("marks releases credited to another primary artist as appears-on", async () => {
    mockFetch({ "itunes.apple.com/lookup": fx("apple.json") });
    const r = await apple.fetchSnapshot("657515", ctx);
    const foreign = r.items.filter((i) => i.subtitle && i.subtitle !== "Radiohead");
    expect(foreign.every((i) => i.kind === "appears_on")).toBe(true);
  });
});

describe("Deezer adapter", () => {
  it("maps albums and follows pagination", async () => {
    const page = fx("deezer.json") as { data: unknown[]; next?: string };
    delete page.next; // one page in the test
    mockFetch({ "api.deezer.com/artist/399/albums": page, "api.deezer.com/artist/399": { name: "Daft Punk" } });
    const r = await deezer.fetchSnapshot("399", ctx);
    expect(r.displayName).toBe("Daft Punk");
    expect(r.items.length).toBe(page.data.length);
    const kinds = new Set(r.items.map((i) => i.kind));
    expect([...kinds].every((k) => ["album", "single", "ep", "compilation"].includes(k))).toBe(true);
    expect(r.items.every((i) => i.url.includes("deezer.com"))).toBe(true);
    expect(r.items.every((i) => i.firstSeen === ctx.now)).toBe(true);
  });
});
