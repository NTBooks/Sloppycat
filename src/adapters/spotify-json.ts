// Parse Spotify web-player GraphQL responses (queryArtistOverview, discography queries, album queries)
// into snapshot items. Walks the tree generically so renamed operations keep working.
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

export function parseSpotifyCaptures(caps: unknown[], profileId: string, now: string): ExtractResult {
  const found: { r: Release; appearsOn: boolean }[] = [];
  let displayName: string | undefined;
  let bioSource = "";
  let aiPersona: unknown = null;

  for (const cap of caps) {
    const au = (cap as { data?: { artistUnion?: Record<string, unknown> } })?.data?.artistUnion;
    if (au) {
      if (au["id"] && au["id"] !== profileId) continue; // a different artist visited in the same tab
      const profile = au["profile"] as { name?: string; biography?: { text?: string }; externalLinks?: { items?: { url: string }[] } } | undefined;
      displayName = displayName ?? profile?.name;
      bioSource += "\n" + bioText(profile?.biography?.text);
      bioSource += "\n" + (profile?.externalLinks?.items ?? []).map((l) => l.url).join("\n");
      const rep = au["onPlatformReputationTrait"] as { verification?: { aiPersona?: unknown } } | undefined;
      if (rep?.verification?.aiPersona) aiPersona = rep.verification.aiPersona;
      walk(au, [], found);
    } else {
      walk(cap, [], found);
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
    if (!prev || (prev.kind === "appears_on" && item.kind !== "appears_on") || (!prev.label && item.label)) byId.set(r.id, { ...prev, ...item });
  }

  const result: ExtractResult = {
    platform: "spotify",
    profileId,
    displayName,
    bio: findListUrl(bioSource) ?? undefined,
    items: [...byId.values()],
  };
  if (aiPersona) {
    for (const it of result.items) it.meta = { ...(it.meta ?? {}), artistAiPersona: true };
  }
  return result;
}
