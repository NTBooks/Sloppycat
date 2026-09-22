import { describe, expect, it } from "vitest";
import { SITE_URL, SPEC_URL, expiresToMs, mergeCreatorDoc, parseDisclosure, parseList, serializeList } from "../src/lists/format";

const SAMPLE = `# Jane Doe verified catalog
<!-- sloppycat/v1 -->
Title: Jane Doe verified catalog
Type: creator
Homepage: https://janedoe.example
Version: 2026-09-22
Expires: 7 days

Some prose the parser ignores.

## Creator
| platform | profile |
|---|---|
| spotify | https://open.spotify.com/artist/0123456789abcdefghijkl |
| amazon | https://www.amazon.com/stores/author/B000APXXXX |

## Mine
| platform | id | title | disclosure |
|---|---|---|---|
| spotify | 4aBcdefghijklmnopqrstu | Blue Room | vocals:human; art:ai-generated |
| amazon | B0C1234567 | The Long Field | text:human; cover:ai-assisted |

## Not mine
| platform | id | title | first seen | note |
|---|---|---|---|---|
| spotify | 9xYcdefghijklmnopqrstu | Midnight Jazz \\| Vibes | 2026-09-14 | via 8412 Records DK |
`;

describe("parseList", () => {
  it("parses a valid creator list", () => {
    const r = parseList(SAMPLE);
    expect(r.errors).toEqual([]);
    expect(r.doc).not.toBeNull();
    const d = r.doc!;
    expect(d.title).toBe("Jane Doe verified catalog");
    expect(d.type).toBe("creator");
    expect(d.homepage).toBe("https://janedoe.example");
    expect(d.creator).toHaveLength(2);
    expect(d.mine[0]).toEqual({
      platform: "spotify",
      id: "4aBcdefghijklmnopqrstu",
      title: "Blue Room",
      disclosure: { vocals: "human", art: "ai-generated" },
    });
    expect(d.notMine[0]!.title).toBe("Midnight Jazz | Vibes");
    expect(d.notMine[0]!.firstSeen).toBe("2026-09-14");
    expect(d.notMine[0]!.note).toBe("via 8412 Records DK");
  });

  it("round-trips through serializeList", () => {
    const d = parseList(SAMPLE).doc!;
    const again = parseList(serializeList(d));
    expect(again.errors).toEqual([]);
    expect(again.doc).toEqual({ ...d, version: again.doc!.version });
  });

  it("writes a reader note pointing at the extension, and parses it back cleanly", () => {
    const text = serializeList(parseList(SAMPLE).doc!);
    expect(text).toContain(SITE_URL);
    expect(text).toContain(SPEC_URL);
    expect(text).toContain('find "List sources"');
    const again = parseList(text);
    expect(again.errors).toEqual([]);
    expect(again.warnings).toEqual([]);
    expect(again.doc!.title).toBe("Jane Doe verified catalog");
  });

  it("skips a comment that runs over several lines", () => {
    const commented = SAMPLE.replace(
      "Some prose the parser ignores.",
      ["<!--", "Type: nonsense", "Title: hijacked", "| spotify | x | y |", "-->"].join("\n"),
    );
    const r = parseList(commented);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.doc!.title).toBe("Jane Doe verified catalog");
  });

  it("reports malformed rows with line numbers and rejects the doc", () => {
    const bad = SAMPLE.replace("| amazon | B0C1234567", "| kindle | B0C1234567");
    const r = parseList(bad);
    expect(r.doc).toBeNull();
    expect(r.errors[0]!.message).toMatch(/Unknown platform "kindle"/);
    expect(r.errors[0]!.line).toBeGreaterThan(15);
  });

  it("requires a creator row for creator lists but not for community lists", () => {
    const noCreator = `# X\n<!-- sloppycat/v1 -->\nTitle: X\nType: creator\n\n## Mine\n| platform | id | title |\n|---|---|---|\n| spotify | a | b |\n`;
    expect(parseList(noCreator).doc).toBeNull();
    expect(parseList(noCreator.replace("Type: creator", "Type: community")).doc).not.toBeNull();
  });

  it("warns on unknown headers and sections but still parses", () => {
    const r = parseList(SAMPLE.replace("Expires: 7 days", "Expires: 7 days\nMood: sad").replace("## Not mine", "## Extras\n| a |\n|---|\n| b |\n\n## Not mine"));
    expect(r.doc).not.toBeNull();
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/Mood/);
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/Extras/);
  });

  it("keeps unknown disclosure keys verbatim", () => {
    expect(parseDisclosure("text:human; mood-board:ai-generated; weird")).toEqual({ text: "human", "mood-board": "ai-generated" });
  });
});

describe("likely-accurate baseline", () => {
  const community = `# Sloppycat community baseline
<!-- sloppycat/v1 -->
Title: Sloppycat community baseline
Type: community
Baseline-before: 2022-11-30

## Likely accurate
| platform | id | title | released |
|---|---|---|---|
| spotify | 06Ey2y54V4aGjP5EsovA2O | Rank | 1988-09-05 |
`;
  it("parses Baseline-before and the Likely accurate section and round-trips", () => {
    const d = parseList(community).doc!;
    expect(d.baselineBefore).toBe("2022-11-30");
    expect(d.likely).toEqual([{ platform: "spotify", id: "06Ey2y54V4aGjP5EsovA2O", title: "Rank", released: "1988-09-05" }]);
    const again = parseList(serializeList(d)).doc!;
    expect(again.likely).toEqual(d.likely);
    expect(again.baselineBefore).toBe("2022-11-30");
  });
  it("rejects a malformed cutoff date", () => {
    expect(parseList(community.replace("2022-11-30", "Nov 2022")).errors[0]!.message).toMatch(/Baseline-before/);
  });
});

describe("expiresToMs", () => {
  it("handles units and falls back to 6h", () => {
    expect(expiresToMs("7 days")).toBe(7 * 86400000);
    expect(expiresToMs("6 hours")).toBe(6 * 3600000);
    expect(expiresToMs("30 minutes")).toBe(30 * 60000);
    expect(expiresToMs("soon")).toBe(6 * 3600000);
  });
});

describe("mergeCreatorDoc", () => {
  it("moves an item between mine and not-mine and keeps earlier notes and disclosures", () => {
    const base = parseList(SAMPLE).doc!;
    const merged = mergeCreatorDoc(base, {
      title: "ignored",
      creator: [{ platform: "goodreads", profile: "https://www.goodreads.com/author/show/1" }],
      mine: [{ platform: "spotify", id: "9xYcdefghijklmnopqrstu", title: "Midnight Jazz | Vibes" }],
      notMine: [{ platform: "amazon", id: "B0C1234567", title: "The Long Field", firstSeen: "2026-09-20" }],
    });
    expect(merged.title).toBe("Jane Doe verified catalog");
    expect(merged.creator).toHaveLength(3);
    expect(merged.mine.map((r) => r.id)).toContain("9xYcdefghijklmnopqrstu");
    expect(merged.notMine.map((r) => r.id)).toEqual(["B0C1234567"]);
    // Blue Room disclosure untouched
    expect(merged.mine.find((r) => r.title === "Blue Room")!.disclosure).toEqual({ vocals: "human", art: "ai-generated" });
    // Base doc not mutated
    expect(base.creator).toHaveLength(2);
  });

  it("does not duplicate on re-run", () => {
    const base = parseList(SAMPLE).doc!;
    const again = mergeCreatorDoc(base, { title: "t", creator: base.creator, mine: base.mine, notMine: base.notMine });
    expect(again.mine).toHaveLength(base.mine.length);
    expect(again.notMine).toHaveLength(base.notMine.length);
    expect(again.creator).toHaveLength(base.creator.length);
  });
});
