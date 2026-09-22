// List subscriptions: fetch, cache, expire, and answer lookups for the consumer overlay.
import type { Identifiers, ListSource, Platform, Verdict } from "../types";
import { ID_KEYS } from "../types";
import * as storage from "../storage";
import type { CachedList } from "../storage";
import { expiresToMs, parseList } from "./format";
import { normalizeListUrl } from "../adapters/shared";
import { attestations, claimsThisProfile, isCorroborated, routeFor, type ListRoute } from "./claims";

export const DEFAULT_COMMUNITY_LIST = "https://raw.githubusercontent.com/NTBooks/Sloppycat/main/lists/community.md";

/** Earlier default URLs, replaced in place so an installed copy follows the move. */
const RETIRED_DEFAULTS = ["https://raw.githubusercontent.com/sloppycat/lists/main/community.md"];

export async function ensureDefaultSources(): Promise<void> {
  const sources = await storage.get("listSources");
  const builtin = sources.find((s) => s.builtin);
  if (!builtin) {
    sources.unshift({ url: DEFAULT_COMMUNITY_LIST, enabled: true, builtin: true, title: "Sloppycat community list" });
    await storage.set("listSources", sources);
    return;
  }
  if (builtin.url !== DEFAULT_COMMUNITY_LIST && RETIRED_DEFAULTS.includes(builtin.url)) {
    const old = builtin.url;
    builtin.url = DEFAULT_COMMUNITY_LIST;
    builtin.error = undefined;
    builtin.etag = undefined;
    builtin.fetchedAt = undefined;
    await storage.set("listSources", sources);
    await storage.update("listCache", (c) => {
      const next = { ...c };
      delete next[old];
      return next;
    });
    await refreshSource(DEFAULT_COMMUNITY_LIST, true);
  }
}

export async function addSource(url: string): Promise<ListSource> {
  const norm = normalizeListUrl(url);
  const sources = await storage.get("listSources");
  let src = sources.find((s) => s.url === norm);
  if (!src) {
    src = { url: norm, enabled: true };
    sources.push(src);
    await storage.set("listSources", sources);
  }
  await refreshSource(norm, true);
  return (await storage.get("listSources")).find((s) => s.url === norm)!;
}

export async function removeSource(url: string): Promise<void> {
  await storage.update("listSources", (s) => s.filter((x) => x.url !== url || x.builtin));
  await storage.update("listCache", (c) => {
    const next = { ...c };
    delete next[url];
    return next;
  });
}

export async function setSourceEnabled(url: string, enabled: boolean): Promise<void> {
  await storage.update("listSources", (s) => s.map((x) => (x.url === url ? { ...x, enabled } : x)));
}

/** Fetch one source if stale (or forced). Records errors on the source row instead of throwing. */
export async function refreshSource(url: string, force = false): Promise<void> {
  const sources = await storage.get("listSources");
  const src = sources.find((s) => s.url === url);
  if (!src || !src.enabled) return;
  const cache = await storage.get("listCache");
  const cached = cache[url];
  if (!force && cached) {
    const ttl = expiresToMs(cached.doc.expires);
    if (Date.now() - Date.parse(cached.fetchedAt) < ttl) return;
  }
  const patch: Partial<ListSource> = {};
  try {
    const headers: Record<string, string> = {};
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    const res = await fetch(url, { headers, credentials: "omit", cache: "no-cache" });
    if (res.status === 304 && cached) {
      patch.fetchedAt = new Date().toISOString();
      patch.error = undefined;
      cache[url] = { ...cached, fetchedAt: patch.fetchedAt };
    } else if (!res.ok) {
      patch.error = `HTTP ${res.status}`;
    } else {
      const text = await res.text();
      const parsed = parseList(text);
      if (!parsed.doc) {
        patch.error = parsed.errors.map((e) => `line ${e.line}: ${e.message}`).join("; ");
      } else {
        const entry: CachedList = {
          source: url,
          doc: parsed.doc,
          fetchedAt: new Date().toISOString(),
          etag: res.headers.get("etag") ?? undefined,
        };
        cache[url] = entry;
        patch.title = parsed.doc.title;
        patch.type = parsed.doc.type;
        patch.entryCount = parsed.doc.mine.length + parsed.doc.notMine.length + (parsed.doc.likely?.length ?? 0);
        patch.fetchedAt = entry.fetchedAt;
        patch.etag = entry.etag;
        patch.error = undefined;
      }
    }
  } catch (e) {
    patch.error = e instanceof Error ? e.message : String(e);
  }
  await storage.set("listCache", cache);
  await storage.update("listSources", (s) => s.map((x) => (x.url === url ? { ...x, ...patch } : x)));
}

export async function refreshAll(force = false): Promise<void> {
  const sources = await storage.get("listSources");
  for (const s of sources) if (s.enabled) await refreshSource(s.url, force);
}

/**
 * Answer "what do the lists say about these items?" for the overlay.
 * Precedence: an explicit not-mine beats mine; creator lists beat community lists for the same id.
 * "unconfirmed" is only returned for items whose creator is enrolled (has a creator list covering that platform),
 * which the caller establishes by passing the profile id when known.
 */
/**
 * @param pageIds identifiers the page exposed, keyed by the platform id they belong to
 *                (e.g. { B0C1234567: { isbn: "9780000000000" } }). Lets a claim match a re-upload
 *                that carries the same ISBN or UPC under a different platform id.
 */
export async function lookup(
  platform: Platform,
  ids: string[],
  profileUrl?: string,
  pageIds?: Record<string, Identifiers>,
): Promise<Record<string, Verdict>> {
  const cache = await storage.get("listCache");
  const sources = await storage.get("listSources");
  const enabled = new Set(sources.filter((s) => s.enabled).map((s) => s.url));
  const myList = await storage.get("myList");
  const settings = await storage.get("settings");

  const claims = await storage.get("claims");
  const all: CachedList[] = Object.values(cache).filter((c) => enabled.has(c.source));
  const ownSource = settings.myListUrl ?? "local";
  if (myList) all.unshift({ source: ownSource, doc: myList, fetchedAt: new Date().toISOString() });

  // Every enabled list speaks: the user put it there. The route only records how, so the card can
  // say whether anybody checked the claim against the platform.
  const attested = attestations(all);
  const routes = new Map<string, ListRoute>();
  const lists = all;
  for (const l of all) {
    routes.set(l.source, routeFor(l, platform, claims, attested, l.source === ownSource && !!myList));
  }

  const out: Record<string, Verdict> = {};
  const idSet = new Set(ids);

  // Build a reverse index of the identifiers this page exposed, so a row that carries the same ISRC,
  // UPC or ISBN matches even when the platform id is different.
  const byIdentifier = new Map<string, string>();
  for (const [platformId, identifiers] of Object.entries(pageIds ?? {})) {
    for (const k of ID_KEYS) {
      const v = identifiers[k];
      if (v) byIdentifier.set(`${k}:${v}`, platformId);
    }
  }
  const matchRow = (r: { id: string; ids?: Identifiers }): string | undefined => {
    if (idSet.has(r.id)) return r.id;
    if (!byIdentifier.size || !r.ids) return undefined;
    for (const k of ID_KEYS) {
      const v = r.ids[k];
      if (v) {
        const hit = byIdentifier.get(`${k}:${v}`);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  const via = (l: CachedList) => routes.get(l.source);
  const viaOf = (l: CachedList): Verdict["via"] => routes.get(l.source)?.via;

  const rank = (v: Verdict, isCreator: boolean) => (v.status === "not_mine" ? 2 : 1) + (isCreator ? 0.5 : 0);

  for (const l of lists) {
    const isCreator = l.doc.type === "creator";
    for (const r of l.doc.notMine) {
      if (r.platform !== platform) continue;
      const hitId = matchRow(r);
      if (!hitId) continue;
      const v: Verdict = {
        status: "not_mine",
        listTitle: l.doc.title,
        listUrl: r.source ?? l.source,
        creatorProfile: l.doc.creator.find((c) => c.platform === platform)?.profile,
        firstSeen: r.firstSeen,
        note: r.note,
        via: viaOf(l),
        attestedBy: via(l)?.attestedBy,
      };
      if (!out[hitId] || rank(v, isCreator) > rank(out[hitId]!, false)) out[hitId] = v;
    }
    for (const r of l.doc.mine) {
      if (r.platform !== platform) continue;
      const hitId = matchRow(r);
      if (!hitId) continue;
      const v: Verdict = {
        status: "verified",
        listTitle: l.doc.title,
        listUrl: l.source,
        creatorProfile: l.doc.creator.find((c) => c.platform === platform)?.profile,
        disclosure: r.disclosure,
        via: viaOf(l),
        attestedBy: via(l)?.attestedBy,
      };
      if (!out[hitId]) out[hitId] = v;
    }
  }

  // Likely accurate: released before the list's baseline cutoff, not yet confirmed either way.
  for (const l of lists) {
    for (const r of l.doc.likely ?? []) {
      if (r.platform !== platform || !idSet.has(r.id) || out[r.id]) continue;
      out[r.id] = {
        status: "likely_accurate",
        listTitle: l.doc.title,
        listUrl: l.source,
        creatorProfile: l.doc.creator.find((c) => c.platform === platform)?.profile,
        released: r.released,
        baselineBefore: l.doc.baselineBefore,
      };
    }
  }

  // Unconfirmed: the page belongs to an enrolled creator, but this item is in neither section.
  if (profileUrl) {
    const owner = lists.find((l) => l.doc.type === "creator" && claimsThisProfile(l.doc, platform, profileUrl));
    if (owner) {
      for (const id of ids) {
        if (!out[id]) {
          out[id] = { status: "unconfirmed", listTitle: owner.doc.title, listUrl: owner.source, creatorProfile: profileUrl };
        }
      }
    }
  }
  return out;
}

/**
 * Creator lists that claim this profile and have nothing corroborating it yet. The caller may check
 * them against the platform's bio to upgrade the route. Their rows render either way; a check that
 * passes only changes the card from "a list you added" to "checked against the artist's profile".
 */
export async function unprovenClaims(platform: Platform, profileUrl: string): Promise<string[]> {
  const cache = await storage.get("listCache");
  const sources = await storage.get("listSources");
  const enabled = new Set(sources.filter((s) => s.enabled).map((s) => s.url));
  const claims = await storage.get("claims");
  const all = Object.values(cache).filter((c) => enabled.has(c.source));
  const attested = attestations(all);
  return all
    .filter(
      (l) =>
        l.doc.type === "creator" &&
        claimsThisProfile(l.doc, platform, profileUrl) &&
        !isCorroborated(routeFor(l, platform, claims, attested, false).via),
    )
    .map((l) => l.source);
}

export function sameProfile(a: string, b: string): boolean {
  const norm = (u: string) =>
    u
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/intl-[a-z]+\//, "/")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.endsWith(nb) || nb.endsWith(na);
}
