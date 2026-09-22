// Parser and serializer for the Sloppycat list format: a strict Markdown subset.
// See docs/list-format.md. Headers are "Key: value" lines after the H1;
// data lives in three H2 sections (Creator, Mine, Not mine) as pipe tables.

import type {
  Disclosure,
  Identifiers,
  ListAttestedRow,
  ListCreatorRow,
  ListDocument,
  ListLikelyRow,
  ListMineRow,
  ListNotMineRow,
  Platform,
} from "../types";
import { ID_KEYS, PLATFORMS } from "../types";

export const FORMAT_MARKER = "<!-- sloppycat/v1 -->";

export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  doc: ListDocument | null;
  errors: ParseError[];
  warnings: ParseError[];
}

type Section = "creator" | "mine" | "notMine" | "likely" | "attested";
const SECTION_ALIASES: Record<string, Section> = {
  "likely accurate": "likely",
  likely: "likely",
  attested: "attested",
  attestations: "attested",
  creator: "creator",
  creators: "creator",
  mine: "mine",
  "not mine": "notMine",
  notmine: "notMine",
  "not-mine": "notMine",
};

function splitRow(line: string): string[] {
  // Strip leading/trailing pipes, split on unescaped pipes, unescape \|
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

export function parseDisclosure(s: string | undefined): Disclosure | undefined {
  if (!s) return undefined;
  const out: Disclosure = {};
  for (const part of s.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim().toLowerCase();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function serializeDisclosure(d: Disclosure | undefined): string {
  if (!d) return "";
  return Object.entries(d)
    .map(([k, v]) => `${k}:${v}`)
    .join("; ");
}

/** ISBN-13 and ISBN-10 both normalize to digits, so "978-0-00-000000-0" matches "9780000000000". */
export function normalizeId(key: string, raw: string): string {
  const v = raw.trim();
  if (key === "isbn" || key === "upc") return v.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (key === "isrc") return v.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return v;
}

function readIds(row: Record<string, string>): Identifiers | undefined {
  const out: Identifiers = {};
  for (const k of ID_KEYS) {
    const v = row[k];
    if (v) out[k] = normalizeId(k, v);
  }
  return Object.keys(out).length ? out : undefined;
}

function isPlatform(s: string): s is Platform {
  return (PLATFORMS as string[]).includes(s);
}

export function parseList(text: string): ParseResult {
  const errors: ParseError[] = [];
  const warnings: ParseError[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  const doc: ListDocument = { title: "", type: "creator", creator: [], mine: [], notMine: [] };
  let sawMarker = false;
  let section: Section | null = null;
  let headerCols: string[] | null = null;
  let inHeaderBlock = true;

  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n] ?? "";
    const line = raw.trim();
    const lineNo = n + 1;
    if (!line) continue;
    if (line === FORMAT_MARKER) {
      sawMarker = true;
      continue;
    }
    if (line.startsWith("<!--")) continue;

    if (line.startsWith("# ")) {
      // H1 is decorative; the Title header is authoritative.
      if (!doc.title) doc.title = line.slice(2).trim();
      continue;
    }
    if (line.startsWith("## ")) {
      const name = line.slice(3).trim().toLowerCase();
      const sec = SECTION_ALIASES[name];
      if (!sec) {
        warnings.push({ line: lineNo, message: `Unknown section "${line.slice(3).trim()}" ignored` });
        section = null;
      } else {
        section = sec;
      }
      headerCols = null;
      inHeaderBlock = false;
      continue;
    }

    if (inHeaderBlock) {
      const m = /^([A-Za-z][A-Za-z -]*):\s*(.*)$/.exec(line);
      if (m) {
        const key = m[1]!.trim().toLowerCase();
        const val = m[2]!.trim();
        switch (key) {
          case "title":
            doc.title = val;
            break;
          case "type":
            if (val === "creator" || val === "community") doc.type = val;
            else errors.push({ line: lineNo, message: `Type must be "creator" or "community", got "${val}"` });
            break;
          case "homepage":
            doc.homepage = val;
            break;
          case "version":
            doc.version = val;
            break;
          case "expires":
            doc.expires = val;
            break;
          case "baseline-before":
          case "baseline before":
            if (/^\d{4}-\d{2}-\d{2}$/.test(val)) doc.baselineBefore = val;
            else errors.push({ line: lineNo, message: `Baseline-before must be YYYY-MM-DD, got "${val}"` });
            break;
          default:
            warnings.push({ line: lineNo, message: `Unknown header "${m[1]}" ignored` });
        }
      }
      // Prose before the first section is ignored.
      continue;
    }

    if (!section) continue;
    if (!line.startsWith("|")) continue; // prose inside a section is allowed and ignored

    const cells = splitRow(line);
    if (!headerCols) {
      headerCols = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (isSeparatorRow(cells)) continue;

    const row: Record<string, string> = {};
    headerCols.forEach((col, i) => {
      row[col] = cells[i] ?? "";
    });

    const platform = (row["platform"] ?? "").toLowerCase();
    if (!isPlatform(platform)) {
      errors.push({ line: lineNo, message: `Unknown platform "${row["platform"] ?? ""}"` });
      continue;
    }

    if (section === "creator") {
      const profile = row["profile"] ?? "";
      if (!/^https?:\/\//.test(profile)) {
        errors.push({ line: lineNo, message: "Creator row needs a profile URL" });
        continue;
      }
      doc.creator.push({ platform, profile });
    } else if (section === "attested") {
      const listUrl = row["list"] ?? "";
      const profile = row["profile"] ?? "";
      if (!/^https?:\/\//.test(listUrl) || !/^https?:\/\//.test(profile)) {
        errors.push({ line: lineNo, message: "Attested row needs a profile URL and a list URL" });
        continue;
      }
      const r: ListAttestedRow = { platform, profile, list: listUrl };
      if (row["checked"]) r.checked = row["checked"];
      if (row["by"]) r.by = row["by"];
      (doc.attested ??= []).push(r);
    } else if (section === "likely") {
      const id = row["id"] ?? "";
      if (!id) {
        errors.push({ line: lineNo, message: "Likely-accurate row needs an id" });
        continue;
      }
      const r: ListLikelyRow = { platform, id, title: row["title"] ?? "" };
      if (row["released"]) r.released = row["released"];
      (doc.likely ??= []).push(r);
    } else if (section === "mine") {
      const id = row["id"] ?? "";
      if (!id) {
        errors.push({ line: lineNo, message: "Mine row needs an id" });
        continue;
      }
      const r: ListMineRow = { platform, id, title: row["title"] ?? "" };
      const d = parseDisclosure(row["disclosure"]);
      if (d) r.disclosure = d;
      const ids = readIds(row);
      if (ids) r.ids = ids;
      doc.mine.push(r);
    } else {
      const id = row["id"] ?? "";
      if (!id) {
        errors.push({ line: lineNo, message: "Not-mine row needs an id" });
        continue;
      }
      const r: ListNotMineRow = { platform, id, title: row["title"] ?? "" };
      if (row["first seen"]) r.firstSeen = row["first seen"];
      if (row["note"]) r.note = row["note"];
      if (row["source"]) r.source = row["source"];
      const nids = readIds(row);
      if (nids) r.ids = nids;
      doc.notMine.push(r);
    }
  }

  if (!sawMarker) warnings.push({ line: 1, message: `Missing ${FORMAT_MARKER} marker` });
  if (!doc.title) errors.push({ line: 1, message: "Missing Title header" });
  if (doc.type === "creator" && doc.creator.length === 0) {
    errors.push({ line: 1, message: "Creator lists need at least one row in ## Creator" });
  }

  return { doc: errors.length ? null : doc, errors, warnings };
}

function esc(s: string | undefined): string {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function table(cols: string[], rows: string[][]): string {
  const head = `| ${cols.join(" | ")} |`;
  const sep = `|${cols.map(() => "---").join("|")}|`;
  const body = rows.map((r) => `| ${r.map(esc).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

export function serializeList(doc: ListDocument): string {
  const out: string[] = [];
  out.push(`# ${doc.title}`);
  out.push(FORMAT_MARKER);
  out.push(`Title: ${doc.title}`);
  out.push(`Type: ${doc.type}`);
  if (doc.homepage) out.push(`Homepage: ${doc.homepage}`);
  out.push(`Version: ${doc.version ?? new Date().toISOString().slice(0, 10)}`);
  out.push(`Expires: ${doc.expires ?? "7 days"}`);
  if (doc.baselineBefore) out.push(`Baseline-before: ${doc.baselineBefore}`);
  out.push("");
  out.push("## Creator");
  out.push(table(["platform", "profile"], doc.creator.map((r) => [r.platform, r.profile])));
  out.push("");
  out.push("## Mine");
  // Only write identifier columns that some row actually carries.
  const mineIdKeys = ID_KEYS.filter((k) => doc.mine.some((r) => r.ids?.[k]));
  out.push(
    table(
      ["platform", "id", "title", "disclosure", ...mineIdKeys],
      doc.mine.map((r) => [
        r.platform,
        r.id,
        r.title,
        serializeDisclosure(r.disclosure),
        ...mineIdKeys.map((k) => r.ids?.[k] ?? ""),
      ]),
    ),
  );
  out.push("");
  out.push("## Not mine");
  const cols = ["platform", "id", "title", "first seen", "note"];
  const hasSource = doc.notMine.some((r) => r.source);
  if (hasSource) cols.push("source");
  const notMineIdKeys = ID_KEYS.filter((k) => doc.notMine.some((r) => r.ids?.[k]));
  out.push(
    table(
      [...cols, ...notMineIdKeys],
      doc.notMine.map((r) => {
        const cells = [r.platform, r.id, r.title, r.firstSeen ?? "", r.note ?? ""];
        if (hasSource) cells.push(r.source ?? "");
        return [...cells, ...notMineIdKeys.map((k) => r.ids?.[k] ?? "")];
      }),
    ),
  );
  if (doc.attested?.length) {
    out.push("");
    out.push("## Attested");
    out.push(
      table(
        ["platform", "profile", "list", "checked", "by"],
        doc.attested.map((r) => [r.platform, r.profile, r.list, r.checked ?? "", r.by ?? ""]),
      ),
    );
  }
  if (doc.likely?.length) {
    out.push("");
    out.push("## Likely accurate");
    out.push(table(["platform", "id", "title", "released"], doc.likely.map((r) => [r.platform, r.id, r.title, r.released ?? ""])));
  }
  out.push("");
  return out.join("\n");
}

/** Parse "7 days" / "6 hours" / "30 minutes" into milliseconds. Defaults to 6h. */
export function expiresToMs(expires: string | undefined): number {
  const m = /^(\d+)\s*(minute|minutes|min|hour|hours|h|day|days|d)$/i.exec((expires ?? "").trim());
  if (!m) return 6 * 3600 * 1000;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  if (unit.startsWith("min")) return n * 60 * 1000;
  if (unit.startsWith("h")) return n * 3600 * 1000;
  return n * 24 * 3600 * 1000;
}

/** Merge a fresh set of decisions into an existing creator doc, preserving disclosures and notes. */
export function mergeCreatorDoc(
  existing: ListDocument | null,
  incoming: {
    creator: ListCreatorRow[];
    mine: ListMineRow[];
    notMine: ListNotMineRow[];
    title: string;
    homepage?: string;
  },
): ListDocument {
  const base: ListDocument = existing ?? {
    title: incoming.title,
    type: "creator",
    creator: [],
    mine: [],
    notMine: [],
  };
  const doc: ListDocument = {
    ...base,
    title: base.title || incoming.title,
    type: "creator",
    creator: [...base.creator],
  };
  if (incoming.homepage && !doc.homepage) doc.homepage = incoming.homepage;

  const creatorSeen = new Set(doc.creator.map((c) => `${c.platform}|${c.profile}`));
  for (const c of incoming.creator) {
    const k = `${c.platform}|${c.profile}`;
    if (!creatorSeen.has(k)) {
      doc.creator.push(c);
      creatorSeen.add(k);
    }
  }

  const mineMap = new Map(base.mine.map((r) => [`${r.platform}:${r.id}`, r]));
  const notMineMap = new Map(base.notMine.map((r) => [`${r.platform}:${r.id}`, r]));
  for (const r of incoming.mine) {
    const k = `${r.platform}:${r.id}`;
    notMineMap.delete(k);
    const prev = mineMap.get(k);
    mineMap.set(k, { ...prev, ...r, disclosure: r.disclosure ?? prev?.disclosure });
  }
  for (const r of incoming.notMine) {
    const k = `${r.platform}:${r.id}`;
    mineMap.delete(k);
    const prev = notMineMap.get(k);
    notMineMap.set(k, { ...prev, ...r, note: r.note ?? prev?.note, firstSeen: prev?.firstSeen ?? r.firstSeen });
  }
  doc.mine = [...mineMap.values()];
  doc.notMine = [...notMineMap.values()];
  doc.version = new Date().toISOString().slice(0, 10);
  return doc;
}
