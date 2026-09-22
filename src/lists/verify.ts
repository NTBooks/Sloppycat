// Claim verification: the creator's public bio links to their list, and the list names that profile.
import type { ListDocument, Profile } from "../types";
import { adapterFor } from "../adapters";
import { normalizeListUrl } from "../adapters/shared";
import { parseList } from "./format";
import { sameProfile } from "./sources";

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
