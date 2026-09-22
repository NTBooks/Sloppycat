// Dev-only: serve dist/ over HTTP with a stubbed chrome.* API so the extension pages can be
// opened in an ordinary browser tab for layout and render checks. Not part of the extension.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "dist");
const port = Number(process.env.PORT ?? 5177);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".md": "text/markdown" };

const STUB = `
<script>
// Minimal chrome.* stub with seeded data, for rendering checks only.
const store = {
  settings: { mode: "both", intervalMinutes: 60, lookalikeEveryNRuns: 6, notifications: true, defaultDisclosure: { text: "human" }, myListUrl: "https://gist.githubusercontent.com/jane/abc/raw" },
  profiles: {
    "spotify:3yY2gUcIsjMr8hjo51PoJ8": { platform: "spotify", profileId: "3yY2gUcIsjMr8hjo51PoJ8", url: "https://open.spotify.com/artist/3yY2gUcIsjMr8hjo51PoJ8", displayName: "The Smiths", addedAt: "2026-09-20T10:00:00Z", lastRunAt: "2026-09-22T12:00:00Z", verified: true },
    "amazon:www.amazon.com|B001IGFHW6": { platform: "amazon", profileId: "www.amazon.com|B001IGFHW6", url: "https://www.amazon.com/stores/author/B001IGFHW6", displayName: "Jane Doe", addedAt: "2026-09-20T10:00:00Z", lastRunAt: "2026-09-22T12:00:00Z", lastError: "Bot challenge at https://www.amazon.com/stores/author/B001IGFHW6/allbooks" }
  },
  alerts: {
    a1: { id: "a1", profileKey: "spotify:3yY2gUcIsjMr8hjo51PoJ8", createdAt: "2026-09-22T11:00:00Z", change: "added", signals: [{ kind: "distributor_placeholder", label: "8412 Records DK" }, { kind: "first_time_label", label: "8412 Records DK", knownLabels: ["wm uk", "rhino"] }], item: { platform: "spotify", itemId: "9xYcdefghijklmnopqrstu", title: "Midnight Jazz Vibes", kind: "single", releaseDate: "2026-09-14", label: "8412 Records DK", url: "https://open.spotify.com/album/9xYcdefghijklmnopqrstu", firstSeen: "2026-09-22T11:00:00Z", source: "profile" } },
    a2: { id: "a2", profileKey: "amazon:www.amazon.com|B001IGFHW6", createdAt: "2026-09-21T09:00:00Z", change: "lookalike", signals: [{ kind: "lookalike", ofTitle: "The Long Field", score: 0.93 }, { kind: "indie_zero_reviews" }], item: { platform: "amazon", itemId: "B0FAKE0001", title: "The Long Field: Summary & Analysis", kind: "book", label: "Independently published", url: "https://www.amazon.com/dp/B0FAKE0001", firstSeen: "2026-09-21T09:00:00Z", source: "search", meta: { reviewCount: 0 } }, resolution: undefined }
  },
  listSources: [
    { url: "https://raw.githubusercontent.com/sloppycat/lists/main/community.md", enabled: true, builtin: true, title: "Sloppycat community list", type: "community", entryCount: 0, fetchedAt: "2026-09-22T12:00:00Z" },
    { url: "https://gist.githubusercontent.com/thesmiths/abc/raw", enabled: true, title: "The Smiths — verified catalog", type: "creator", entryCount: 14, fetchedAt: "2026-09-22T06:00:00Z" },
    { url: "https://example.com/broken.md", enabled: false, title: undefined, error: "line 12: Unknown platform \\"kindle\\"" }
  ],
  listCache: {},
  myList: { title: "The Smiths — verified catalog", type: "creator", version: "2026-09-22", expires: "7 days", creator: [{ platform: "spotify", profile: "https://open.spotify.com/artist/3yY2gUcIsjMr8hjo51PoJ8" }], mine: [{ platform: "spotify", id: "06Ey2y54V4aGjP5EsovA2O", title: "Rank", disclosure: { vocals: "human", instruments: "human" } }], notMine: [{ platform: "spotify", id: "9xYcdefghijklmnopqrstu", title: "Midnight Jazz Vibes", firstSeen: "2026-09-14", note: "via 8412 Records DK" }] },
  runCounter: 3
};
const listeners = [];
window.chrome = {
  runtime: {
    id: "stub",
    getURL: (p) => "/" + p,
    sendMessage: async (m) => {
      if (m.type === "snapshot:fromTab") return { ok: true, detected: { platform: "spotify", profileId: "3yY2gUcIsjMr8hjo51PoJ8", url: "https://open.spotify.com/artist/3yY2gUcIsjMr8hjo51PoJ8" },
        result: { platform: "spotify", profileId: "3yY2gUcIsjMr8hjo51PoJ8", displayName: "The Smiths", items: [
          { platform: "spotify", itemId: "06Ey2y54V4aGjP5EsovA2O", title: "Rank", kind: "album", releaseDate: "1988-09-05", label: "WM UK", url: "https://open.spotify.com/album/06Ey2y54V4aGjP5EsovA2O", imageUrl: "https://i.scdn.co/image/ab67616d00001e02e1aaa4fd75e14d1cfaff7e36", firstSeen: "2026-09-22T12:00:00Z", source: "profile" },
          { platform: "spotify", itemId: "5Y0p2XCgRRIjna91aQE8q7", title: "The Queen Is Dead", kind: "album", releaseDate: "1986-06-16", label: "WM UK", url: "https://open.spotify.com/album/5Y0p2XCgRRIjna91aQE8q7", imageUrl: "https://i.scdn.co/image/ab67616d00001e026236778a208a15eb71079601", firstSeen: "2026-09-22T12:00:00Z", source: "profile" },
          { platform: "spotify", itemId: "7vPpqwmOjiI3CQ7buL9e3J", title: "Best... I (2011 Remaster)", kind: "album", releaseDate: "1992", label: "Rhino", url: "https://open.spotify.com/album/7vPpqwmOjiI3CQ7buL9e3J", firstSeen: "2026-09-22T12:00:00Z", source: "profile" },
          { platform: "spotify", itemId: "9xYcdefghijklmnopqrstu", title: "Midnight Jazz Vibes", kind: "single", releaseDate: "2026-09-14", label: "8412 Records DK", url: "https://open.spotify.com/album/9xYcdefghijklmnopqrstu", firstSeen: "2026-09-22T12:00:00Z", source: "profile" },
          { platform: "spotify", itemId: "6oQLBJZ48D3hBS9GAADiuV", title: "I Know It's Over (Demo)", kind: "single", releaseDate: "2017-10-06", label: "Rhino", url: "https://open.spotify.com/album/6oQLBJZ48D3hBS9GAADiuV", firstSeen: "2026-09-22T12:00:00Z", source: "profile" },
          { platform: "spotify", itemId: "30g571JKoxs8AnsgAViV2J", title: "Complete", kind: "compilation", releaseDate: "2011-09-26", label: "WM UK", url: "https://open.spotify.com/album/30g571JKoxs8AnsgAViV2J", firstSeen: "2026-09-22T12:00:00Z", source: "profile" },
          { platform: "spotify", itemId: "2n5AOB0lGse7qp38HvVROB", title: "(500) Days of Summer (Music from the Motion Picture)", kind: "appears_on", releaseDate: "2009", subtitle: "Various Artists", url: "https://open.spotify.com/album/2n5AOB0lGse7qp38HvVROB", firstSeen: "2026-09-22T12:00:00Z", source: "profile" }
        ] } };
      return { ok: true, verdicts: {}, reason: "stub: " + m.type };
    },
    openOptionsPage: () => location.assign("/ui/options/index.html"),
    onMessage: { addListener() {}, removeListener() {} }
  },
  storage: {
    local: {
      get: async (k) => (typeof k === "string" ? { [k]: store[k] } : store),
      set: async (o) => { Object.assign(store, o); listeners.forEach((f) => f(Object.fromEntries(Object.keys(o).map((k) => [k, { newValue: o[k] }])), "local")); }
    },
    onChanged: { addListener: (f) => listeners.push(f), removeListener: (f) => listeners.splice(listeners.indexOf(f), 1) }
  },
  tabs: {
    query: async () => [{ id: 1, url: "https://open.spotify.com/artist/3yY2gUcIsjMr8hjo51PoJ8", title: "The Smiths | Spotify" }],
    get: async () => ({ id: 1, url: "https://open.spotify.com/artist/3yY2gUcIsjMr8hjo51PoJ8" }),
    create: async ({ url }) => { console.log("tabs.create", url); return { id: 2 }; }
  },
  notifications: { create: async () => "n1", onClicked: { addListener() {} } },
  alarms: { create: async () => {}, get: async () => undefined, onAlarm: { addListener() {} } }
};
</script>
`;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname === "/" ? "/ui/onboard/index.html" : url.pathname;
    let body = await readFile(join(root, path));
    const ext = extname(path);
    if (ext === ".html") body = Buffer.from(String(body).replace("<head>", "<head>" + STUB));
    res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`preview on http://localhost:${port}`));
