// Parse Spotify web-player GraphQL responses into snapshot items, and work out how to ask for the
// rest of a discography.
//
// The response the artist page loads carries the newest 10 albums and 10 singles, plus a total count
// per category. Two consequences the rest of the code has to handle:
//   - a long back catalog is not in that window, so we page for it when the page gives us a query we
//     can re-issue;
//   - a release date is metadata the uploader controls, so a fake dated 2019 never enters a
//     newest-first window at all. The counts are what catch that: see countsOf and driftBetween.
import type { ExtractResult, ItemKind, SnapshotItem } from "../types";
import { findListUrl } from "./shared";

interface Release {
  id: string;
  name: string;
  type?: string;
  date?: { year?: number; month?: number; day?: number; precision?: string };
  label?: string;
  copyright?: { items?: { text: string; type: string }[] };
  coverArt?: { sources?: { url: string }[] };
  artists?: { items?: { profile?: { name?: string }; uri?: string }[] };
}

export interface SpotifyCapture {
  url: string;
  body: string;
  headers: Record<string, string>;
  json: unknown;
}

/** Counts Spotify reports per category, independent of how many items it handed us. */
export type ReleaseCounts = Record<string, number>;

function isRelease(o: unknown): o is Release {
  if (!o || typeof o !== "object") return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r["id"] === "string" &&
    /^[A-Za-z0-9]{22}$/.test(r["id"] as string) &&
    typeof r["name"] === "string" &&
    typeof r["type"] === "string" &&
    /^(ALBUM|SINGLE|EP|COMPILATION)$/.test(r["type"] as string)
  );
}

function kindOf(type: string | undefined, appearsOn: boolean): ItemKind {
  if (appearsOn) return "appears_on";
  switch (type) {
    case "SINGLE":
      return "single";
    case "EP":
      return "ep";
    case "COMPILATION":
      return "compilation";
    default:
      return "album";
  }
}

function dateOf(d: Release["date"]): string | undefined {
  if (!d?.year) return undefined;
  if (d.precision === "YEAR" || !d.month) return String(d.year);
  const mm = String(d.month).padStart(2, "0");
  if (d.precision === "MONTH" || !d.day) return `${d.year}-${mm}`;
  return `${d.year}-${mm}-${String(d.day).padStart(2, "0")}`;
}

function walk(node: unknown, path: string[], out: { r: Release; appearsOn: boolean }[]): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, path, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (isRelease(node)) {
    out.push({ r: node, appearsOn: path.includes("appearsOn") || path.includes("featuring") });
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "tracks" || k === "tracksV2" || k === "topTracks" || k === "relatedArtists") continue;
    walk(v, [...path, k], out);
  }
}

/** Strip HTML tags but keep href targets so a linked list URL is still discoverable. */
function bioText(html: string | undefined): string {
  if (!html) return "";
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  return [html.replace(/<[^>]+>/g, " "), ...hrefs].join("\n");
}

/** Totals Spotify reports for each category, wherever they appear in a response. */
export function countsOf(caps: unknown[]): ReleaseCounts {
  const counts: ReleaseCounts = {};
  const take = (group: unknown, key: string) => {
    const total = (group as { totalCount?: unknown })?.totalCount;
    if (typeof total === "number") counts[key] = Math.max(counts[key] ?? 0, total);
  };
  for (const cap of caps) {
    const au = (cap as { json?: { data?: { artistUnion?: Record<string, unknown> } } })?.json?.data?.artistUnion
      ?? (cap as { data?: { artistUnion?: Record<string, unknown> } })?.data?.artistUnion;
    if (!au) continue;
    const disc = au["discography"] as Record<string, unknown> | undefined;
    if (disc) {
      for (const key of ["albums", "singles", "compilations", "all"]) take(disc[key], key);
    }
    const related = au["relatedContent"] as Record<string, unknown> | undefined;
    if (related) take(related["appearsOn"], "appearsOn");
  }
  return counts;
}

/** Categories that grew, and by how much. */
export function driftBetween(before: ReleaseCounts | undefined, after: ReleaseCounts): { category: string; added: number }[] {
  if (!before) return [];
  const out: { category: string; added: number }[] = [];
  for (const [k, now] of Object.entries(after)) {
    const then = before[k];
    if (typeof then === "number" && now > then) out.push({ category: k, added: now - then });
  }
  return out;
}

export function parseSpotifyCaptures(caps: unknown[], profileId: string, now: string): ExtractResult {
  const found: { r: Release; appearsOn: boolean }[] = [];
  let displayName: string | undefined;
  let bioSource = "";
  let aiPersona: unknown = null;

  for (const cap of caps) {
    // Captures carry the response under `json`; a bare response object is also accepted.
    const payload = (cap as { json?: unknown })?.json ?? cap;
    const au = (payload as { data?: { artistUnion?: Record<string, unknown> } })?.data?.artistUnion;
    if (au) {
      if (au["id"] && au["id"] !== profileId) continue; // a different artist visited in the same tab
      const profile = au["profile"] as
        | { name?: string; biography?: { text?: string }; externalLinks?: { items?: { url: string }[] } }
        | undefined;
      displayName = displayName ?? profile?.name;
      bioSource += "\n" + bioText(profile?.biography?.text);
      bioSource += "\n" + (profile?.externalLinks?.items ?? []).map((l) => l.url).join("\n");
      const rep = au["onPlatformReputationTrait"] as { verification?: { aiPersona?: unknown } } | undefined;
      if (rep?.verification?.aiPersona) aiPersona = rep.verification.aiPersona;
      walk(au, [], found);
    } else {
      walk(payload, [], found);
    }
  }

  const byId = new Map<string, SnapshotItem>();
  for (const { r, appearsOn } of found) {
    const prev = byId.get(r.id);
    const label = r.label ?? r.copyright?.items?.find((c) => c.type === "P")?.text;
    const item: SnapshotItem = {
      platform: "spotify",
      itemId: r.id,
      title: r.name,
      subtitle: r.artists?.items?.map((a) => a.profile?.name).filter(Boolean).join(", ") || undefined,
      kind: kindOf(r.type, appearsOn),
      releaseDate: dateOf(r.date),
      label,
      url: `https://open.spotify.com/album/${r.id}`,
      imageUrl: r.coverArt?.sources?.[0]?.url,
      firstSeen: now,
      source: "profile",
    };
    // Keep the richest record: a primary-discography entry beats an appears-on entry.
    if (!prev || (prev.kind === "appears_on" && item.kind !== "appears_on") || (!prev.label && item.label)) {
      byId.set(r.id, { ...prev, ...item });
    }
  }

  const result: ExtractResult = {
    platform: "spotify",
    profileId,
    displayName,
    bio: findListUrl(bioSource) ?? undefined,
    items: [...byId.values()],
    counts: countsOf(caps),
  };
  if (aiPersona) {
    for (const it of result.items) it.meta = { ...(it.meta ?? {}), artistAiPersona: true };
  }
  return result;
}

// ---------- paging the rest of the catalog ----------

export interface Paginator {
  url: string;
  headers: Record<string, string>;
  operationName: string;
  variables: Record<string, unknown>;
  extensions: unknown;
  /** Names of the offset and limit variables, whatever the operation calls them. */
  offsetKey: string;
  limitKey: string;
}

const OFFSET_KEYS = ["offset", "pageOffset", "start"];
const LIMIT_KEYS = ["limit", "first", "count"];

/**
 * Find a captured request we can re-issue with a different offset. Matching on the shape of the
 * variables rather than on an operation name means a rename on Spotify's side doesn't break it.
 */
export function pickPaginator(caps: SpotifyCapture[]): Paginator | null {
  for (const cap of [...caps].reverse()) {
    if (!cap.body || !cap.headers?.["authorization"]) continue;
    let parsed: { operationName?: string; variables?: Record<string, unknown>; extensions?: unknown };
    try {
      parsed = JSON.parse(cap.body);
    } catch {
      continue;
    }
    const vars = parsed.variables;
    if (!vars || !parsed.operationName) continue;
    const offsetKey = OFFSET_KEYS.find((k) => typeof vars[k] === "number");
    const limitKey = LIMIT_KEYS.find((k) => typeof vars[k] === "number");
    if (!offsetKey || !limitKey) continue;
    // Only worth replaying if this response actually carried releases.
    const found: { r: Release; appearsOn: boolean }[] = [];
    walk(cap.json, [], found);
    if (!found.length) continue;
    return {
      url: cap.url,
      headers: cap.headers,
      operationName: parsed.operationName,
      variables: vars,
      extensions: parsed.extensions,
      offsetKey,
      limitKey,
    };
  }
  return null;
}

/** The request body for one more page of the same query. */
export function pageRequest(p: Paginator, offset: number, limit: number): { url: string; init: RequestInit } {
  return {
    url: p.url,
    init: {
      method: "POST",
      headers: { ...p.headers, "content-type": "application/json" },
      body: JSON.stringify({
        operationName: p.operationName,
        variables: { ...p.variables, [p.offsetKey]: offset, [p.limitKey]: limit },
        extensions: p.extensions,
      }),
      credentials: "omit",
    },
  };
}
