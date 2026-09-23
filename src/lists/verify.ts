// Claim verification: the creator's public bio links to their list, and the list names that profile.
import type { ListDocument, Platform, Profile } from "../types";
import { adapterFor, type FetchContext } from "../adapters";
import { normalizeListUrl } from "../adapters/shared";
import { hasListAccess, hostOf, listUrlProblem } from "./permissions";
import { parseList } from "./format";
import { sameProfile } from "./sources";
import { claimsThisProfile, setClaim, type Claim } from "./claims";
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
  const problem = listUrlProblem(url);
  if (problem) return { ok: false, listUrl: url, reason: problem };
  // A bio can point anywhere. Reading a host the user never granted would fail as a network error,
  // so name the missing grant instead: Settings can ask for it, this worker cannot.
  if (!(await hasListAccess(url))) {
    return {
      ok: false,
      listUrl: url,
      reason: `Your list is hosted on ${hostOf(url)}, which Sloppycat has no permission to read yet. Add it under List sources in Settings and allow the host when Chrome asks.`,
    };
  }
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
 * Subscriber-side claim check: does this profile, which the list claims, point back at the list?
 *
 * The answer comes from the platform, not from the list, so a forged list fails no matter what it
 * says about itself. Only the account holder can edit that bio. Runs in each viewer's own browser,
 * so there is no server to spoof: tampering here only changes what this browser shows its own user.
 *
 * One profile per check. A list naming several profiles has a claim over each, proved separately.
 */
export async function checkClaim(listUrl: string, platform: Platform, profileUrl: string, ctx: FetchContext): Promise<Claim> {
  const source = normalizeListUrl(listUrl);
  const cache = await storage.get("listCache");
  const entry = cache[listUrl] ?? cache[source];
  const now = new Date().toISOString();
  const fail = (reason: string): Claim => ({ listUrl: source, platform, profileUrl, state: "failed", checkedAt: now, reason });

  if (!entry) return fail("List has not been fetched yet");
  const adapter = adapterFor(platform);
  if (!adapter.fetchBio) return fail(`${adapter.label} has no bio the account holder controls`);
  if (!claimsThisProfile(entry.doc, platform, profileUrl)) return fail("List does not claim this profile");
  const parsed = adapter.parseProfileUrl(profileUrl);
  if (!parsed) return fail("Not a profile URL on this platform");

  let bioLink: string | undefined;
  try {
    bioLink = await adapter.fetchBio(parsed.profileId, ctx);
  } catch (e) {
    return fail(`Could not read the profile: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (bioLink && normalizeListUrl(bioLink) === source) {
    return { listUrl: source, platform, profileUrl, state: "verified", checkedAt: now };
  }
  return fail("This profile's bio does not link back to the list");
}

/** Check and store. Returns the stored claim. */
export async function runClaimCheck(listUrl: string, platform: Platform, profileUrl: string, ctx: FetchContext): Promise<Claim> {
  const claim = await checkClaim(listUrl, platform, profileUrl, ctx);
  await setClaim(claim);
  return claim;
}

export function describeClaim(c: Claim | undefined): string {
  if (!c) return "Not checked yet";
  if (c.state === "verified") return `Verified against ${c.profileUrl}`;
  return c.reason ?? "Not verified";
}
