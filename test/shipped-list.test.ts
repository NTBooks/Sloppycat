import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseList } from "../src/lists/format";

describe("shipped community list", () => {
  const text = readFileSync(resolve(__dirname, "..", "lists", "community.md"), "utf8");
  const r = parseList(text);

  it("parses with no errors", () => {
    expect(r.errors).toEqual([]);
    expect(r.doc).not.toBeNull();
  });

  it("is a community list with the agreed cutoff and starts empty", () => {
    expect(r.doc!.type).toBe("community");
    expect(r.doc!.baselineBefore).toBe("2022-11-30");
    expect(r.doc!.notMine).toHaveLength(0);
    expect(r.doc!.likely ?? []).toHaveLength(0);
  });
});
