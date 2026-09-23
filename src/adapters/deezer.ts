// Deezer via its free, unauthenticated public API.
import type { Adapter } from "./types";
import type { ItemKind, SnapshotItem } from "../types";
import { fetchJson } from "./shared";

interface DeezerAlbum {
  id: number;
  title: string;
  link: string;
  cover_medium?: string;
  release_date?: string;
  record_type?: string; // album | single | ep | compile
  label?: string;
  artist?: { id: number; name: string };
}

interface DeezerPage<T> {
  data: T[];
  total?: number;
  next?: string;
}

function kindOf(t: string | undefined): ItemKind {
  switch (t) {
    case "single":
      return "single";
    case "ep":
      return "ep";
    case "compile":
      return "compilation";
    default:
      return "album";
  }
}

/**
 * @param fallbackArtist who to credit when the response does not say. Deezer omits `artist` from
 *   the albums of an artist you asked for by id, since it would be the same name on every row, so
 *   without this an alert card for a Deezer release names no artist at all.
 */
function toItem(a: DeezerAlbum, now: string, source: "profile" | "search", fallbackArtist?: string): SnapshotItem {
  return {
    platform: "deezer",
    itemId: String(a.id),
    title: a.title,
    subtitle: a.artist?.name ?? fallbackArtist,
    kind: kindOf(a.record_type),
    releaseDate: a.release_date,
    label: a.label,
    url: a.link ?? `https://www.deezer.com/album/${a.id}`,
    imageUrl: a.cover_medium,
    firstSeen: now,
    source,
  };
}

export const deezer: Adapter = {
  id: "deezer",
  label: "Deezer",
  strategy: "json",
  supportsBio: false,
  parseProfileUrl(url) {
    const m = /deezer\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/i.exec(url);
    return m ? { profileId: m[1]!, url: `https://www.deezer.com/artist/${m[1]}` } : null;
  },
  parseItemUrl(url) {
    const m = /deezer\.com\/(?:[a-z]{2}\/)?album\/(\d+)/i.exec(url);
    return m ? m[1]! : null;
  },
  profileUrl: (id) => `https://www.deezer.com/artist/${id}`,
  itemUrl: (id) => `https://www.deezer.com/album/${id}`,
  async fetchSnapshot(profileId, ctx) {
    const artist = await fetchJson<{ name: string }>(`https://api.deezer.com/artist/${profileId}`);
    const items: SnapshotItem[] = [];
    let url: string | undefined = `https://api.deezer.com/artist/${profileId}/albums?limit=100`;
    let guard = 0;
    while (url && guard++ < 10) {
      const page: DeezerPage<DeezerAlbum> = await fetchJson<DeezerPage<DeezerAlbum>>(url);
      for (const a of page.data) items.push(toItem(a, ctx.now, "profile", artist.name));
      url = page.next;
    }
    return { platform: "deezer", profileId, displayName: artist.name, items };
  },
  async searchLookalikes(query, ctx) {
    const page = await fetchJson<DeezerPage<DeezerAlbum>>(
      `https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=25`,
    );
    return page.data.map((a) => toItem(a, ctx.now, "search"));
  },
  async enrich(item) {
    if (item.label) return item;
    try {
      const a = await fetchJson<DeezerAlbum>(`https://api.deezer.com/album/${item.itemId}`);
      return { ...item, label: a.label ?? item.label };
    } catch {
      return item;
    }
  },
};
