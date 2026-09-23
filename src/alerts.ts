// Keeping the alert store to a size that stays cheap to rewrite.
import type { Alert } from "./types";
import * as storage from "./storage";

/**
 * How long a resolved alert is kept. Long enough that a dismissed lookalike does not come straight
 * back on the next search, which is what the stored alerts are also used for; after that, one that
 * turns up again is worth a second look anyway.
 */
export const RESOLVED_KEEP_MS = 180 * 24 * 3600 * 1000;
/** At most this many resolved alerts, newest kept. Unresolved ones are never dropped. */
export const MAX_RESOLVED = 500;

/**
 * Drop resolved alerts that are old, or past the cap. An unresolved alert is something the user has
 * not seen to yet, so it stays whatever its age.
 */
export function pruneAlerts(all: Record<string, Alert>, now = Date.now()): Record<string, Alert> {
  const resolved = Object.values(all)
    .filter((a) => a.resolution)
    .sort((a, b) => Date.parse(b.resolvedAt ?? b.createdAt) - Date.parse(a.resolvedAt ?? a.createdAt));
  const keep = new Set(
    resolved
      .filter((a) => now - Date.parse(a.resolvedAt ?? a.createdAt) < RESOLVED_KEEP_MS)
      .slice(0, MAX_RESOLVED)
      .map((a) => a.id),
  );
  const out: Record<string, Alert> = {};
  for (const [id, a] of Object.entries(all)) if (!a.resolution || keep.has(id)) out[id] = a;
  return out;
}

/** Store new alerts, pruning as it goes so the store never only grows. */
export async function addAlerts(alerts: Alert[]): Promise<void> {
  await storage.update("alerts", (all) => {
    const next = { ...all };
    for (const a of alerts) next[a.id] = a;
    return pruneAlerts(next);
  });
}

/**
 * Is `date` the same as or later than `than`, at the precision both have? Release dates arrive as a
 * full date on some platforms and a bare year on others, and compared as text "2024" sorts before
 * "2024-06-01", which read a release from the newest known year as older than the newest known one.
 */
export function sameReleaseDateOrLater(date: string, than: string): boolean {
  const n = Math.min(date.length, than.length);
  return date.slice(0, n) >= than.slice(0, n);
}
