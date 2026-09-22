// Shared domain types for Sloppycat.

export type Platform = "spotify" | "apple" | "deezer" | "amazon" | "goodreads" | "googlebooks";

export const PLATFORMS: Platform[] = ["spotify", "apple", "deezer", "amazon", "goodreads", "googlebooks"];

export const PLATFORM_LABEL: Record<Platform, string> = {
  spotify: "Spotify",
  apple: "Apple Music",
  deezer: "Deezer",
  amazon: "Amazon Books",
  goodreads: "Goodreads",
  googlebooks: "Google Books",
};

export type ItemKind = "album" | "single" | "ep" | "compilation" | "appears_on" | "book" | "unknown";

/** One catalog entry as observed on a platform. */
export interface SnapshotItem {
  platform: Platform;
  itemId: string;
  title: string;
  /** Artist/author string as shown on the platform. */
  subtitle?: string;
  kind: ItemKind;
  releaseDate?: string; // ISO date or year
  /** Record label / publisher if visible. */
  label?: string;
  url: string;
  imageUrl?: string;
  /** Extra platform facts useful for signals (review count, format, etc.). */
  meta?: Record<string, string | number | boolean>;
  /** Cross-platform identifiers when the page exposes them. */
  ids?: Identifiers;
  firstSeen: string; // ISO datetime
  source: "profile" | "search";
}

/** A watched public profile. */
export interface Profile {
  platform: Platform;
  profileId: string;
  url: string;
  displayName?: string;
  addedAt: string;
  lastRunAt?: string;
  lastError?: string;
  verified?: boolean;
  verifiedListUrl?: string;
}

export interface Snapshot {
  profileKey: string; // platform:profileId
  takenAt: string;
  items: SnapshotItem[];
  /** Per-category totals the platform reported at that time. */
  counts?: Record<string, number>;
}

export type Signal =
  | { kind: "first_time_label"; label: string; knownLabels: string[] }
  | { kind: "distributor_placeholder"; label: string }
  | { kind: "indie_zero_reviews" }
  | { kind: "lookalike"; ofTitle: string; score: number }
  | { kind: "released_after"; watchedTitle: string; watchedDate: string }
  | { kind: "count_drift"; category: string; added: number; seen: number };

export interface Alert {
  id: string;
  profileKey: string;
  createdAt: string;
  item: SnapshotItem;
  change: "added" | "changed" | "lookalike" | "count_drift";
  signals: Signal[];
  resolution?: "mine" | "not_mine" | "dismissed";
  resolvedAt?: string;
}

export type DisclosureValue = "human" | "ai-assisted" | "ai-generated" | (string & {});
export type Disclosure = Record<string, DisclosureValue>;

export interface ListCreatorRow {
  platform: Platform;
  profile: string; // URL
}

/**
 * Identifiers that mean something off the platform.
 * A platform id is a shelf number: Amazon mints a fresh ASIN per format and hands one to any upload, and
 * Spotify album ids are local to Spotify. These travel, so a claim survives a re-upload and can be matched
 * across sites: isrc (recording), upc (release barcode), isbn (book, registered to a publisher),
 * mbid (MusicBrainz), discogs (Discogs release), olid (Open Library).
 */
export type Identifiers = Partial<Record<"isrc" | "upc" | "isbn" | "mbid" | "discogs" | "olid", string>>;

export const ID_KEYS = ["isrc", "upc", "isbn", "mbid", "discogs", "olid"] as const;

export interface ListMineRow {
  platform: Platform;
  id: string;
  title: string;
  disclosure?: Disclosure;
  ids?: Identifiers;
}

export interface ListNotMineRow {
  platform: Platform;
  id: string;
  title: string;
  firstSeen?: string;
  note?: string;
  /** Community lists cite the creator list this came from. */
  source?: string;
  ids?: Identifiers;
}

/** Pre-cutoff catalog entry: published before the slop era, presumed genuine but not creator-verified. */
export interface ListLikelyRow {
  platform: Platform;
  id: string;
  title: string;
  released?: string;
}

/** A community list vouching that a creator list really speaks for a profile. */
export interface ListAttestedRow {
  platform: Platform;
  profile: string;
  /** The creator list URL this profile pointed at when a curator checked. */
  list: string;
  checked?: string;
  by?: string;
}

export interface ListDocument {
  title: string;
  type: "creator" | "community";
  homepage?: string;
  version?: string;
  /** Expiry as a duration string, e.g. "7 days", "6 hours". */
  expires?: string;
  /** Items released before this ISO date are presumed genuine ("likely accurate"). */
  baselineBefore?: string;
  creator: ListCreatorRow[];
  mine: ListMineRow[];
  notMine: ListNotMineRow[];
  likely?: ListLikelyRow[];
  attested?: ListAttestedRow[];
}

export interface ListSource {
  url: string;
  enabled: boolean;
  /** Filled after a successful fetch. */
  title?: string;
  type?: "creator" | "community";
  etag?: string;
  fetchedAt?: string;
  entryCount?: number;
  error?: string;
  /** Built-in default list, cannot be removed (but can be disabled). */
  builtin?: boolean;
  /** Per-platform claim state, for the settings table. */
  claims?: { platform: Platform; state: "verified" | "failed" | "unchecked"; via?: string; reason?: string }[];
}

/**
 * Blocker-side features are experimental and off until the user turns them on. They all depend on
 * reading and changing platform pages in the browser, so they only work in the web client: not the
 * Spotify desktop app, not mobile, not the Kindle app.
 */
export interface Experiments {
  /** Badge items on platform pages from subscribed lists. */
  blocker: boolean;
  /** Collapse items a creator says are not theirs, instead of only outlining them. */
  blockFlagged: boolean;
  /** Scan an open library or shelf page for items on your lists. */
  slopscan: boolean;
}

export const DEFAULT_EXPERIMENTS: Experiments = { blocker: false, blockFlagged: false, slopscan: false };

export interface Settings {
  mode: "creator" | "consumer" | "both";
  intervalMinutes: number; // >= 15
  lookalikeEveryNRuns: number;
  notifications: boolean;
  defaultDisclosure: Disclosure;
  experiments: Experiments;
  /** Where the creator's own list lives once published (raw URL). */
  myListUrl?: string;
  /** GitHub device-flow token, if the user signed in. */
  githubToken?: string;
  githubGistId?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "both",
  intervalMinutes: 60,
  lookalikeEveryNRuns: 6,
  notifications: true,
  defaultDisclosure: {},
  experiments: DEFAULT_EXPERIMENTS,
};

export function profileKey(p: { platform: Platform; profileId: string }): string {
  return `${p.platform}:${p.profileId}`;
}

export function itemKey(i: { platform: Platform; itemId: string }): string {
  return `${i.platform}:${i.itemId}`;
}

/** Messages between UI/content scripts and the background worker. */
export type Message =
  | { type: "run:now"; profileKey?: string }
  | { type: "profile:add"; url: string }
  | { type: "profile:remove"; profileKey: string }
  | {
      type: "alert:resolve";
      alertId: string;
      resolution: "mine" | "not_mine" | "dismissed";
      disclosure?: Disclosure;
      note?: string;
    }
  | { type: "lists:refresh" }
  | { type: "lists:lookup"; platform: Platform; ids: string[] }
  | { type: "verify:profile"; profileKey: string }
  | { type: "claims:check"; listUrl: string; platform: Platform }
  | { type: "scan:collect"; tabId: number }
  | { type: "dev:simulate"; kind: "new" | "lookalike" | "drift"; profileKey?: string }
  | { type: "snapshot:fromTab"; tabId: number }
  | { type: "open:onboard"; platform?: Platform; profileId?: string }
  | { type: "extract:run"; platform: Platform; profileId: string };

/** Result of an extractor running inside a platform page. */
export interface ExtractResult {
  platform: Platform;
  profileId: string;
  displayName?: string;
  bio?: string;
  items: SnapshotItem[];
  /** True when the page looks like a bot challenge / captcha instead of content. */
  challenged?: boolean;
  /**
   * How many items the platform says exist per category, which can exceed how many it handed us.
   * The gap is what catches a release inserted with an old date, since that never appears in a
   * newest-first window.
   */
  counts?: Record<string, number>;
  /** Total items we actually saw, when the platform only gave us a window of the catalog. */
  partial?: boolean;
}

/** Verdict a consumer overlay renders for one item. */
export interface Verdict {
  status: "verified" | "not_mine" | "unconfirmed" | "likely_accurate";
  listTitle: string;
  listUrl: string;
  creatorProfile?: string;
  disclosure?: Disclosure;
  firstSeen?: string;
  note?: string;
  released?: string;
  baselineBefore?: string;
  /** How this list came to be speaking for the profile. You added it; this says by which route. */
  via?: "own-list" | "self-checked" | "attested" | "community" | "unproved";
  attestedBy?: string;
}
