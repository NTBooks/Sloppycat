// Apple Music via the free, unauthenticated iTunes Search/Lookup API.
import type { Adapter } from "./types";
import type { ItemKind, SnapshotItem } from "../types";
import { fetchJson } from "./shared";

interface ItunesResult {
  wrapperType: string;
  collectionType?: string;
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  artistId?: number;
  releaseDate?: string;
  copyright?: string;
  artworkUrl100?: string;
  collectionViewUrl?: string;
  trackCount?: number;
}

interface ItunesResponse {
  resultCount: number;
  results: ItunesResult[];
}

function kindOf(r: ItunesResult): ItemKind {
  const name = (r.collectionName ?? "").toLowerCase();
  if (r.collectionType === "Compilation") return "compilation";
  if (/ - single$/.test(name)) return "single";
  if (/ - ep$/.test(name)) return "ep";
  return "album";
}

function toItem(r: ItunesResult, now: string, source: "profile" | "search"): SnapshotItem {
  return {
    platform: "apple",
    itemId: String(r.collectionId),
    title: (r.collectionName ?? "").replace(/ - (Single|EP)$/, ""),
    subtitle: r.artistName,
    kind: kindOf(r),
    releaseDate: r.releaseDate?.slice(0, 10),
    label: r.copyright,
    url: r.collectionViewUrl ?? `https://music.apple.com/album/${r.collectionId}`,
    imageUrl: r.artworkUrl100,
    meta: r.trackCount ? { trackCount: r.trackCount } : undefined,
    firstSeen: now,
    source,
  };
}

export const apple: Adapter = {
  id: "apple",
  label: "Apple Music",
  strategy: "json",
  supportsBio: false,
  parseProfileUrl(url) {
    const m = /music\.apple\.com\/(?:[a-z]{2}\/)?artist\/(?:[^/]+\/)?(\d+)/i.exec(url);
    return m ? { profileId: m[1]!, url: `https://music.apple.com/artist/${m[1]}` } : null;
  },
  parseItemUrl(url) {
    const m = /music\.apple\.com\/(?:[a-z]{2}\/)?album\/(?:[^/]+\/)?(\d+)/i.exec(url);
    return m ? m[1]! : null;
  },
  profileUrl: (id) => `https://music.apple.com/artist/${id}`,
  itemUrl: (id) => `https://music.apple.com/album/${id}`,
  async fetchSnapshot(profileId, ctx) {
    const data = await fetchJson<ItunesResponse>(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(profileId)}&entity=album&limit=200&sort=recent`,
    );
    const artist = data.results.find((r) => r.wrapperType === "artist");
    const items = data.results
      .filter((r) => r.wrapperType === "collection" && r.collectionId)
      .map((r) => toItem(r, ctx.now, "profile"));
    // Anything credited to a different primary artist is an "appears on"-style entry.
    for (const it of items) {
      if (artist && it.subtitle && it.subtitle !== artist.artistName) it.kind = "appears_on";
    }
    return { platform: "apple", profileId, displayName: artist?.artistName, items };
  },
  async searchLookalikes(query, ctx) {
    const data = await fetchJson<ItunesResponse>(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=25`,
    );
    return data.results.filter((r) => r.collectionId).map((r) => toItem(r, ctx.now, "search"));
  },
};
