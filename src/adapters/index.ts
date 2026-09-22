import type { Platform } from "../types";
import type { Adapter } from "./types";
import { apple } from "./apple";
import { deezer } from "./deezer";
import { spotify } from "./spotify";
import { amazon } from "./amazon";
import { goodreads } from "./goodreads";
import { googlebooks } from "./googlebooks";

export const adapters: Record<Platform, Adapter> = { spotify, apple, deezer, amazon, goodreads, googlebooks };

export function adapterFor(platform: Platform): Adapter {
  return adapters[platform];
}

/** Identify which platform a URL belongs to and parse its profile id. */
export function detectProfile(url: string): { platform: Platform; profileId: string; url: string } | null {
  for (const a of Object.values(adapters)) {
    const p = a.parseProfileUrl(url);
    if (p) return { platform: a.id, ...p };
  }
  return null;
}

export function detectPlatform(url: string): Platform | null {
  try {
    const h = new URL(url).host;
    if (h.endsWith("spotify.com")) return "spotify";
    if (h.endsWith("music.apple.com")) return "apple";
    if (h.endsWith("deezer.com")) return "deezer";
    if (/amazon\./.test(h)) return "amazon";
    if (h.endsWith("goodreads.com")) return "goodreads";
    if (h.includes("books.google")) return "googlebooks";
  } catch {
    /* fallthrough */
  }
  return null;
}

export type { Adapter, FetchContext } from "./types";
export { ChallengeError } from "./types";
