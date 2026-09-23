import { describe, expect, it } from "vitest";
import { attestations, claimKey, isCorroborated, routeFor, type Claim } from "../src/lists/claims";
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
      [claimKey(LIST, SPOTIFY, PROFILE)]: { listUrl: LIST, platform: SPOTIFY, profileUrl: PROFILE, state: "verified", checkedAt: new Date().toISOString() },
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
      [claimKey(LIST, SPOTIFY, PROFILE)]: { listUrl: LIST, platform: SPOTIFY, profileUrl: PROFILE, state: "verified", checkedAt: new Date().toISOString() },
    };
    expect(routeFor(cached("creator"), "amazon", claims, NO_ATTESTATIONS, false).via).toBe("unproved");
  });

  it("does not treat a failed check as corroboration", () => {
    const claims: Record<string, Claim> = {
      [claimKey(LIST, SPOTIFY, PROFILE)]: { listUrl: LIST, platform: SPOTIFY, profileUrl: PROFILE, state: "failed", checkedAt: new Date().toISOString(), reason: "bio gone" },
    };
    expect(routeFor(cached("creator"), SPOTIFY, claims, NO_ATTESTATIONS, false).via).toBe("unproved");
  });

  // A roster list names several artists. One of them linking it says nothing about the others, and
  // treating it as if it did let a list name its author's own page beside a victim's and come out
  // "checked" on both.
  describe("a list naming several profiles", () => {
    const OTHER = "https://open.spotify.com/artist/ZYXWVUTSRQPONMLKJIHGFE";
    const roster = () =>
      cached("creator", LIST, {
        creator: [
          { platform: "spotify", profile: PROFILE },
          { platform: "spotify", profile: OTHER },
        ],
      });
    const onlyFirst: Record<string, Claim> = {
      [claimKey(LIST, SPOTIFY, PROFILE)]: { listUrl: LIST, platform: SPOTIFY, profileUrl: PROFILE, state: "verified", checkedAt: new Date().toISOString() },
    };

    it("is checked on the profile that links back", () => {
      expect(routeFor(roster(), SPOTIFY, onlyFirst, NO_ATTESTATIONS, false, PROFILE).via).toBe("self-checked");
    });

    it("is not checked on a profile that does not", () => {
      expect(routeFor(roster(), SPOTIFY, onlyFirst, NO_ATTESTATIONS, false, OTHER).via).toBe("unproved");
    });

    it("is not checked on a page with no profile until every profile it names is", () => {
      expect(routeFor(roster(), SPOTIFY, onlyFirst, NO_ATTESTATIONS, false).via).toBe("unproved");
      const both = {
        ...onlyFirst,
        [claimKey(LIST, SPOTIFY, OTHER)]: { listUrl: LIST, platform: SPOTIFY, profileUrl: OTHER, state: "verified" as const, checkedAt: new Date().toISOString() },
      };
      expect(routeFor(roster(), SPOTIFY, both, NO_ATTESTATIONS, false).via).toBe("self-checked");
    });

    it("takes an attestation for one profile as covering that profile only", () => {
      const attested = attestations([
        cached("community", "https://example.test/registry.md", {
          attested: [{ list: LIST, platform: SPOTIFY, profile: OTHER }],
        }),
      ]);
      expect(routeFor(roster(), SPOTIFY, NO_CLAIMS, attested, false, OTHER).via).toBe("attested");
      expect(routeFor(roster(), SPOTIFY, NO_CLAIMS, attested, false, PROFILE).via).toBe("unproved");
    });
  });
});
