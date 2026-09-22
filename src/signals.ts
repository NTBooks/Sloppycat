// Heuristic signals attached to alerts. Relative to the creator's own history, never absolute verdicts.
import type { Signal, SnapshotItem } from "./types";
import { isLookalike, similarity } from "./lookalike";

/** DistroKid's auto-assigned placeholder label, e.g. "8412 Records DK". */
export const DISTRIBUTOR_PLACEHOLDER = /\b\d{3,7}\s+Records\s+DK\b/i;

export function normalizeLabel(label: string | undefined): string {
  return (label ?? "")
    .toLowerCase()
    .replace(/^[℗©]\s*\d{4}\s*/u, "") // strip "℗ 2024 " / "© 2024 "
    .replace(/\s+/g, " ")
    .trim();
}

export function knownLabels(history: SnapshotItem[]): string[] {
  const set = new Set<string>();
  for (const i of history) {
    const l = normalizeLabel(i.label);
    if (l) set.add(l);
  }
  return [...set];
}

export function signalsFor(item: SnapshotItem, history: SnapshotItem[]): Signal[] {
  const out: Signal[] = [];
  const label = normalizeLabel(item.label);

  if (label && DISTRIBUTOR_PLACEHOLDER.test(item.label ?? "")) {
    out.push({ kind: "distributor_placeholder", label: item.label! });
  }
  if (label) {
    const known = knownLabels(history.filter((h) => h.itemId !== item.itemId));
    // Only meaningful once the artist has some history; otherwise every label is "first".
    if (known.length >= 2 && !known.includes(label)) {
      out.push({ kind: "first_time_label", label: item.label!, knownLabels: known });
    }
  }
  if (item.platform === "amazon") {
    const pub = (item.label ?? "").toLowerCase();
    const reviews = Number(item.meta?.["reviewCount"] ?? NaN);
    if (pub.includes("independently published") && (reviews === 0 || Number.isNaN(reviews))) {
      out.push({ kind: "indie_zero_reviews" });
    }
  }
  return out;
}

/** For search results: which watched item does this candidate resemble? */
export function lookalikeSignal(candidate: SnapshotItem, watched: SnapshotItem[]): Signal | null {
  let best: { title: string; score: number } | null = null;
  for (const w of watched) {
    if (w.itemId === candidate.itemId) return null; // it's the real thing
    const score = similarity(candidate.title, w.title);
    if (!best || score > best.score) best = { title: w.title, score };
  }
  if (best && isLookalike(candidate.title, best.title)) {
    return { kind: "lookalike", ofTitle: best.title, score: Math.round(best.score * 100) / 100 };
  }
  return null;
}

export function describeSignal(s: Signal): string {
  switch (s.kind) {
    case "distributor_placeholder":
      return `Delivered under a distributor placeholder label (${s.label})`;
    case "first_time_label":
      return `First release on "${s.label}"; catalog is otherwise on ${s.knownLabels.slice(0, 3).join(", ")}`;
    case "indie_zero_reviews":
      return "Independently published with no reviews";
    case "lookalike":
      return `Title resembles "${s.ofTitle}" (${Math.round(s.score * 100)}% match)`;
    case "released_after":
      return `Released after "${s.watchedTitle}" (${s.watchedDate})`;
    case "count_drift":
      return `Spotify counts ${s.added} more ${s.category} than last time, but only ${s.seen} new one${s.seen === 1 ? "" : "s"} are visible in the newest releases`;
  }
}
