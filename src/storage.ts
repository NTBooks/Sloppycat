// Thin typed wrapper over chrome.storage.local.
import type { Alert, ListChange, ListDocument, ListSource, Profile, RunState, Settings, Snapshot } from "./types";
import type { Claim } from "./lists/claims";
import { DEFAULT_SETTINGS } from "./types";

export interface CachedList {
  source: string;
  doc: ListDocument;
  fetchedAt: string;
  etag?: string;
}

export interface Schema {
  settings: Settings;
  profiles: Record<string, Profile>; // by profileKey
  snapshots: Record<string, Snapshot>; // by profileKey
  alerts: Record<string, Alert>; // by alert id
  listSources: ListSource[];
  listCache: Record<string, CachedList>; // by source url
  /** What subscribed lists changed, newest first. Capped; see lists/changes.ts. */
  listChanges: ListChange[];
  claims: Record<string, Claim>; // by "<list url>|<platform>"
  /** The creator's own list, kept locally so decisions survive before publishing. */
  myList: ListDocument | null;
  runCounter: number;
  /** Progress of the check currently running, for the popup and settings to show. */
  runState: RunState | null;
}

const DEFAULTS: Schema = {
  settings: DEFAULT_SETTINGS,
  profiles: {},
  snapshots: {},
  alerts: {},
  listSources: [],
  listCache: {},
  listChanges: [],
  claims: {},
  myList: null,
  runCounter: 0,
  runState: null,
};

export async function get<K extends keyof Schema>(key: K): Promise<Schema[K]> {
  const res = await chrome.storage.local.get(key);
  const v = res[key];
  if (key === "settings") {
    const s = (v ?? {}) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...s, experiments: { ...DEFAULT_SETTINGS.experiments, ...(s.experiments ?? {}) } } as Schema[K];
  }
  return (v ?? DEFAULTS[key]) as Schema[K];
}

/** Replace a value. Takes its turn behind any update to the same key, so it is never undone by one. */
export async function set<K extends keyof Schema>(key: K, value: Schema[K]): Promise<void> {
  await update(key, () => value);
}

/**
 * Updates still queued or running, per key. A read-modify-write is two awaits apart, so two updates
 * to one key in the same context could both read the old value and the second would throw the
 * first away; the worker does exactly that, logging while it records a result. Chaining them per key
 * makes each one see the last. Across contexts, keys the worker writes are written by it alone: pages
 * send a message instead.
 */
const pending = new Map<keyof Schema, Promise<unknown>>();

export function update<K extends keyof Schema>(key: K, fn: (cur: Schema[K]) => Schema[K]): Promise<Schema[K]> {
  const run = async () => {
    const next = fn(await get(key));
    await chrome.storage.local.set({ [key]: next });
    return next;
  };
  const prev = pending.get(key) ?? Promise.resolve();
  const job = prev.then(run, run);
  const tail = job.catch(() => undefined);
  pending.set(key, tail);
  void tail.then(() => {
    if (pending.get(key) === tail) pending.delete(key);
  });
  return job;
}

export function onChange(keys: (keyof Schema)[], cb: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && keys.some((k) => k in changes)) cb();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
