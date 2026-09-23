// Who gets to speak for a profile.
//
// A list saying "this is artist X's catalog, and that release isn't theirs" is a claim, and no file
// proves itself: anyone can write one naming anyone's profile. So the extension doesn't try to work
// out which files are honest. You do, by adding a list, the same way you add a filter list to an ad
// blocker. Nothing arrives on its own, and dropping a list drops everything it ever said.
//
// A creator can corroborate their list by pointing a bio only they control at it (Spotify for
// Artists, Amazon Author Central, a claimed Goodreads profile). When that holds, the viewer's own
// browser can confirm it against the platform and the card says so. That is a label on a list you
// already chose, never a gate. Proof can't be a precondition when it depends on a creator leaving a
// link in their profile forever, and a system that goes dark the day somebody rewrites their bio for
// a tour announcement is a system nobody can rely on.
//
// So `via` records how a list came to be speaking on this page. Every route renders:
//   own-list      your own decisions about your own catalog
//   self-checked  this browser read the creator's bio and it pointed back (cached 30 days)
//   attested      a community list you subscribe to recorded that check, with evidence
//   community     a community list you subscribe to, vouching for itself
//   unproved      a creator list you added that nothing has corroborated yet

import type { CachedList } from "../storage";
import type { ListDocument, Platform } from "../types";
import * as storage from "../storage";
import { normalizeListUrl } from "../adapters/shared";
import { sameProfile } from "./sources";
import { profileIdentity } from "../adapters";

export type ClaimState = "verified" | "failed" | "unchecked";

/**
 * One list's claim over one profile. Scoped to the profile, not the platform: a roster list names
 * many artists, and one of them linking it proves nothing about the others. Scoping it wider let a
 * list name its author's own profile alongside someone else's and come out "checked" for both.
 */
export interface Claim {
  listUrl: string;
  platform: Platform;
  /** The profile whose bio was read. */
  profileUrl: string;
  state: ClaimState;
  checkedAt?: string;
  reason?: string;
}

/** Re-check a verified claim after this long; a bio can change or a list can move. */
export const CLAIM_TTL_MS = 30 * 24 * 3600 * 1000;
/** Don't hammer a failing claim on every page view. */
export const CLAIM_RETRY_MS = 6 * 3600 * 1000;

export function claimKey(listUrl: string, platform: Platform, profileUrl: string): string {
  return `${normalizeListUrl(listUrl)}|${platform}|${profileIdentity(profileUrl) ?? profileUrl}`;
}

export async function getClaim(listUrl: string, platform: Platform, profileUrl: string): Promise<Claim | undefined> {
  const claims = await storage.get("claims");
  return claims[claimKey(listUrl, platform, profileUrl)];
}

export async function setClaim(c: Claim): Promise<void> {
  await storage.update("claims", (all) => ({ ...all, [claimKey(c.listUrl, c.platform, c.profileUrl)]: c }));
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
      out.set(claimKey(a.list, a.platform, a.profile), { by: l.doc.title, checked: a.checked });
    }
  }
  return out;
}

export type Route = "own-list" | "self-checked" | "attested" | "community" | "unproved";

export interface ListRoute {
  /** How this list came to be speaking here. Not whether it may: you added it, so it may. */
  via: Route;
  attestedBy?: string;
}

/** Whether a route means somebody checked the claim against the platform. */
export function isCorroborated(via: Route): boolean {
  return via === "self-checked" || via === "attested";
}

/**
 * How a cached list came to be speaking for a profile.
 * `ownList` is the user's own decisions, which need no corroboration to badge their own page.
 *
 * With a profile, the answer is about that profile alone. Without one (an item page, where the
 * artist is not known), a list counts as checked only when every profile it claims on the platform
 * has been, since any one of them could be the one the item belongs to.
 */
export function routeFor(
  list: CachedList,
  platform: Platform,
  claims: Record<string, Claim>,
  attested: Map<string, { by: string; checked?: string }>,
  isOwnList: boolean,
  profileUrl?: string,
): ListRoute {
  if (isOwnList) return { via: "own-list" };
  // Subscribing is the trust decision, the same as adding a filter list.
  if (list.doc.type === "community") return { via: "community" };
  const profiles = profileUrl
    ? claimsThisProfile(list.doc, platform, profileUrl)
      ? [profileUrl]
      : []
    : claimedProfiles(list.doc, platform);
  if (!profiles.length) return { via: "unproved" };
  let attestedBy: string | undefined;
  for (const p of profiles) {
    const key = claimKey(list.source, platform, p);
    if (claims[key]?.state === "verified") continue;
    const att = attested.get(key);
    if (!att) return { via: "unproved" };
    attestedBy ??= att.by;
  }
  return attestedBy ? { via: "attested", attestedBy } : { via: "self-checked" };
}

/** Profiles a creator list claims on one platform, in the order they should be checked. */
export function claimedProfiles(doc: ListDocument, platform: Platform): string[] {
  return doc.creator.filter((c) => c.platform === platform).map((c) => c.profile);
}

export function claimsThisProfile(doc: ListDocument, platform: Platform, profileUrl: string): boolean {
  return claimedProfiles(doc, platform).some((p) => sameProfile(p, profileUrl));
}
