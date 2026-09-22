// Goodreads. Author list pages are server-rendered and paginated. No API since 2020.
import type { Adapter } from "./types";
import type { ExtractResult, SnapshotItem } from "../types";
import { fetchText } from "./shared";

export const goodreads: Adapter = {
  id: "goodreads",
  label: "Goodreads",
  strategy: "ssr",
  supportsBio: true,
  parseProfileUrl(url) {
    const m = /goodreads\.com\/author\/(?:show|list)\/(\d+)/i.exec(url);
    return m ? { profileId: m[1]!, url: `https://www.goodreads.com/author/show/${m[1]}` } : null;
  },
  parseItemUrl(url) {
    const m = /goodreads\.com\/book\/show\/(\d+)/i.exec(url);
    return m ? m[1]! : null;
  },
  profileUrl: (id) => `https://www.goodreads.com/author/show/${id}`,
  itemUrl: (id) => `https://www.goodreads.com/book/show/${id}`,
  async fetchSnapshot(profileId, ctx, opts) {
    const items: SnapshotItem[] = [];
    let displayName: string | undefined;
    let bio: string | undefined;
    // /author/list/<id> paginates at 30 per page; the show page has the bio.
    for (let page = 1; page <= 10; page++) {
      const url = `https://www.goodreads.com/author/list/${profileId}?page=${page}&per_page=30`;
      const res = await fetchText(url);
      if (res.status >= 400) break;
      const parsed: ExtractResult = await ctx.parseHtml(res.text, url, "goodreads", profileId);
      displayName = displayName ?? parsed.displayName;
      const before = items.length;
      for (const it of parsed.items) if (!items.some((x) => x.itemId === it.itemId)) items.push(it);
      if (items.length === before || parsed.items.length < 30) break;
    }
    if (opts?.withBio !== false) try {
      const show = await fetchText(`https://www.goodreads.com/author/show/${profileId}`);
      const parsed = await ctx.parseHtml(show.text, `https://www.goodreads.com/author/show/${profileId}`, "goodreads", profileId);
      bio = parsed.bio;
      displayName = displayName ?? parsed.displayName;
    } catch {
      /* bio optional */
    }
    return { platform: "goodreads", profileId, displayName, bio, items };
  },
  async fetchBio(profileId, ctx) {
    const url = `https://www.goodreads.com/author/show/${profileId}`;
    const res = await fetchText(url);
    const parsed = await ctx.parseHtml(res.text, url, "goodreads", profileId);
    return parsed.bio;
  },
  async searchLookalikes(query, ctx) {
    const url = `https://www.goodreads.com/search?q=${encodeURIComponent(query)}&search_type=books`;
    const res = await fetchText(url);
    const parsed = await ctx.parseHtml(res.text, url, "goodreads", `search:${query}`);
    return parsed.items.map((i) => ({ ...i, source: "search" as const }));
  },
};
