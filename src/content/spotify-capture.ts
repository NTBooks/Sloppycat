// Runs in the page's MAIN world at document_start on open.spotify.com.
// Spotify's web player loads artist data from its own GraphQL endpoint; we keep a copy of the
// artist responses so the extension can read structured data instead of scraping a virtualized DOM.
// Read-only: nothing is modified, sent anywhere, or replayed.

declare global {
  interface Window {
    __sloppycatCaps?: unknown[];
  }
}

(() => {
  if (window.__sloppycatCaps) return;
  const caps: unknown[] = [];
  window.__sloppycatCaps = caps;
  const orig = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const res = await orig.apply(this, args);
    try {
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (/\/pathfinder\/v\d+\/query/.test(url)) {
        res
          .clone()
          .json()
          .then((j: { data?: Record<string, unknown> }) => {
            if (j?.data && ("artistUnion" in j.data || "albumUnion" in j.data)) {
              caps.push(j);
              if (caps.length > 20) caps.shift();
            }
          })
          .catch(() => undefined);
      }
    } catch {
      /* never break the page */
    }
    return res;
  };
})();

export {};
