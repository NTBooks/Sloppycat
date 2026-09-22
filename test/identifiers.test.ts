import { describe, expect, it } from "vitest";
import { normalizeId, parseList, serializeList } from "../src/lists/format";

const LIST = `# Jane Doe verified catalog
<!-- sloppycat/v1 -->
Title: Jane Doe verified catalog
Type: creator

## Creator
| platform | profile |
|---|---|
| amazon | https://www.amazon.com/stores/author/B000APXXXX |

## Mine
| platform | id | title | disclosure | isbn |
|---|---|---|---|---|
| amazon | B0C1234567 | The Long Field | text:human | 978-0-00-000000-0 |

## Not mine
| platform | id | title | first seen | note | isbn | upc |
|---|---|---|---|---|---|---|
| amazon | B0FAKE0001 | The Long Field: Summary | 2026-09-14 | not mine | 9781111111111 | 0 12345 67890 5 |
`;

describe("cross-platform identifiers", () => {
  it("parses and normalizes ISBN and UPC", () => {
    const d = parseList(LIST).doc!;
    expect(d.mine[0]!.ids).toEqual({ isbn: "9780000000000" });
    expect(d.notMine[0]!.ids).toEqual({ isbn: "9781111111111", upc: "012345678905" });
  });

  it("round-trips identifier columns, and omits them when no row has any", () => {
    const d = parseList(LIST).doc!;
    const text = serializeList(d);
    expect(text).toContain("| platform | id | title | disclosure | isbn |");
    expect(parseList(text).doc!.mine[0]!.ids).toEqual({ isbn: "9780000000000" });

    const plain = { ...d, mine: d.mine.map(({ ids, ...r }) => r), notMine: [] };
    expect(serializeList(plain)).toContain("| platform | id | title | disclosure |");
    expect(serializeList(plain)).not.toContain("isbn");
  });

  it("normalizes the formats people actually paste", () => {
    expect(normalizeId("isbn", "978-0-306-40615-7")).toBe("9780306406157");
    expect(normalizeId("isbn", "0-306-40615-x")).toBe("030640615X");
    expect(normalizeId("isrc", "us-s1z-99-00001")).toBe("USS1Z9900001");
    expect(normalizeId("mbid", "  abc-123 ")).toBe("abc-123");
  });
});
