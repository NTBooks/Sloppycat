// Spotify. No usable public API since the Feb 2026 dev-mode changes. The artist page is rendered in a
// hidden tab; the page's own artist-overview response (captured by content/spotify-capture) supplies
// the 10 newest albums, 10 newest singles, compilations, appears-on, bio and external links.
// New releases sort first, which is exactly where a hijacked release lands.
import type { Adapter } from "./types";

export const spotify: Adapter = {
  id: "spotify",
  label: "Spotify",
  strategy: "render",
  supportsBio: true,
  parseProfileUrl(url) {
    const m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?artist\/([A-Za-z0-9]{22})/i.exec(url);
    return m ? { profileId: m[1]!, url: `https://open.spotify.com/artist/${m[1]}` } : null;
  },
  parseItemUrl(url) {
    const m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?album\/([A-Za-z0-9]{22})/i.exec(url);
    return m ? m[1]! : null;
  },
  profileUrl: (id) => `https://open.spotify.com/artist/${id}`,
  itemUrl: (id) => `https://open.spotify.com/album/${id}`,
  // The artist page gives the ten newest of each kind; this view has the lot.
  fullCatalogUrl: (profileId) => `https://open.spotify.com/artist/${profileId}/discography/all`,
  async fetchSnapshot(profileId, ctx) {
    // One page load gives items and bio together.
    return ctx.render(`https://open.spotify.com/artist/${profileId}`, "spotify", profileId);
  },
  async fetchBio(profileId, ctx) {
    const res = await ctx.render(`https://open.spotify.com/artist/${profileId}`, "spotify", profileId);
    return res.bio;
  },
  async searchLookalikes(query, ctx) {
    const res = await ctx.render(`https://open.spotify.com/search/${encodeURIComponent(query)}/albums`, "spotify", `search:${query}`);
    return res.items.map((i) => ({ ...i, source: "search" as const }));
  },
};
