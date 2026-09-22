// What a subscribed list started, or stopped, saying between two fetches.
//
// A list is the revocation channel and the publication channel at once: a creator edits the file and
// every subscriber has the new version on the next refresh. Until now nobody was told. This keeps a
// changelog of the rows that appeared and disappeared, which is what makes an artist confirming a new
// release reach the people who subscribed to them, and what makes a list that goes bad noticeable
// before it has been quietly marking things for a month.
import type { ListChange, ListDocument, Platform } from "../types";
import * as storage from "../storage";

/** Newest first, and this many kept. Old entries fall off the end. */
export const MAX_CHANGES = 500;

export type ListChangeSeed = Omit<ListChange, "id" | "at" | "seen">;

const rowKey = (r: { platform: Platform; id: string }) => `${r.platform}:${r.id}`;

/**
 * Rows that appeared in `Mine` or `Not mine`, and rows that left `Not mine`.
 *
 * A row moving from `Not mine` to `Mine` reads as one thing, not two: the creator decided it was
 * theirs after all, so it counts as verified and no retraction is reported for it.
 */
export function changesBetween(source: string, prev: ListDocument, next: ListDocument): ListChangeSeed[] {
  const prevMine = new Set(prev.mine.map(rowKey));
  const prevNotMine = new Set(prev.notMine.map(rowKey));
  const nextMine = new Set(next.mine.map(rowKey));
  const nextNotMine = new Set(next.notMine.map(rowKey));

  const profileFor = (p: Platform) => next.creator.find((c) => c.platform === p)?.profile;
  const base = { source, listTitle: next.title, listType: next.type };
  const out: ListChangeSeed[] = [];

  for (const r of next.mine) {
    if (prevMine.has(rowKey(r))) continue;
    out.push({
      ...base,
      kind: "verified",
      platform: r.platform,
      itemId: r.id,
      title: r.title || r.id,
      creatorProfile: profileFor(r.platform),
      disclosure: r.disclosure,
    });
  }
  for (const r of next.notMine) {
    if (prevNotMine.has(rowKey(r))) continue;
    out.push({
      ...base,
      kind: "flagged",
      platform: r.platform,
      itemId: r.id,
      title: r.title || r.id,
      creatorProfile: profileFor(r.platform),
      note: r.note,
    });
  }
  for (const r of prev.notMine) {
    const k = rowKey(r);
    if (nextNotMine.has(k) || nextMine.has(k)) continue;
    out.push({
      ...base,
      kind: "retracted",
      platform: r.platform,
      itemId: r.id,
      title: r.title || r.id,
      creatorProfile: profileFor(r.platform),
      note: r.note,
    });
  }
  return out;
}

/**
 * Diff a fetch against what was cached and write the result to the changelog.
 *
 * The first fetch of a source is the baseline: a list you just added is not news, however much it
 * says. Returns what was recorded, so the caller can decide whether it is worth a notification.
 */
export async function recordChanges(
  source: string,
  prev: ListDocument | undefined,
  next: ListDocument,
  at = new Date().toISOString(),
): Promise<ListChange[]> {
  if (!prev) return [];
  const seeds = changesBetween(source, prev, next);
  if (!seeds.length) return [];
  const entries: ListChange[] = seeds.map((s) => ({ ...s, id: crypto.randomUUID(), at, seen: false }));
  await storage.update("listChanges", (cur) => [...entries, ...cur].slice(0, MAX_CHANGES));
  return entries;
}

export async function unseenCount(): Promise<number> {
  return (await storage.get("listChanges")).filter((c) => !c.seen).length;
}

export async function markAllSeen(): Promise<void> {
  await storage.update("listChanges", (cur) => (cur.some((c) => !c.seen) ? cur.map((c) => ({ ...c, seen: true })) : cur));
}

export async function forgetSource(source: string): Promise<void> {
  await storage.update("listChanges", (cur) => cur.filter((c) => c.source !== source));
}

export const CHANGE_LABEL: Record<ListChange["kind"], string> = {
  verified: "Confirmed by the creator",
  flagged: "Flagged as not theirs",
  retracted: "No longer flagged",
};

/** One notification for a whole refresh, rather than one per row. */
export function summarize(changes: ListChange[]): { title: string; message: string } {
  if (changes.length === 1) {
    const c = changes[0]!;
    const title =
      c.kind === "verified"
        ? "A release was confirmed"
        : c.kind === "flagged"
          ? "A release was flagged as fake"
          : "A release is no longer flagged";
    return { title, message: `"${c.title}" · ${c.listTitle}` };
  }
  const n = (k: ListChange["kind"]) => changes.filter((c) => c.kind === k).length;
  const parts = [
    [n("verified"), "confirmed"],
    [n("flagged"), "flagged"],
    [n("retracted"), "un-flagged"],
  ]
    .filter(([count]) => (count as number) > 0)
    .map(([count, word]) => `${count} ${word}`);
  const lists = [...new Set(changes.map((c) => c.listTitle))];
  const from = lists.length <= 2 ? lists.join(" and ") : `${lists.length} lists you subscribe to`;
  return { title: `${changes.length} updates from your lists`, message: `${parts.join(", ")} · ${from}` };
}
