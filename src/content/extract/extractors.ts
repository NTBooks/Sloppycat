// DOM extractors. Each takes a Document (live page or DOMParser output) and returns catalog items.
// They run in two places: the hidden-tab content script and the offscreen HTML parser.
import type { ExtractResult, ItemKind, Platform, SnapshotItem } from "../../types";
import { findListUrl, looksLikeAmazonChallenge, textOf } from "../../adapters/shared";

export type Extractor = (doc: Document, url: string, profileId: string, now: string) => ExtractResult;

function abs(base: string, href: string | null | undefined): string {
  try {
    return new URL(href ?? "", base).toString();
  } catch {
    return href ?? "";
  }
}

// ---------- Spotify ----------

function spotifyKind(typeText: string): ItemKind {
  const t = typeText.toLowerCase();
  if (t.includes("single")) return "single";
  if (t.includes("ep")) return "ep";
  if (t.includes("compilation")) return "compilation";
  if (t.includes("appears")) return "appears_on";
  return "album";
}

export const extractSpotify: Extractor = (doc, url, profileId, now) => {
  const items: SnapshotItem[] = [];
  const seen = new Set<string>();
  const isAlbumPage = /\/album\/([A-Za-z0-9]{22})/.test(url);

  if (isAlbumPage) {
    // Album page: title in h1, "© 2024 Label" / "℗ 2024 Label" lines near the bottom.
    const id = /\/album\/([A-Za-z0-9]{22})/.exec(url)![1]!;
    const title = textOf(doc.querySelector("h1"));
    const copyright = [...doc.querySelectorAll("p, span, div")]
      .map((e) => textOf(e))
      .find((t) => /^[℗©]\s*\d{4}/u.test(t));
    const dateText = [...doc.querySelectorAll("span, time")]
      .map((e) => textOf(e))
      .find((t) => /^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(t) || /^\d{4}$/.test(t));
    items.push({
      platform: "spotify",
      itemId: id,
      title,
      kind: "unknown",
      label: copyright?.replace(/^[℗©]\s*\d{4}\s*/u, ""),
      releaseDate: dateText ? new Date(dateText).toISOString().slice(0, 10) : undefined,
      url: `https://open.spotify.com/album/${id}`,
      firstSeen: now,
      source: "profile",
    });
    return { platform: "spotify", profileId, items };
  }

  // DOM fallback when no captured JSON is available. Album links sit in cards whose metadata reads
  // "Album•2025•12 songs" (discography) or "2025 • Album" (search/grid).
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href*="/album/"]')) {
    const m = /\/album\/([A-Za-z0-9]{22})/.exec(a.getAttribute("href") ?? "");
    if (!m || seen.has(m[1]!)) continue;
    let card: Element = a;
    for (let i = 0; i < 8 && card.parentElement; i++) {
      card = card.parentElement;
      if (card.querySelector('[data-testid="release-date"]') || /\d{4}\s*[•·]/.test(textOf(card))) break;
    }
    const title = textOf(a) || a.getAttribute("title") || a.getAttribute("aria-label") || "";
    if (!title) continue;
    const metaText = textOf(card.querySelector('[data-testid="release-date"]')?.parentElement) || textOf(card);
    const kindFirst = /(Album|Single|EP|Compilation)\s*[•·]\s*(\d{4})/i.exec(metaText);
    const yearFirst = /(\d{4})\s*[•·]\s*(Album|Single|EP|Compilation)/i.exec(metaText);
    const year = kindFirst ? [kindFirst[0], kindFirst[2], kindFirst[1]] : yearFirst;
    const img = card.querySelector("img");
    seen.add(m[1]!);
    items.push({
      platform: "spotify",
      itemId: m[1]!,
      title,
      kind: year ? spotifyKind(year[2]!) : "unknown",
      releaseDate: year?.[1],
      url: `https://open.spotify.com/album/${m[1]}`,
      imageUrl: img?.getAttribute("src") ?? undefined,
      firstSeen: now,
      source: "profile",
    });
  }

  const displayName = textOf(doc.querySelector("h1")) || undefined;
  // The bio is user-controlled via Spotify for Artists; scan the visible about text and links.
  const aboutEl =
    doc.querySelector('[data-testid="artist-about"]') ?? doc.querySelector('section[aria-label*="About" i]') ?? doc.body;
  const bioText = [textOf(aboutEl), ...[...doc.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "")].join("\n");
  const listUrl = findListUrl(bioText);
  return { platform: "spotify", profileId, displayName, bio: listUrl ?? undefined, items };
};

// ---------- Amazon ----------

const FORMAT_WORDS =
  /^(Kindle( Edition)?|Hardcover|Paperback|Mass Market Paperback|Audiobook|Audible Audiobook|Audio CD|MP3 CD|Board book|Spiral-bound|Library Binding|Preloaded Digital Audio Player|Leather Bound|Unknown Binding)$/i;

export const extractAmazon: Extractor = (doc, url, profileId, now) => {
  const html = doc.documentElement.outerHTML;
  if (looksLikeAmazonChallenge(html)) return { platform: "amazon", profileId, items: [], challenged: true };

  const items: SnapshotItem[] = [];
  const seen = new Set<string>();
  const isSearch = /\/s\?/.test(url);
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "www.amazon.com";
    }
  })();

  // Store pages (/stores/author/<id>/allbooks): each product card has an overlay link titled with the book.
  for (const ov of doc.querySelectorAll<HTMLAnchorElement>('a[class*="ProductGridItem__overlay"]')) {
    const m = /\/dp\/([A-Z0-9]{10})/.exec(ov.getAttribute("href") ?? "");
    if (!m || seen.has(m[1]!)) continue;
    const title = ov.getAttribute("title") || ov.getAttribute("aria-label") || "";
    if (!title) continue;
    const card = ov.closest('[class*="ProductGridItem__itemOuter"]') ?? ov.parentElement?.parentElement ?? ov;
    const editions = [...card.querySelectorAll<HTMLAnchorElement>('a[class*="other-media-formats"]')]
      .map((a) => /\/dp\/([A-Z0-9]{10})/.exec(a.getAttribute("href") ?? "")?.[1])
      .filter((x): x is string => !!x);
    const reviews = /([\d,]+)\s+customer reviews?/i.exec(textOf(card))?.[1];
    const format = [...card.querySelectorAll("span, div")]
      .map((e) => (e.children.length ? "" : textOf(e)))
      .find((t) => FORMAT_WORDS.test(t));
    seen.add(m[1]!);
    const meta: Record<string, string | number> = {};
    if (reviews) meta["reviewCount"] = Number(reviews.replace(/,/g, ""));
    if (editions.length) meta["editions"] = editions.join(",");
    if (format) meta["format"] = format;
    items.push({
      platform: "amazon",
      itemId: m[1]!,
      title,
      kind: "book",
      url: `https://${host}/dp/${m[1]}`,
      imageUrl: card.querySelector("img")?.getAttribute("src") ?? undefined,
      meta: Object.keys(meta).length ? meta : undefined,
      firstSeen: now,
      source: "profile",
    });
  }

  const cards = items.length ? [] : doc.querySelectorAll<HTMLElement>("div[data-asin]:not([data-asin=''])");
  if (cards.length) {
    for (const card of cards) {
      const asin = card.getAttribute("data-asin")!;
      if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) continue;
      const titleEl = card.querySelector("h2 a span, h2 span, .a-size-medium.a-text-normal, .a-link-normal .a-text-normal");
      const title = textOf(titleEl) || card.querySelector("img")?.getAttribute("alt") || "";
      if (!title) continue;
      const byline = textOf(card.querySelector(".a-row.a-size-base, .a-color-secondary .a-row"));
      const author = /by\s+(.+?)(?:\s*\||$)/i.exec(byline)?.[1]?.trim();
      const reviewsAttr = [...card.querySelectorAll("span[aria-label]")]
        .map((s) => s.getAttribute("aria-label") ?? "")
        .find((l) => /^[\d,]+$/.test(l.replace(/\s.*/, "")));
      const reviewCount = reviewsAttr ? Number(reviewsAttr.replace(/[^\d]/g, "")) : undefined;
      const dateText = [...card.querySelectorAll("span")].map((s) => textOf(s)).find((t) => /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(t));
      const img = card.querySelector("img");
      seen.add(asin);
      items.push({
        platform: "amazon",
        itemId: asin,
        title,
        subtitle: author,
        kind: "book",
        releaseDate: dateText ? new Date(dateText).toISOString().slice(0, 10) : undefined,
        url: `https://www.amazon.com/dp/${asin}`,
        imageUrl: img?.getAttribute("src") ?? undefined,
        meta: reviewCount !== undefined ? { reviewCount } : undefined,
        firstSeen: now,
        source: isSearch ? "search" : "profile",
      });
    }
  }

  // Fallback for layouts without data-asin cards: any /dp/ASIN link with a readable title.
  if (!items.length) {
    for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href*="/dp/"]')) {
      const m = /\/dp\/([A-Z0-9]{10})/.exec(a.getAttribute("href") ?? "");
      if (!m || seen.has(m[1]!)) continue;
      const title = a.getAttribute("title") || a.getAttribute("aria-label") || textOf(a) || a.querySelector("img")?.getAttribute("alt") || "";
      // Skip format links ("Hardcover", "Audiobook") and series links ("Book 1 of 8: Mistborn").
      if (!title || title.length < 2 || FORMAT_WORDS.test(title) || /^(Book \d+ of \d+|Collects books from|Related to):/i.test(title)) continue;
      seen.add(m[1]!);
      items.push({
        platform: "amazon",
        itemId: m[1]!,
        title,
        kind: "book",
        url: `https://www.amazon.com/dp/${m[1]}`,
        imageUrl: a.querySelector("img")?.getAttribute("src") ?? undefined,
        firstSeen: now,
        source: isSearch ? "search" : "profile",
      });
    }
  }

  const displayName = textOf(doc.querySelector("h1")) || undefined;
  const bioEl = doc.querySelector(
    '[class*="AuthorBio__author-bio__author-biography"], [id^="AuthorBio-author-bio-"], [id^="author-biotile-"], #author-bio, .author-bio',
  );
  const bioText = [textOf(bioEl), ...[...doc.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "")].join("\n");
  return { platform: "amazon", profileId, displayName, bio: findListUrl(bioText) ?? undefined, items };
};

// ---------- Goodreads ----------

export const extractGoodreads: Extractor = (doc, url, profileId, now) => {
  const items: SnapshotItem[] = [];
  const seen = new Set<string>();
  const isSearch = /\/search/.test(url);

  for (const row of doc.querySelectorAll("tr[itemtype*='Book'], table.tableList tr")) {
    const link = row.querySelector<HTMLAnchorElement>("a.bookTitle");
    const m = /\/book\/show\/(\d+)/.exec(link?.getAttribute("href") ?? "");
    if (!m || seen.has(m[1]!)) continue;
    const title = textOf(link);
    if (!title) continue;
    const author = textOf(row.querySelector("a.authorName"));
    const grey = textOf(row.querySelector(".greyText.smallText, .uitext"));
    const ratings = /([\d,]+)\s+ratings?/.exec(grey)?.[1]?.replace(/,/g, "");
    const published = /published\s+(\d{4})/i.exec(grey)?.[1];
    const img = row.querySelector("img");
    seen.add(m[1]!);
    items.push({
      platform: "goodreads",
      itemId: m[1]!,
      title,
      subtitle: author || undefined,
      kind: "book",
      releaseDate: published,
      url: `https://www.goodreads.com/book/show/${m[1]}`,
      imageUrl: img?.getAttribute("src") ?? undefined,
      meta: ratings ? { ratingCount: Number(ratings) } : undefined,
      firstSeen: now,
      source: isSearch ? "search" : "profile",
    });
  }

  const displayName =
    textOf(doc.querySelector("h1.authorName")) || textOf(doc.querySelector("a.authorName span[itemprop='name']")) || undefined;
  const bioEl = doc.querySelector('[id^="freeTextauthor"], [id^="freeTextContainerauthor"], .aboutAuthorInfo');
  const bioText = [
    textOf(bioEl),
    ...[...doc.querySelectorAll('[id^="freeTextauthor"] a[href], [id^="freeTextContainerauthor"] a[href], .aboutAuthorInfo a[href], .dataItem a[href]')].map(
      (a) => a.getAttribute("href") ?? "",
    ),
  ].join("\n");
  return { platform: "goodreads", profileId, displayName, bio: findListUrl(bioText) ?? undefined, items };
};

// ---------- Apple Music web (used only for the "snapshot this tab" path; polling uses the JSON API) ----------

export const extractAppleWeb: Extractor = (doc, _url, profileId, now) => {
  const items: SnapshotItem[] = [];
  const seen = new Set<string>();
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href*="/album/"]')) {
    const m = /\/album\/(?:[^/]+\/)?(\d+)/.exec(a.getAttribute("href") ?? "");
    if (!m || seen.has(m[1]!)) continue;
    const title = textOf(a) || a.getAttribute("aria-label") || "";
    if (!title) continue;
    seen.add(m[1]!);
    items.push({
      platform: "apple",
      itemId: m[1]!,
      title,
      kind: "unknown",
      url: `https://music.apple.com/album/${m[1]}`,
      firstSeen: now,
      source: "profile",
    });
  }
  return { platform: "apple", profileId, displayName: textOf(doc.querySelector("h1")) || undefined, items };
};

export const extractors: Partial<Record<Platform, Extractor>> = {
  spotify: extractSpotify,
  amazon: extractAmazon,
  goodreads: extractGoodreads,
  apple: extractAppleWeb,
};
