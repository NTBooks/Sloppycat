// Runs in the page's MAIN world at document_start on open.spotify.com.
//
// Spotify's web player loads artist data from its own GraphQL endpoint. We keep a copy of the artist
// responses, and of the request that produced each one, so the extension can:
//   1. read structured data instead of scraping a virtualized DOM, and
//   2. page through a long discography by re-issuing the page's own query with a different offset,
//      using the page's own short-lived credentials.
// The second needs the request headers, which carry those credentials, and they are only kept on a
// page the extension loaded for itself (see OWN_PAGE_MARK). On a tab the user opened, only the public
// catalogue responses are kept, and a long discography is read from the extension's own page instead.
// Read-only otherwise: nothing on the page is modified.
import { OWN_PAGE_MARK } from "../render-guard";

export interface SpotifyCapture {
  url: string;
  /** Request body, which carries the operation name, variables and persisted-query hash. */
  body: string;
  /** Request headers, including the short-lived authorization and client tokens. Empty on a page the user opened. */
  headers: Record<string, string>;
  json: unknown;
}

declare global {
  interface Window {
    __sloppycatCaps?: SpotifyCapture[];
  }
}

(() => {
  if (window.__sloppycatCaps) return;
  const caps: SpotifyCapture[] = [];
  window.__sloppycatCaps = caps;
  // Read once, at document_start, before the player's router rewrites the address.
  const ownPage = location.hash === `#${OWN_PAGE_MARK}`;

  function headersOf(init: RequestInit | undefined, input: RequestInfo | URL): Record<string, string> {
    const out: Record<string, string> = {};
    const h = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    if (!h) return out;
    if (typeof (h as Headers).forEach === "function") {
      (h as Headers).forEach((v, k) => (out[k.toLowerCase()] = v));
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) out[String(k).toLowerCase()] = String(v);
    } else {
      for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
    }
    return out;
  }

  const orig = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const res = await orig.apply(this, args);
    try {
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (/\/pathfinder\/v\d+\/query/.test(url)) {
        const init = args[1];
        let body = "";
        if (init?.body) body = String(init.body);
        else if (input instanceof Request) body = await input.clone().text();
        const headers = ownPage ? headersOf(init, input) : {};
        res
          .clone()
          .json()
          .then((j: { data?: Record<string, unknown> }) => {
            if (j?.data && ("artistUnion" in j.data || "albumUnion" in j.data)) {
              caps.push({ url, body, headers, json: j });
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
