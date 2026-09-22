// Emit uBlock Origin / AdGuard cosmetic filters that hide "not mine" items on platform pages.
import type { ListDocument } from "../types";

export function toUblockFilters(docs: ListDocument[], title = "Sloppycat not-mine items"): string {
  const lines: string[] = [
    `! Title: ${title}`,
    `! Description: Hides releases and listings that verified creators report are not theirs.`,
    `! Version: ${new Date().toISOString().slice(0, 10)}`,
    `! Expires: 1 day`,
    `! Homepage: https://github.com/sloppycat`,
    "",
  ];
  const seen = new Set<string>();
  for (const doc of docs) {
    for (const r of doc.notMine) {
      const key = `${r.platform}:${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = r.title ? ` ! ${r.title.replace(/\n/g, " ")}` : "";
      switch (r.platform) {
        case "spotify":
          lines.push(`open.spotify.com##a[href*="/album/${r.id}"]:upward(2)${t}`);
          break;
        case "apple":
          lines.push(`music.apple.com##a[href*="/album/"][href$="/${r.id}"]:upward(2)${t}`);
          break;
        case "deezer":
          lines.push(`deezer.com##a[href*="/album/${r.id}"]:upward(2)${t}`);
          break;
        case "amazon":
          lines.push(`amazon.*##div[data-asin="${r.id}"]${t}`);
          lines.push(`amazon.*##a[href*="/dp/${r.id}"]:upward(2)${t}`);
          break;
        case "goodreads":
          lines.push(`goodreads.com##a[href*="/book/show/${r.id}"]:upward(tr)${t}`);
          break;
        case "googlebooks":
          lines.push(`books.google.*##a[href*="id=${r.id}"]:upward(2)${t}`);
          break;
      }
    }
  }
  return lines.join("\n") + "\n";
}
