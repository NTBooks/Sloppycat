import { describe, expect, it } from "vitest";
import { detectProfile, adapters } from "../src/adapters";
import { findListUrl, normalizeListUrl, looksLikeAmazonChallenge } from "../src/adapters/shared";
import { sameProfile } from "../src/lists/sources";
import { buildPacket, packetAsText } from "../src/remediation/packets";
import { toUblockFilters } from "../src/lists/export-ublock";
import type { SnapshotItem } from "../src/types";

describe("detectProfile", () => {
  it.each([
    ["https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb?si=abc", "spotify", "4Z8W4fKeB5YxbusRsdQVPb"],
    ["https://open.spotify.com/intl-de/artist/4Z8W4fKeB5YxbusRsdQVPb", "spotify", "4Z8W4fKeB5YxbusRsdQVPb"],
    ["https://music.apple.com/us/artist/radiohead/657515", "apple", "657515"],
    ["https://www.deezer.com/en/artist/399", "deezer", "399"],
    ["https://www.amazon.com/stores/Jane-Friedman/author/B001H6IIS6", "amazon", "www.amazon.com|B001H6IIS6"],
    ["https://www.amazon.co.uk/Jane-Friedman/e/B001H6IIS6", "amazon", "www.amazon.co.uk|B001H6IIS6"],
    ["https://www.goodreads.com/author/show/1234.Jane_Doe", "goodreads", "1234"],
  ])("%s", (url, platform, id) => {
    expect(detectProfile(url)).toMatchObject({ platform, profileId: id });
  });

  it("returns null for item pages", () => {
    expect(detectProfile("https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy")).toBeNull();
  });
});

describe("parseItemUrl", () => {
  it("extracts item ids per platform", () => {
    expect(adapters.spotify.parseItemUrl("https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy")).toBe("4aawyAB9vmqN3uQ7FjRGTy");
    expect(adapters.apple.parseItemUrl("https://music.apple.com/us/album/ok-computer/1097861387")).toBe("1097861387");
    expect(adapters.amazon.parseItemUrl("https://www.amazon.com/Long-Field-Novel/dp/B0C1234567/ref=x")).toBe("B0C1234567");
    expect(adapters.goodreads.parseItemUrl("https://www.goodreads.com/book/show/5907.The_Hobbit")).toBe("5907");
  });
});

describe("list URL discovery", () => {
  it("finds gist and raw links in bio text", () => {
    expect(findListUrl("Official catalog: https://gist.github.com/janedoe/0123456789abcdef0123. Thanks!")).toBe(
      "https://gist.githubusercontent.com/janedoe/0123456789abcdef0123/raw",
    );
    expect(findListUrl("see https://raw.githubusercontent.com/jd/site/main/sloppycat.md")).toBe("https://raw.githubusercontent.com/jd/site/main/sloppycat.md");
    expect(findListUrl("sloppycat:0123456789abcdef0123456789abcdef")).toMatch(/gist\.githubusercontent\.com/);
    expect(findListUrl("no links here")).toBeNull();
  });
  it("normalizes blob URLs to raw", () => {
    expect(normalizeListUrl("https://github.com/jd/site/blob/main/sloppycat.md")).toBe("https://raw.githubusercontent.com/jd/site/main/sloppycat.md");
  });
  it("matches profiles across URL variants", () => {
    expect(sameProfile("https://open.spotify.com/artist/abc", "https://open.spotify.com/intl-fr/artist/abc?si=1")).toBe(true);
    expect(sameProfile("https://open.spotify.com/artist/abc", "https://open.spotify.com/artist/xyz")).toBe(false);
  });
});

describe("amazon challenge detection", () => {
  it("recognizes the robot check page", () => {
    expect(looksLikeAmazonChallenge("<title>Robot Check</title>")).toBe(true);
    expect(looksLikeAmazonChallenge("<p>email api-services-support@amazon.com</p>")).toBe(true);
    expect(looksLikeAmazonChallenge("<title>Amazon.com: Books</title>")).toBe(false);
  });
});

const fake: SnapshotItem = {
  platform: "spotify",
  itemId: "9xYcdefghijklmnopqrstu",
  title: "Midnight Jazz Vibes",
  kind: "single",
  label: "8412 Records DK",
  url: "https://open.spotify.com/album/9xYcdefghijklmnopqrstu",
  firstSeen: "2026-09-14T00:00:00Z",
  source: "profile",
};

describe("packets", () => {
  it("builds a Spotify packet that asks for UPC and warns against re-uploading", () => {
    const p = buildPacket({ item: fake, creatorName: "Jane Doe", correctProfileUrl: "https://open.spotify.com/artist/real" });
    const t = packetAsText(p);
    expect(t).toContain("Report incorrect release");
    expect(t).toContain("UPC");
    expect(t).toContain("https://open.spotify.com/artist/real");
    expect(t).toMatch(/Do not delete or re-upload/);
  });
  it("routes Amazon by situation", () => {
    const book: SnapshotItem = { ...fake, platform: "amazon", itemId: "B0FAKE0001", kind: "book", url: "https://www.amazon.com/dp/B0FAKE0001" };
    expect(buildPacket({ item: book, situation: "on_profile" }).where[0]!.url).toContain("author.amazon.com");
    expect(buildPacket({ item: book, situation: "elsewhere" }).where[0]!.url).toContain("report/infringement");
  });
});

describe("uBlock export", () => {
  it("emits one cosmetic filter per not-mine item and dedupes", () => {
    const doc = { title: "t", type: "creator" as const, creator: [], mine: [], notMine: [
      { platform: "spotify" as const, id: "abc", title: "X" },
      { platform: "spotify" as const, id: "abc", title: "X" },
      { platform: "amazon" as const, id: "B0FAKE0001", title: "Y" },
    ] };
    const out = toUblockFilters([doc]);
    expect(out.match(/open\.spotify\.com##/g)).toHaveLength(1);
    expect(out).toContain('amazon.*##div[data-asin="B0FAKE0001"]');
  });
});
