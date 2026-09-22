// Diff two snapshots of the same profile.
import type { SnapshotItem } from "./types";
import { itemKey } from "./types";

export interface SnapshotDiff {
  added: SnapshotItem[];
  removed: SnapshotItem[];
  changed: { before: SnapshotItem; after: SnapshotItem; fields: string[] }[];
}

const COMPARE_FIELDS: (keyof SnapshotItem)[] = ["title", "subtitle", "releaseDate", "label", "kind"];

export function diffSnapshots(before: SnapshotItem[], after: SnapshotItem[]): SnapshotDiff {
  const prev = new Map(before.map((i) => [itemKey(i), i]));
  const next = new Map(after.map((i) => [itemKey(i), i]));
  const added: SnapshotItem[] = [];
  const removed: SnapshotItem[] = [];
  const changed: SnapshotDiff["changed"] = [];

  for (const [k, item] of next) {
    const old = prev.get(k);
    if (!old) {
      added.push(item);
      continue;
    }
    const fields = COMPARE_FIELDS.filter((f) => String(old[f] ?? "") !== String(item[f] ?? ""));
    if (fields.length) changed.push({ before: old, after: item, fields });
  }
  for (const [k, item] of prev) {
    if (!next.has(k)) removed.push(item);
  }
  return { added, removed, changed };
}
