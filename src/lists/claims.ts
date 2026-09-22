// Who is allowed to speak for a profile.
//
// A list saying "this is the catalog of artist X" is a claim, and a claim is worthless on its own:
// anyone can write a file naming anyone's profile. The claim only becomes trustworthy when the profile
// itself points back at the list, through a bio that only the account holder can edit (Spotify for
// Artists, Amazon Author Central, a claimed Goodreads profile).
//
// Every copy of the extension checks that for itself, against the platform, before it will render a
// verdict from that list. There is no server to lie to: tampering with your own client only changes
// what your own browser shows you.
//
// Checking costs a page load, so there are two routes to a trusted list:
//   1. you added the creator's list yourself, and your client verifies the bio link (cached 30 days);
//   2. a community list you subscribed to attests the claim, because its curators checked it.
// Anything else renders nothing at all.

import type { CachedList } from "../storage";
import type { ListDocument, Platform } from "../types";
import * as storage from "../storage";
import { normalizeListUrl } from "../adapters/shared";
import { sameProfile } from "./sources";

export type ClaimState = "verified" | "failed" | "unchecked";

export interface Claim {
  listUrl: string;
  platform: Platform;
  /** The profile that proved the link, once one does. */
  profileUrl?: string;
  state: ClaimState;
  checkedAt?: string;
  reason?: string;
}

/** Re-check a verified claim after this long; a bio can change or a list can move. */
export const CLAIM_TTL_MS = 30 * 24 * 3600 * 1000;
/** Don't hammer a failing claim on every page view. */
export const CLAIM_RETRY_MS = 6 * 3600 * 1000;

export function claimKey(listUrl: string, platform: Platform): string {
  return `${normalizeListUrl(listUrl)}|${platform}`;
}

export async function getClaim(listUrl: string, platform: Platform): Promise<Claim | undefined> {
  const claims = await storage.get("claims");
  return claims[claimKey(listUrl, platform)];
}

export async function setClaim(c: Claim): Promise<void> {
  await storage.update("claims", (all) => ({ ...all, [claimKey(c.listUrl, c.platform)]: c }));
}

export function isFresh(c: Claim | undefined): boolean {
  if (!c?.checkedAt) return false;
  const age = Date.now() - Date.parse(c.checkedAt);
  return c.state === "verified" ? age < CLAIM_TTL_MS : age < CLAIM_RETRY_MS;
}

/** Claims that the community lists the user subscribes to have already checked. */
export function attestations(lists: CachedList[]): Map<string, { by: string; checked?: string }> {
  const out = new Map<string, { by: string; checked?: string }>();
  for (const l of lists) {
    if (l.doc.type !== "community") continue;
    for (const a of l.doc.attested ?? []) {
      out.set(`${normalizeListUrl(a.list)}|${a.platform}`, { by: l.doc.title, checked: a.checked });
    }
  }
  return out;
}

export interface Trust {
  trusted: boolean;
  /** How it was established, for the report card and the settings table. */
  via: "own-list" | "self-checked" | "attested" | "community" | "none";
  attestedBy?: string;
}

/**
 * Decide whether a cached list may produce verdicts for a platform.
 * `ownList` is the user's own decisions, which need no proof to badge their own page.
 */
export function trustFor(
  list: CachedList,
  platform: Platform,
  claims: Record<string, Claim>,
  attested: Map<string, { by: string; checked?: string }>,
  isOwnList: boolean,
): Trust {
  if (isOwnList) return { trusted: true, via: "own-list" };
  // Subscribing to a community list is itself the trust decision, the same as adding a filter list.
  if (list.doc.type === "community") return { trusted: true, via: "community" };
  const key = claimKey(list.source, platform);
  if (claims[key]?.state === "verified") return { trusted: true, via: "self-checked" };
  const att = attested.get(key);
  if (att) return { trusted: true, via: "attested", attestedBy: att.by };
  return { trusted: false, via: "none" };
}

/** Profiles a creator list claims on one platform, in the order they should be checked. */
export function claimedProfiles(doc: ListDocument, platform: Platform): string[] {
  return doc.creator.filter((c) => c.platform === platform).map((c) => c.profile);
}

export function claimsThisProfile(doc: ListDocument, platform: Platform, profileUrl: string): boolean {
  return claimedProfiles(doc, platform).some((p) => sameProfile(p, profileUrl));
}
