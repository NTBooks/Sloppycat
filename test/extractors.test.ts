// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractAmazon, extractGoodreads, extractSpotify } from "../src/content/extract/extractors";
import { parseSpotifyCaptures } from "../src/adapters/spotify-json";

const fx = (name: string) => readFileSync(resolve(__dirname, "fixtures", name), "utf8");
const now = "2026-09-22T00:00:00.000Z";
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("Goodreads (real page, 2026-09-22)", () => {
  it("extracts all 30 rows from an author list page", () => {
    const r = extractGoodreads(parse(fx("goodreads-list.html")), "https://www.goodreads.com/author/list/38550", "38550", now);
    expect(r.items).toHaveLength(30);
    const first = r.items[0]!;
    expect(first.itemId).toMatch(/^\d+$/);
    expect(first.title.length).toBeGreaterThan(2);
    expect(first.subtitle).toBe("Brandon Sanderson");
    expect(first.releaseDate).toMatch(/^\d{4}$/);
    expect(Number(first.meta?.["ratingCount"])).toBeGreaterThan(1000);
    expect(r.items.every((i) => i.url.startsWith("https://www.goodreads.com/book/show/"))).toBe(true);
  });

  it("reads the author name and bio container from the show page", () => {
    const doc = parse(fx("goodreads-show.html"));
    const r = extractGoodreads(doc, "https://www.goodreads.com/author/show/38550", "38550", now);
    expect(r.displayName).toBe("Brandon Sanderson");
    expect(r.bio).toBeUndefined(); // no list link in his bio
    // Inject a list link into the real bio element to prove it is the one being read.
    doc.querySelector('[id^="freeTextauthor"]')!.append(" Catalog: https://gist.github.com/bsanderson/abcdef0123456789abcd");
    const r2 = extractGoodreads(doc, "https://www.goodreads.com/author/show/38550", "38550", now);
    expect(r2.bio).toBe("https://gist.githubusercontent.com/bsanderson/abcdef0123456789abcd/raw");
  });
});

describe("Amazon store allbooks grid", () => {
  const r = extractAmazon(parse(fx("amazon-allbooks.html")), "https://www.amazon.com/stores/author/B001IGFHW6/allbooks", "www.amazon.com|B001IGFHW6", now);

  it("takes titles from the overlay link and skips format and series links", () => {
    expect(r.items.map((i) => i.itemId)).toEqual(["B002GYI9C4", "B003P2WO5E", "B0FAKE0001"]);
    expect(r.items[0]!.title).toBe("Mistborn: The Final Empire");
    expect(r.items.some((i) => /Hardcover|Audiobook|Book 1 of/.test(i.title))).toBe(false);
  });

  it("records edition ASINs, review counts and format", () => {
    expect(r.items[0]!.meta).toMatchObject({ reviewCount: 60618, editions: "B001QKBHG4,076531178X,1250868289", format: "Kindle Edition" });
    expect(r.items[2]!.meta).toMatchObject({ format: "Paperback" });
    expect(r.items[2]!.meta?.["reviewCount"]).toBeUndefined();
  });

  it("reads the full bio on the about page", () => {
    const about = parse(
      `<h1>Jane Doe</h1><div id="AuthorBio-author-bio-B0X"><div class="AuthorBio__author-bio__author-biography__WeqwH">I write books. My catalog: https://raw.githubusercontent.com/jd/site/main/sloppycat.md</div></div>`,
    );
    const b = extractAmazon(about, "https://www.amazon.com/stores/author/B0X/about", "www.amazon.com|B0X", now);
    expect(b.bio).toBe("https://raw.githubusercontent.com/jd/site/main/sloppycat.md");
  });

  it("flags the robot check page as challenged", () => {
    const c = extractAmazon(parse("<title>Robot Check</title><p>Type the characters you see in this image</p>"), "https://www.amazon.com/x", "x", now);
    expect(c.challenged).toBe(true);
  });
});

describe("Spotify artist overview JSON", () => {
  const caps = [JSON.parse(fx("spotify-overview.json"))];
  const r = parseSpotifyCaptures(caps, "3yY2gUcIsjMr8hjo51PoJ8", now);

  it("extracts albums, singles, compilations and appears-on with labels and dates", () => {
    const byId = Object.fromEntries(r.items.map((i) => [i.itemId, i]));
    expect(r.displayName).toBe("The Smiths");
    expect(byId["06Ey2y54V4aGjP5EsovA2O"]).toMatchObject({ kind: "album", releaseDate: "1988-09-05", label: "WM UK" });
    expect(byId["7vPpqwmOjiI3CQ7buL9e3J"]!.releaseDate).toBe("1992");
    expect(byId["9xYcdefghijklmnopqrstu"]).toMatchObject({ kind: "single", label: "8412 Records DK" });
    expect(byId["30g571JKoxs8AnsgAViV2J"]!.kind).toBe("compilation");
    expect(byId["2n5AOB0lGse7qp38HvVROB"]).toMatchObject({ kind: "appears_on", subtitle: "Various Artists" });
  });

  it("ignores top tracks and finds the list link inside the HTML bio", () => {
    expect(r.items.find((i) => i.itemId === "0000000000000000000000")).toBeUndefined();
    expect(r.bio).toBe("https://gist.githubusercontent.com/thesmiths/0123456789abcdef0123/raw");
  });

  it("ignores captures for a different artist in the same tab", () => {
    expect(parseSpotifyCaptures(caps, "4Z8W4fKeB5YxbusRsdQVPb", now).items).toHaveLength(0);
  });
});

describe("Spotify DOM fallback", () => {
  it("handles the 'Album•2025•12 songs' metadata order", () => {
    const html = `<main><div><div><a href="/album/5BLrEOEDKoDDg5T8PzdIHN">Hail to the Thief (Live Recordings 2003-2009)</a></div><div><span>Album</span>•<span data-testid="release-date">2025</span>•<span>12 songs</span></div></div></main>`;
    const r = extractSpotify(parse(html), "https://open.spotify.com/artist/x/discography/all", "x", now);
    expect(r.items[0]).toMatchObject({ itemId: "5BLrEOEDKoDDg5T8PzdIHN", kind: "album", releaseDate: "2025" });
  });
});
