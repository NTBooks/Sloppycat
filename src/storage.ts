// Thin typed wrapper over chrome.storage.local.
import type { Alert, ListDocument, ListSource, Platform, Profile, Settings, Snapshot } from "./types";
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
  claims: Record<string, Claim>; // by "<list url>|<platform>"
  /** The creator's own list, kept locally so decisions survive before publishing. */
  myList: ListDocument | null;
  runCounter: number;
}

const DEFAULTS: Schema = {
  settings: DEFAULT_SETTINGS,
  profiles: {},
  snapshots: {},
  alerts: {},
  listSources: [],
  listCache: {},
  claims: {},
  myList: null,
  runCounter: 0,
};

export async function get<K extends keyof Schema>(key: K): Promise<Schema[K]> {
  const res = await chrome.storage.local.get(key);
  const v = res[key];
  if (key === "settings") return { ...DEFAULT_SETTINGS, ...(v ?? {}) } as Schema[K];
  return (v ?? DEFAULTS[key]) as Schema[K];
}

export async function set<K extends keyof Schema>(key: K, value: Schema[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function update<K extends keyof Schema>(key: K, fn: (cur: Schema[K]) => Schema[K]): Promise<Schema[K]> {
  const cur = await get(key);
  const next = fn(cur);
  await set(key, next);
  return next;
}

export function onChange(keys: (keyof Schema)[], cb: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && keys.some((k) => k in changes)) cb();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
