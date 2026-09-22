// Amazon Books. Author pages are JavaScript-rendered store pages (/stores/author/<id>), so they are
// rendered in a hidden tab from the user's own session. The "allbooks" grid lists every title behind a
// "Show more" button; the Author Central bio lives on the separate "about" page.
// Search results are server-rendered and are fetched directly, falling back to a hidden tab on a challenge.
import type { Adapter } from "./types";
import { ChallengeError } from "./types";
import { fetchText, looksLikeAmazonChallenge } from "./shared";

const HOSTS = ["www.amazon.com", "www.amazon.co.uk", "www.amazon.ca", "www.amazon.de"];

export function amazonHost(url: string): string {
  try {
    const h = new URL(url).host.replace(/^amazon\./, "www.amazon.");
    return HOSTS.includes(h) ? h : "www.amazon.com";
  } catch {
    return "www.amazon.com";
  }
}

function split(profileId: string): [string, string] {
  return profileId.includes("|") ? (profileId.split("|") as [string, string]) : ["www.amazon.com", profileId];
}

export const amazon: Adapter = {
  id: "amazon",
  label: "Amazon Books",
  strategy: "render",
  supportsBio: true,
  parseProfileUrl(url) {
    // /stores/author/B001IGFHW6, /stores/Name/author/B001IGFHW6, /Name/e/B001IGFHW6, /-/e/B001IGFHW6
    const m = /amazon\.[a-z.]+\/(?:stores\/(?:[^/]+\/)?author\/|(?:[^/]+\/)?e\/)(B0[A-Z0-9]{8})/i.exec(url);
    if (!m) return null;
    const host = amazonHost(url);
    return { profileId: `${host}|${m[1]}`, url: `https://${host}/stores/author/${m[1]}` };
  },
  parseItemUrl(url) {
    const m = /amazon\.[a-z.]+\/(?:[^?#]*\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})/i.exec(url);
    return m ? m[1]! : null;
  },
  profileUrl(id) {
    const [host, authorId] = split(id);
    return `https://${host}/stores/author/${authorId}`;
  },
  itemUrl: (asin) => `https://www.amazon.com/dp/${asin}`,
  async fetchSnapshot(profileId, ctx, opts) {
    const [host, authorId] = split(profileId);
    const url = `https://${host}/stores/author/${authorId}/allbooks`;
    const res = await ctx.render(url, "amazon", profileId);
    if (res.challenged) throw new ChallengeError(url);
    if (opts?.withBio) {
      try {
        const about = await ctx.render(`https://${host}/stores/author/${authorId}/about`, "amazon", profileId);
        res.bio = about.bio;
        res.displayName = res.displayName ?? about.displayName;
      } catch {
        /* bio optional */
      }
    }
    return res;
  },
  async fetchBio(profileId, ctx) {
    const [host, authorId] = split(profileId);
    const res = await ctx.render(`https://${host}/stores/author/${authorId}/about`, "amazon", profileId);
    return res.bio;
  },
  async searchLookalikes(query, ctx) {
    const url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}&i=stripbooks`;
    let parsed;
    try {
      const res = await fetchText(url);
      if (res.status === 503 || looksLikeAmazonChallenge(res.text)) throw new ChallengeError(url);
      parsed = await ctx.parseHtml(res.text, url, "amazon", `search:${query}`);
    } catch {
      parsed = await ctx.render(url, "amazon", `search:${query}`);
    }
    return parsed.items.map((i) => ({ ...i, source: "search" as const }));
  },
};
