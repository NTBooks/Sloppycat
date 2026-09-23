// List subscriptions: fetch, cache, expire, and answer lookups for the consumer overlay.
import type { Identifiers, ListChange, ListSource, Platform, Verdict } from "../types";
import { ID_KEYS } from "../types";
import * as storage from "../storage";
import type { CachedList } from "../storage";
import { expiresToMs, parseList } from "./format";
import { normalizeListUrl } from "../adapters/shared";
import { profileIdentity } from "../adapters";
import { accessErrorFor, hasListAccess, listUrlProblem, releaseUnusedListAccess } from "./permissions";
import { attestations, claimsThisProfile, isCorroborated, routeFor, type ListRoute } from "./claims";
import { forgetSource, recordChanges } from "./changes";

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

/**
 * Subscribe to a list. The caller is responsible for host access: a list outside the GitHub hosts in
 * the manifest needs `requestListAccess` first, from a user gesture in a page. Called without it the
 * source is still added, and shows the missing-permission error rather than a bare CORS failure.
 */
export async function addSource(url: string): Promise<ListSource> {
  const norm = normalizeListUrl(url);
  const problem = listUrlProblem(norm);
  if (problem) throw new Error(problem);
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
  // Hand back any host access that only this list needed. Nothing else asks for these hosts.
  const settings = await storage.get("settings");
  const left = await storage.get("listSources");
  await releaseUnusedListAccess([...left.map((s) => s.url), settings.myListUrl]);
  // Dropping a list drops everything it ever said, the changelog included.
  await forgetSource(url);
  await storage.update("listCache", (c) => {
    const next = { ...c };
    delete next[url];
    return next;
  });
}

export async function setSourceEnabled(url: string, enabled: boolean): Promise<void> {
  await storage.update("listSources", (s) => s.map((x) => (x.url === url ? { ...x, enabled } : x)));
}

/**
 * Fetch one source if stale (or forced). Records errors on the source row instead of throwing.
 * Returns what changed since the last fetch, for the caller to notify about.
 */
export async function refreshSource(url: string, force = false): Promise<ListChange[]> {
  const sources = await storage.get("listSources");
  const src = sources.find((s) => s.url === url);
  if (!src || !src.enabled) return [];
  const cache = await storage.get("listCache");
  const cached = cache[url];
  if (!force && cached) {
    const ttl = expiresToMs(cached.doc.expires);
    if (Date.now() - Date.parse(cached.fetchedAt) < ttl) return [];
  }
  // Without host access the fetch fails as an opaque network error, so say what is actually wrong.
  if (!(await hasListAccess(url))) {
    await storage.update("listSources", (s) => s.map((x) => (x.url === url ? { ...x, error: accessErrorFor(url) } : x)));
    return [];
  }
  const patch: Partial<ListSource> = {};
  let changes: ListChange[] = [];
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
        changes = await recordChanges(url, cached?.doc, parsed.doc, entry.fetchedAt);
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
  return changes;
}

export async function refreshAll(force = false): Promise<ListChange[]> {
  const sources = await storage.get("listSources");
  const changes: ListChange[] = [];
  for (const s of sources) if (s.enabled) changes.push(...(await refreshSource(s.url, force)));
  return changes;
}

/**
 * Answer "what do the lists say about these items?" for the overlay.
 *
 * Who outranks whom, highest first:
 *   1. a creator list on a profile it claims (your own list included), or on a page with no profile
 *      to check against, such as a single item's page
 *   2. a creator list on a profile it does not claim. Only its "not mine" rows count there: an
 *      impostor profile using the artist's name is exactly where "this isn't mine, the real one is
 *      over here" belongs. A "mine" row there would be a list vouching for someone else's catalogue.
 *   3. a community list
 * Within one tier an explicit "not mine" beats "mine". The order lists were added in never matters.
 *
 * "unconfirmed" is only returned for items whose creator is enrolled (has a creator list covering that
 * profile), which the caller establishes by passing the profile URL when known.
 *
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
  const lists: CachedList[] = Object.values(cache).filter((c) => enabled.has(c.source));
  const ownSource = settings.myListUrl ?? "local";
  if (myList) lists.unshift({ source: ownSource, doc: myList, fetchedAt: new Date().toISOString() });

  // Every enabled list speaks: the user put it there. The route only records how, so the card can
  // say whether anybody checked the claim against the platform.
  const tierOf = (l: CachedList): 1 | 2 | 3 => {
    if (l.doc.type === "community") return 1;
    if (!profileUrl) return 3;
    return claimsThisProfile(l.doc, platform, profileUrl) ? 3 : 2;
  };
  const attested = attestations(lists);
  const routes = new Map<string, ListRoute>();
  for (const l of lists) {
    // Off its own profile, what matters is whether the list really is its artist's, so the route is
    // taken over the profiles it claims rather than the page it is being shown on.
    const on = tierOf(l) === 3 ? profileUrl : undefined;
    routes.set(l.source, routeFor(l, platform, claims, attested, l.source === ownSource && !!myList, on));
  }

  const out: Record<string, Verdict> = {};
  const rankOf = new Map<string, number>();
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
  const offer = (id: string, v: Verdict, rank: number) => {
    if (rank > (rankOf.get(id) ?? 0)) {
      out[id] = v;
      rankOf.set(id, rank);
    }
  };

  for (const l of lists) {
    const tier = tierOf(l);
    const route = routes.get(l.source);
    const creatorProfile = l.doc.creator.find((c) => c.platform === platform)?.profile;
    for (const r of l.doc.notMine) {
      if (r.platform !== platform) continue;
      const hitId = matchRow(r);
      if (!hitId) continue;
      offer(
        hitId,
        {
          status: "not_mine",
          listTitle: l.doc.title,
          listUrl: r.source ?? l.source,
          creatorProfile,
          firstSeen: r.firstSeen,
          note: r.note,
          via: route?.via,
          attestedBy: route?.attestedBy,
          ...(tier === 2 ? { offProfile: true } : {}),
        },
        tier * 10 + 1,
      );
    }
    if (tier === 2) continue;
    for (const r of l.doc.mine) {
      if (r.platform !== platform) continue;
      const hitId = matchRow(r);
      if (!hitId) continue;
      offer(
        hitId,
        {
          status: "verified",
          listTitle: l.doc.title,
          listUrl: l.source,
          creatorProfile,
          disclosure: r.disclosure,
          via: route?.via,
          attestedBy: route?.attestedBy,
        },
        tier * 10,
      );
    }
  }

  // Likely accurate: released before the list's baseline cutoff, not yet confirmed either way. Same
  // scope as a "mine" row, since it is a softer version of one.
  for (const l of lists) {
    if (tierOf(l) === 2) continue;
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
 * Creator lists that claim this profile and have nothing corroborating that claim yet. The caller may
 * check them against the profile's bio to upgrade the route. Their rows render either way; a check
 * that passes only changes the card from "a list you added" to "checked against the artist's profile".
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
        !isCorroborated(routeFor(l, platform, claims, attested, false, profileUrl).via),
    )
    .map((l) => l.source);
}

/**
 * Do two URLs name the same profile? Compared by the id each platform's adapter parses out, never by
 * the text of the URL: a suffix match let `https://anything.example/<real profile url>` claim the
 * real profile, and lowercasing merged Spotify ids that differ only in case.
 */
export function sameProfile(a: string, b: string): boolean {
  const ia = profileIdentity(a);
  return ia !== null && ia === profileIdentity(b);
}
