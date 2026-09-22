// Google Books volumes API. No key needed at low volume. Used as a signal source and for lookalike search.
import type { Adapter } from "./types";
import type { SnapshotItem } from "../types";
import { fetchJson } from "./shared";

interface Volume {
  id: string;
  volumeInfo: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    imageLinks?: { thumbnail?: string };
    infoLink?: string;
    industryIdentifiers?: { type: string; identifier: string }[];
  };
}

interface VolumesResponse {
  totalItems: number;
  items?: Volume[];
}

function toItem(v: Volume, now: string, source: "profile" | "search"): SnapshotItem {
  const vi = v.volumeInfo;
  const isbn = vi.industryIdentifiers?.find((i) => i.type === "ISBN_13")?.identifier;
  return {
    platform: "googlebooks",
    itemId: v.id,
    title: vi.subtitle ? `${vi.title}: ${vi.subtitle}` : (vi.title ?? ""),
    subtitle: vi.authors?.join(", "),
    kind: "book",
    releaseDate: vi.publishedDate,
    label: vi.publisher,
    url: vi.infoLink ?? `https://books.google.com/books?id=${v.id}`,
    imageUrl: vi.imageLinks?.thumbnail,
    meta: isbn ? { isbn13: isbn } : undefined,
    firstSeen: now,
    source,
  };
}

export const googlebooks: Adapter = {
  id: "googlebooks",
  label: "Google Books",
  strategy: "json",
  supportsBio: false,
  /** Profile id is the author name; accept books.google.com author searches or a plain "author:Name" form. */
  parseProfileUrl(url) {
    const m = /books\.google\.[a-z.]+\/.*[?&]q=inauthor:([^&]+)/i.exec(url);
    if (m) {
      const name = decodeURIComponent(m[1]!.replace(/\+/g, " ")).replace(/^"|"$/g, "");
      return { profileId: name, url: googlebooks.profileUrl(name) };
    }
    return null;
  },
  parseItemUrl(url) {
    const m = /books\.google\.[a-z.]+\/books(?:\/about\/[^?]+)?\?id=([A-Za-z0-9_-]+)/i.exec(url);
    return m ? m[1]! : null;
  },
  profileUrl: (name) => `https://www.google.com/books/feeds/volumes?q=inauthor:${encodeURIComponent(`"${name}"`)}`,
  itemUrl: (id) => `https://books.google.com/books?id=${id}`,
  async fetchSnapshot(profileId, ctx) {
    const q = encodeURIComponent(`inauthor:"${profileId}"`);
    const data = await fetchJson<VolumesResponse>(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=40&orderBy=newest&printType=books`,
    );
    return { platform: "googlebooks", profileId, displayName: profileId, items: (data.items ?? []).map((v) => toItem(v, ctx.now, "profile")) };
  },
  async searchLookalikes(query, ctx) {
    const data = await fetchJson<VolumesResponse>(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`intitle:"${query}"`)}&maxResults=20&orderBy=newest&printType=books`,
    );
    return (data.items ?? []).map((v) => toItem(v, ctx.now, "search"));
  },
};
