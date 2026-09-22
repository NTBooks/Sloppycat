// Claim verification: the creator's public bio links to their list, and the list names that profile.
import type { ListDocument, Platform, Profile } from "../types";
import { adapterFor, type FetchContext } from "../adapters";
import { normalizeListUrl } from "../adapters/shared";
import { parseList } from "./format";
import { sameProfile } from "./sources";
import { claimedProfiles, setClaim, type Claim } from "./claims";
import * as storage from "../storage";

export interface VerifyResult {
  ok: boolean;
  listUrl?: string;
  reason?: string;
  doc?: ListDocument;
}

/**
 * @param bioListUrl the list URL found in the profile's bio (from the extractor), if any.
 */
export async function verifyProfile(profile: Profile, bioListUrl: string | undefined): Promise<VerifyResult> {
  const adapter = adapterFor(profile.platform);
  if (!adapter.supportsBio) {
    return { ok: false, reason: `${adapter.label} has no creator-editable bio; verify via Spotify, Amazon or Goodreads instead.` };
  }
  if (!bioListUrl) return { ok: false, reason: "No Sloppycat list link found in the profile bio yet." };
  const url = normalizeListUrl(bioListUrl);
  let text: string;
  try {
    const res = await fetch(url, { credentials: "omit", cache: "no-cache" });
    if (!res.ok) return { ok: false, listUrl: url, reason: `List URL returned HTTP ${res.status}` };
    text = await res.text();
  } catch (e) {
    return { ok: false, listUrl: url, reason: `Could not fetch list: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = parseList(text);
  if (!parsed.doc) {
    return { ok: false, listUrl: url, reason: `List does not parse: ${parsed.errors.map((e) => e.message).join("; ")}` };
  }
  if (parsed.doc.type !== "creator") return { ok: false, listUrl: url, reason: "Linked list is not a creator list." };
  const names = parsed.doc.creator.some((c) => c.platform === profile.platform && sameProfile(c.profile, profile.url));
  if (!names) {
    return { ok: false, listUrl: url, doc: parsed.doc, reason: "The list's Creator table does not include this profile." };
  }
  return { ok: true, listUrl: url, doc: parsed.doc };
}

/**
 * Subscriber-side claim check: does the profile this list claims actually point back at the list?
 *
 * The answer comes from the platform, not from the list, so a forged list fails no matter what it
 * says about itself. Only the account holder can edit that bio. Runs in each viewer's own browser,
 * so there is no server to spoof: tampering here only changes what this browser shows its own user.
 */
export async function checkClaim(listUrl: string, platform: Platform, ctx: FetchContext): Promise<Claim> {
  const source = normalizeListUrl(listUrl);
  const cache = await storage.get("listCache");
  const entry = cache[listUrl] ?? cache[source];
  const now = new Date().toISOString();
  const fail = (reason: string): Claim => ({ listUrl: source, platform, state: "failed", checkedAt: now, reason });

  if (!entry) return fail("List has not been fetched yet");
  const adapter = adapterFor(platform);
  if (!adapter.fetchBio) return fail(`${adapter.label} has no bio the account holder controls`);

  const profiles = claimedProfiles(entry.doc, platform);
  if (!profiles.length) return fail("List claims no profile on this platform");

  for (const profileUrl of profiles) {
    const parsed = adapter.parseProfileUrl(profileUrl);
    if (!parsed) continue;
    let bioLink: string | undefined;
    try {
      bioLink = await adapter.fetchBio(parsed.profileId, ctx);
    } catch (e) {
      return fail(`Could not read the profile: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (bioLink && normalizeListUrl(bioLink) === source) {
      return { listUrl: source, platform, profileUrl, state: "verified", checkedAt: now };
    }
  }
  return fail("No claimed profile links back to this list");
}

/** Check and store. Returns the stored claim. */
export async function runClaimCheck(listUrl: string, platform: Platform, ctx: FetchContext): Promise<Claim> {
  const claim = await checkClaim(listUrl, platform, ctx);
  await setClaim(claim);
  return claim;
}

export function describeClaim(c: Claim | undefined): string {
  if (!c) return "Not checked yet";
  if (c.state === "verified") return `Verified against ${c.profileUrl ?? "the profile"}`;
  return c.reason ?? "Not verified";
}
