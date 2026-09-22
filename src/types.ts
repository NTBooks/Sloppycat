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
  /**
   * Someone else's page, followed as a fan. There is nothing here to claim and no list to publish:
   * the point is being told when something new turns up, and what the artist's own list says about it.
   */
  watchOnly?: boolean;
}

export interface Snapshot {
  profileKey: string; // platform:profileId
  takenAt: string;
  items: SnapshotItem[];
  /** Per-category totals the platform reported at that time. */
  counts?: Record<string, number>;
}

/**
 * What the run loop is doing, so a click on "Check now" visibly does something. Lives in storage
 * rather than memory because the page asking is not the worker doing the work, and Chrome may
 * restart that worker mid-run.
 */
export interface RunLogEntry {
  at: string;
  text: string;
  /** Marks the lines worth colouring: something went wrong, or the user stopped it. */
  bad?: boolean;
}

/** Enough log to explain the run without turning the popup into a scrollback buffer. */
export const MAX_RUN_LOG = 50;

export interface RunState {
  startedAt: string;
  /** Profile keys this run will visit, in order. */
  queue: string[];
  /** How many of them are finished. */
  done: number;
  /** The profile being checked right now, and what is happening to it. */
  currentKey?: string;
  currentLabel?: string;
  phase?: string;
  /** Bumped on every step, so a long run stays live and a dead one does not. */
  beatAt?: string;
  /**
   * What the check has done so far, newest last. This is the whole point of the status panel: a
   * window opening with no explanation gets closed, and a running commentary is the explanation.
   */
  log: RunLogEntry[];
  /** Set when the run ends, whether it finished or was interrupted. */
  endedAt?: string;
}

/**
 * How long a run may go without progress before it is treated as over. Measured from the last step,
 * not from the start: a big catalogue legitimately takes a while, and timing a real run out would
 * mean the UI contradicting the worker. The worker can be killed mid-run without getting to write
 * endedAt, and a Check button stuck on "Checking..." forever is worse than one that recovers late.
 *
 * The worst honest gap between steps is one profile: an Amazon snapshot, its bio page and a
 * lookalike search, each of which can take the better part of a minute.
 */
export const RUN_STALE_MS = 5 * 60 * 1000;

export function isRunning(r: RunState | null | undefined): boolean {
  if (!r || r.endedAt) return false;
  return Date.now() - Date.parse(r.beatAt ?? r.startedAt) < RUN_STALE_MS;
}

export type Signal =
  | { kind: "first_time_label"; label: string; knownLabels: string[] }
  | { kind: "distributor_placeholder"; label: string }
  | { kind: "indie_zero_reviews" }
  | { kind: "lookalike"; ofTitle: string; score: number; companion?: boolean }
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
  /**
   * Search the platform for titles resembling the ones you watch, beyond the profile page itself.
   * Guesswork by construction: it reads titles, not provenance, so most of what it turns up is a
   * coincidence rather than a hijack.
   */
  lookalikeSearch: boolean;
}

export const DEFAULT_EXPERIMENTS: Experiments = { blocker: false, blockFlagged: false, slopscan: false, lookalikeSearch: false };

export interface Settings {
  mode: "creator" | "consumer" | "both";
  intervalMinutes: number; // >= 15
  lookalikeEveryNRuns: number;
  notifications: boolean;
  /** Also notify when a list you subscribe to starts (or stops) asserting something. */
  listUpdates: boolean;
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
  listUpdates: true,
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
  | { type: "profile:add"; url: string; watchOnly?: boolean }
  | { type: "profile:watchOnly"; profileKey: string; watchOnly: boolean }
  /** Read a bio the caller already has for a list the artist publishes, and subscribe if it checks out. */
  | { type: "list:fromBio"; profileKey: string; bio?: string }
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
  | { type: "dev:simulate"; kind: "new" | "lookalike" | "drift" | "listupdate"; profileKey?: string }
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

/**
 * One thing a subscribed list started, or stopped, saying since the last time it was fetched.
 * The changelog these build up is the only way to notice a list that has gone bad, and the only
 * way a listener hears that an artist confirmed something new without opening the page.
 */
export interface ListChange {
  id: string;
  at: string; // ISO datetime of the fetch that saw it
  source: string; // list URL
  listTitle: string;
  listType: "creator" | "community";
  /** verified: appeared in Mine. flagged: appeared in Not mine. retracted: left Not mine. */
  kind: "verified" | "flagged" | "retracted";
  platform: Platform;
  itemId: string;
  title: string;
  /** The creator profile this list names for that platform, when it names one. */
  creatorProfile?: string;
  disclosure?: Disclosure;
  note?: string;
  seen: boolean;
}
