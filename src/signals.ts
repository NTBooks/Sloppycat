// Heuristic signals attached to alerts. Relative to the creator's own history, never absolute verdicts.
import type { Signal, SnapshotItem } from "./types";
import { isCompanionTitle, isLookalike, similarity } from "./lookalike";

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

/** Loose name match, for deciding whether two rows are by the same person. */
export function sameCreator(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const norm = (x: string) =>
    x
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, "and")
      .replace(/^(the|a|an)\s+/, "")
      .replace(/[^a-z0-9]+/g, "");
  const na = norm(a);
  const nb = norm(b);
  return !!na && na === nb;
}

/**
 * For search results: which watched item does this candidate resemble?
 *
 * @param creator the watched profile's own name and id. A record by the same artist is not a
 *   lookalike of itself, and the same album routinely appears in search under a second id for a
 *   different market or remaster, so matching on the item id alone lets an artist's own catalogue
 *   come back as a 100% match against itself.
 */
export function lookalikeSignal(
  candidate: SnapshotItem,
  watched: SnapshotItem[],
  creator?: { name?: string; id?: string },
): Signal | null {
  if (creator) {
    const candidateArtistId = (candidate.meta as { artistId?: string } | undefined)?.artistId;
    if (creator.id && candidateArtistId && candidateArtistId === creator.id) return null;
    if (sameCreator(candidate.subtitle, creator.name)) return null;
  }
  let best: { title: string; score: number } | null = null;
  for (const w of watched) {
    if (w.itemId === candidate.itemId) return null; // it's the real thing
    const score = similarity(candidate.title, w.title);
    if (!best || score > best.score) best = { title: w.title, score };
  }
  if (best && isLookalike(candidate.title, best.title)) {
    // Say which rule caught it. A companion title can sit below the score threshold and still be
    // the clearest case there is, and "80% match" would not explain why it is here.
    const companion = isCompanionTitle(candidate.title, best.title);
    return { kind: "lookalike", ofTitle: best.title, score: Math.round(best.score * 100) / 100, companion };
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
      return s.companion
        ? `Keeps your title "${s.ofTitle}" whole and adds the wording a summary or study-guide edition uses`
        : `Title resembles "${s.ofTitle}" (${Math.round(s.score * 100)}% match)`;
    case "released_after":
      return `Released after "${s.watchedTitle}" (${s.watchedDate})`;
    case "count_drift":
      return `Spotify counts ${s.added} more ${s.category} than last time, but only ${s.seen} new one${s.seen === 1 ? "" : "s"} are visible in the newest releases`;
  }
}
