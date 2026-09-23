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

/**
 * Identify which platform a URL belongs to and parse its profile id. The host is checked first: the
 * adapters' path patterns are unanchored, and `https://anything.example/open.spotify.com/artist/<id>`
 * must not parse as that artist.
 */
export function detectProfile(url: string): { platform: Platform; profileId: string; url: string } | null {
  const platform = detectPlatform(url);
  if (!platform) return null;
  const p = adapters[platform].parseProfileUrl(url);
  return p ? { platform, ...p } : null;
}

/**
 * The identity of a profile URL, as `platform:profileId`, or null when it is not one. Two URLs name
 * the same profile exactly when these match; ids are compared as the platform issues them, so case
 * matters where the platform says it does (Spotify's are case-sensitive).
 */
export function profileIdentity(url: string): string | null {
  const p = detectProfile(url);
  return p ? `${p.platform}:${p.profileId}` : null;
}

const AMAZON_HOST = /^(?:www\.|smile\.)?amazon\.(?:com|ca|de|fr|it|es|nl|se|pl|in|sg|ae|sa|eg|co\.uk|co\.jp|com\.au|com\.mx|com\.br|com\.tr|com\.be)$/;
const GOOGLE_BOOKS_HOST = /^books\.google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;

/** The host itself or a subdomain of it, never a lookalike such as `evilspotify.com`. */
function onDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function detectPlatform(url: string): Platform | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const h = u.hostname.toLowerCase();
    if (onDomain(h, "spotify.com")) return "spotify";
    if (h === "music.apple.com") return "apple";
    if (onDomain(h, "deezer.com")) return "deezer";
    if (AMAZON_HOST.test(h)) return "amazon";
    if (onDomain(h, "goodreads.com")) return "goodreads";
    if (GOOGLE_BOOKS_HOST.test(h)) return "googlebooks";
  } catch {
    /* fallthrough */
  }
  return null;
}

export type { Adapter, FetchContext } from "./types";
export { ChallengeError } from "./types";
