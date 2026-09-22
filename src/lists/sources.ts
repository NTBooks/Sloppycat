// List subscriptions: fetch, cache, expire, and answer lookups for the consumer overlay.
import type { ListSource, Platform, Verdict } from "../types";
import * as storage from "../storage";
import type { CachedList } from "../storage";
import { expiresToMs, parseList } from "./format";
import { normalizeListUrl } from "../adapters/shared";

export const DEFAULT_COMMUNITY_LIST = "https://raw.githubusercontent.com/sloppycat/lists/main/community.md";

export async function ensureDefaultSources(): Promise<void> {
  const sources = await storage.get("listSources");
  if (!sources.some((s) => s.builtin)) {
    sources.unshift({ url: DEFAULT_COMMUNITY_LIST, enabled: true, builtin: true, title: "Sloppycat community list" });
    await storage.set("listSources", sources);
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
export async function lookup(platform: Platform, ids: string[], profileUrl?: string): Promise<Record<string, Verdict>> {
  const cache = await storage.get("listCache");
  const sources = await storage.get("listSources");
  const enabled = new Set(sources.filter((s) => s.enabled).map((s) => s.url));
  const myList = await storage.get("myList");
  const settings = await storage.get("settings");

  const lists: CachedList[] = Object.values(cache).filter((c) => enabled.has(c.source));
  if (myList) lists.unshift({ source: settings.myListUrl ?? "local", doc: myList, fetchedAt: new Date().toISOString() });

  const out: Record<string, Verdict> = {};
  const idSet = new Set(ids);

  const rank = (v: Verdict, isCreator: boolean) => (v.status === "not_mine" ? 2 : 1) + (isCreator ? 0.5 : 0);

  for (const l of lists) {
    const isCreator = l.doc.type === "creator";
    for (const r of l.doc.notMine) {
      if (r.platform !== platform || !idSet.has(r.id)) continue;
      const v: Verdict = {
        status: "not_mine",
        listTitle: l.doc.title,
        listUrl: r.source ?? l.source,
        creatorProfile: l.doc.creator.find((c) => c.platform === platform)?.profile,
        firstSeen: r.firstSeen,
        note: r.note,
      };
      if (!out[r.id] || rank(v, isCreator) > rank(out[r.id]!, false)) out[r.id] = v;
    }
    for (const r of l.doc.mine) {
      if (r.platform !== platform || !idSet.has(r.id)) continue;
      const v: Verdict = {
        status: "verified",
        listTitle: l.doc.title,
        listUrl: l.source,
        creatorProfile: l.doc.creator.find((c) => c.platform === platform)?.profile,
        disclosure: r.disclosure,
      };
      if (!out[r.id]) out[r.id] = v;
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
    const owner = lists.find(
      (l) => l.doc.type === "creator" && l.doc.creator.some((c) => c.platform === platform && sameProfile(c.profile, profileUrl)),
    );
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
