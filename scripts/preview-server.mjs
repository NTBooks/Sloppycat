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
  settings: { mode: "both", intervalMinutes: 60, lookalikeEveryNRuns: 6, notifications: true, listUpdates: true, defaultDisclosure: { text: "human" }, myListUrl: "https://gist.githubusercontent.com/jane/abc/raw" },
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
  // Null so screenshots show the resting state. Swap in the commented object to render the progress
  // lines in the popup and in Settings:
  // { startedAt: new Date().toISOString(), queue: ["spotify:3yY2gUcIsjMr8hjo51PoJ8", "amazon:www.amazon.com|B001IGFHW6"], done: 1, currentKey: "amazon:www.amazon.com|B001IGFHW6", currentLabel: "Jane Doe", phase: "Reading Amazon Books" }
  runState: null,
  listChanges: [
    { id: "c1", at: "2026-09-22T12:00:00Z", source: "https://gist.githubusercontent.com/thesmiths/abc/raw", listTitle: "The Smiths — verified catalog", listType: "creator", kind: "verified", platform: "spotify", itemId: "06Ey2y54V4aGjP5EsovA2O", title: "Rank", creatorProfile: "https://open.spotify.com/artist/3yY2gUcIsjMr8hjo51PoJ8", disclosure: { vocals: "human", instruments: "human" }, seen: false },
    { id: "c2", at: "2026-09-22T12:00:00Z", source: "https://gist.githubusercontent.com/thesmiths/abc/raw", listTitle: "The Smiths — verified catalog", listType: "creator", kind: "flagged", platform: "spotify", itemId: "9xYcdefghijklmnopqrstu", title: "Midnight Jazz Vibes", creatorProfile: "https://open.spotify.com/artist/3yY2gUcIsjMr8hjo51PoJ8", note: "uploaded through 8412 Records DK, reported 22 Sep", seen: false },
    { id: "c3", at: "2026-09-19T08:00:00Z", source: "https://raw.githubusercontent.com/sloppycat/lists/main/community.md", listTitle: "Sloppycat community list", listType: "community", kind: "retracted", platform: "amazon", itemId: "B0FAKE0001", title: "The Long Field: Summary & Analysis", seen: true }
  ],
  myList: { title: "The Smiths — verified catalog", type: "creator", version: "2026-09-22", expires: "7 days", creator: [{ platform: "spotify", profile: "https://open.spotify.com/artist/3yY2gUcIsjMr8hjo51PoJ8" }], mine: [{ platform: "spotify", id: "06Ey2y54V4aGjP5EsovA2O", title: "Rank", disclosure: { vocals: "human", instruments: "human" } }], notMine: [{ platform: "spotify", id: "9xYcdefghijklmnopqrstu", title: "Midnight Jazz Vibes", firstSeen: "2026-09-14", note: "via 8412 Records DK" }] },
  runCounter: 3
};
const listeners = [];
// The list hosts the real manifest requires, and the optional grants on top of them. Seeded so the
// example.com source in listSources renders the "Allow that host" row the real options page shows.
const required = ["https://raw.githubusercontent.com/*", "https://gist.githubusercontent.com/*", "https://gist.github.com/*", "https://github.com/*", "https://api.github.com/*"];
const granted = new Set(required);
const permListeners = { added: [], removed: [] };
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
    getManifest: () => ({ host_permissions: [...required] }),
    onMessage: { addListener() {}, removeListener() {} }
  },
  permissions: {
    getAll: async () => ({ permissions: [], origins: [...granted] }),
    contains: async ({ origins = [] }) => origins.every((o) => granted.has(o)),
    request: async ({ origins = [] }) => {
      if (!confirm("Stub permission prompt: allow " + origins.join(", ") + "?")) return false;
      origins.forEach((o) => granted.add(o));
      permListeners.added.forEach((f) => f({ origins }));
      return true;
    },
    remove: async ({ origins = [] }) => {
      origins.forEach((o) => granted.delete(o));
      permListeners.removed.forEach((f) => f({ origins }));
      return true;
    },
    onAdded: { addListener: (f) => permListeners.added.push(f), removeListener: (f) => permListeners.added.splice(permListeners.added.indexOf(f), 1) },
    onRemoved: { addListener: (f) => permListeners.removed.push(f), removeListener: (f) => permListeners.removed.splice(permListeners.removed.indexOf(f), 1) }
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

// A stand-in platform page, dark like Spotify's, used to screenshot the overlay components.
const DEMO = `<!doctype html><html><head><meta charset="utf-8"><title>Sloppycat overlay demo</title>
<link rel="stylesheet" href="/content/overlay.css">
<style>
  body { margin:0; background:#121212; color:#fff; font:14px/1.5 system-ui,sans-serif; padding:28px 32px 220px; }
  h2 { font-size:22px; margin:0 0 4px; letter-spacing:-0.02em; }
  .sub { color:#a7a7a7; font-size:13px; margin-bottom:22px; }
  .demo-row { display:flex; gap:14px; align-items:center; padding:9px 10px; border-radius:6px; }
  .demo-row:hover { background:#1a1a1a; }
  .demo-art { width:46px; height:46px; border-radius:3px; background:linear-gradient(135deg,#3a3a3a,#242424); flex:none; }
  .demo-title { color:#fff; font-weight:600; text-decoration:none; }
  .demo-meta { color:#a7a7a7; font-size:12px; }
</style></head><body>
<h2>The Smiths</h2><div class="sub">Discography</div>
<div id="rows"></div>
<script src="/content/demo-card.js"></script>
</body></html>`;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/demo") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(DEMO);
      return;
    }
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
