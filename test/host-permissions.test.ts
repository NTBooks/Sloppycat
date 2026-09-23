import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../manifest.json"), "utf8")) as {
  host_permissions: string[];
  content_scripts: { js: string[]; matches: string[] }[];
};

/** Chrome's match-pattern semantics, enough of them to tell reachable from unreachable. */
function matcher(pattern: string): RegExp {
  const [scheme, rest] = pattern.split("://");
  const slash = rest!.indexOf("/");
  const host = rest!.slice(0, slash);
  const path = rest!.slice(slash);
  const esc = (x: string) => x.replace(/[.+?^${}()|[\\]\\]/g, "\\$&");
  return new RegExp(`^${scheme}://${esc(host).replace(/\*/g, "[^/]*")}${esc(path).replace(/\*/g, ".*")}$`);
}

const reaches = (patterns: string[], url: string) => patterns.map(matcher).some((r) => r.test(url));
const hosts = manifest.host_permissions;
const overlay = manifest.content_scripts.find((c) => c.js.includes("content/overlay.js"))!.matches;

describe("host permissions reach what the adapters ask for", () => {
  it.each([
    "https://www.amazon.com/stores/author/B000AQ0842/allbooks",
    "https://www.amazon.com/stores/author/B000AQ0842/about",
    "https://www.amazon.co.uk/stores/author/B0/allbooks",
    "https://www.amazon.com/s?k=Texis",
    "https://www.goodreads.com/author/list/38550?page=1&per_page=30",
    "https://www.goodreads.com/author/show/38550",
    "https://www.goodreads.com/search?q=x&search_type=books",
    "https://open.spotify.com/artist/abc/discography/all",
    "https://api-partner.spotify.com/pathfinder/v1/query",
    "https://itunes.apple.com/lookup?id=1&entity=album",
    "https://api.deezer.com/artist/1/albums?limit=100",
    "https://www.googleapis.com/books/v1/volumes?q=x",
    "https://raw.githubusercontent.com/a/b/main/sloppycat.md",
  ])("reaches %s", (url) => {
    expect(reaches(hosts, url)).toBe(true);
  });
});

describe("host permissions stop at the catalogue", () => {
  // The whole reason for narrowing: amazon.com/* is read-and-change on the cart, the order
  // history and the stored payment methods, none of which this has any business seeing.
  it.each([
    "https://www.amazon.com/gp/cart/view.html",
    "https://www.amazon.com/gp/css/order-history",
    "https://www.amazon.com/cpe/yourpayments/wallet",
    "https://www.amazon.com/gp/buy/spc/handlers/display.html",
    "https://www.amazon.co.uk/gp/css/homepage.html",
    "https://www.goodreads.com/user/edit",
    "https://www.goodreads.com/review/list/123",
  ])("cannot reach %s", (url) => {
    expect(reaches(hosts, url)).toBe(false);
  });

  it("asks for nothing it never fetches", () => {
    expect(hosts.some((h) => h.includes("openlibrary"))).toBe(false);
    expect(hosts.some((h) => h.includes("www.deezer.com"))).toBe(false);
  });
});

describe("the overlay runs on item pages but not on account pages", () => {
  it.each([
    "https://www.amazon.com/dp/B0FAKE0001",
    "https://www.amazon.com/gp/product/B0FAKE0001",
    "https://www.amazon.com/Some-Name/e/B000AQ0842",
    "https://www.goodreads.com/book/show/123",
  ])("marks %s", (url) => {
    expect(reaches(overlay, url)).toBe(true);
  });

  it("is not injected into a cart", () => {
    expect(reaches(overlay, "https://www.amazon.com/gp/cart/view.html")).toBe(false);
  });
});
