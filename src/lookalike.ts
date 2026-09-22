// Title/name similarity for clones: near-identical titles on a different page.

const STOP = new Set(["the", "a", "an", "of", "and", "&", "to", "in", "on", "for", "vol", "volume", "edition", "book"]);

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ") // drop parentheticals like (Deluxe), [Kindle Edition]
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return normalizeTitle(s)
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}

/** Blend of containment and Jaccard over token sets, in [0,1]. */
export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  // Containment dominates, but only in the clone's direction: a fake ADDS words to the real title, as in
  // "The Long Field: Summary & Analysis" around "The Long Field". The reverse says nothing -- a candidate
  // that is merely a subset of a watched title is usually a different work sharing a common phrase
  // ("Birthday Boy" inside "Bunky Becky Birthday Boy") -- so it scores on overlap alone and stays quiet.
  const candidateContainsWatched = inter === tb.size;
  const jaccard = inter / union;
  return candidateContainsWatched ? 0.7 + 0.3 * jaccard : jaccard;
}

/** Levenshtein on normalized strings, as a similarity ratio in [0,1]. */
export function editSimilarity(a: string, b: string): number {
  const s = normalizeTitle(a);
  const t = normalizeTitle(b);
  if (!s.length && !t.length) return 1;
  const m = s.length;
  const n = t.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  const dist = prev[n]!;
  return 1 - dist / Math.max(m, n);
}

export function similarity(a: string, b: string): number {
  return Math.max(tokenSetRatio(a, b), editSimilarity(a, b));
}

/**
 * Whether the platform credits a search hit to the same name as the profile being watched. When it does,
 * the hit is that artist's own release under a second id -- market and deluxe editions each get one -- and
 * not somebody trading on their name, so it is never a lookalike however well the titles match.
 */
export function sameCredit(candidateCredit: string | undefined, profileName: string | undefined): boolean {
  const a = normalizeTitle(candidateCredit ?? "");
  const b = normalizeTitle(profileName ?? "");
  return a.length > 0 && a === b;
}

export const DEFAULT_LOOKALIKE_THRESHOLD = 0.82;

export function isLookalike(candidate: string, watched: string, threshold = DEFAULT_LOOKALIKE_THRESHOLD): boolean {
  if (normalizeTitle(candidate) === normalizeTitle(watched)) return true;
  return similarity(candidate, watched) >= threshold;
}
