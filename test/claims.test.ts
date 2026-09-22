import { describe, expect, it } from "vitest";
import { attestations, isCorroborated, routeFor, type Claim } from "../src/lists/claims";
import type { CachedList } from "../src/storage";
import type { ListDocument, Platform } from "../src/types";

const PROFILE = "https://open.spotify.com/artist/0123456789abcdefghijkl";
const LIST = "https://example.test/jane.md";

function doc(type: ListDocument["type"], extra: Partial<ListDocument> = {}): ListDocument {
  return { title: "Jane Doe", type, creator: [{ platform: "spotify", profile: PROFILE }], mine: [], notMine: [], ...extra };
}

function cached(type: ListDocument["type"], source = LIST, extra: Partial<ListDocument> = {}): CachedList {
  return { source, doc: doc(type, extra), fetchedAt: new Date().toISOString() };
}

const NO_CLAIMS: Record<string, Claim> = {};
const NO_ATTESTATIONS = new Map<string, { by: string; checked?: string }>();
const SPOTIFY: Platform = "spotify";

describe("routeFor", () => {
  // The point of the rewrite: adding a list is the trust decision, so every route renders and the
  // route only records how. A creator list nobody has corroborated still speaks.
  it("routes an uncorroborated creator list as unproved rather than silencing it", () => {
    const r = routeFor(cached("creator"), SPOTIFY, NO_CLAIMS, NO_ATTESTATIONS, false);
    expect(r.via).toBe("unproved");
    expect(isCorroborated(r.via)).toBe(false);
  });

  it("marks a creator list self-checked once this browser verified the bio link", () => {
    const claims: Record<string, Claim> = {
      [`${LIST}|spotify`]: { listUrl: LIST, platform: SPOTIFY, state: "verified", checkedAt: new Date().toISOString() },
    };
    const r = routeFor(cached("creator"), SPOTIFY, claims, NO_ATTESTATIONS, false);
    expect(r.via).toBe("self-checked");
    expect(isCorroborated(r.via)).toBe(true);
  });

  it("falls back to an attestation from a subscribed community list", () => {
    const attested = attestations([
      cached("community", "https://example.test/registry.md", {
        attested: [{ list: LIST, platform: SPOTIFY, profile: PROFILE, checked: "2026-09-01" }],
      }),
    ]);
    const r = routeFor(cached("creator"), SPOTIFY, NO_CLAIMS, attested, false);
    expect(r).toMatchObject({ via: "attested", attestedBy: "Jane Doe" });
    expect(isCorroborated(r.via)).toBe(true);
  });

  it("treats a subscribed community list as its own route, with no bio check", () => {
    const r = routeFor(cached("community"), SPOTIFY, NO_CLAIMS, NO_ATTESTATIONS, false);
    expect(r.via).toBe("community");
    expect(isCorroborated(r.via)).toBe(false);
  });

  it("needs nothing to badge your own catalog", () => {
    expect(routeFor(cached("creator"), SPOTIFY, NO_CLAIMS, NO_ATTESTATIONS, true).via).toBe("own-list");
  });

  it("does not carry a claim from one platform over to another", () => {
    const claims: Record<string, Claim> = {
      [`${LIST}|spotify`]: { listUrl: LIST, platform: SPOTIFY, state: "verified", checkedAt: new Date().toISOString() },
    };
    expect(routeFor(cached("creator"), "amazon", claims, NO_ATTESTATIONS, false).via).toBe("unproved");
  });

  it("does not treat a failed check as corroboration", () => {
    const claims: Record<string, Claim> = {
      [`${LIST}|spotify`]: { listUrl: LIST, platform: SPOTIFY, state: "failed", checkedAt: new Date().toISOString(), reason: "bio gone" },
    };
    expect(routeFor(cached("creator"), SPOTIFY, claims, NO_ATTESTATIONS, false).via).toBe("unproved");
  });
});
