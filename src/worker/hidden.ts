// Reading pages that need a real browser tab: one reused tab in a minimized window of its own.
import type { ExtractResult, Platform } from "../types";
import { isGone, OWN_PAGE_MARK, RENDER_CLOSED, RenderBudget } from "../render-guard";
import { parseSpotifyCaptures, pageRequest, pickPaginator, type SpotifyCapture } from "../adapters/spotify-json";
import { log } from "./runlog";
import { withTimeout } from "./timeout";

/**
 * Spotify and Amazon cannot be read without a real top-level page. Spotify's catalogue arrives in
 * the GraphQL calls the player makes with a token it mints per page load, and Amazon's author store
 * is JavaScript-rendered against the reader's own session. Neither can be framed: Amazon sends
 * `X-Frame-Options: SAMEORIGIN` and Spotify's CSP sets `frame-ancestors 'self'`, so an offscreen
 * document is not an option and a tab is the only thing left.
 *
 * So the tab is made as small a thing as possible: one reused tab, in one minimized popup window of
 * its own, never in a window the user is working in, closed again as soon as the run is done. If the
 * user closes it anyway, that is reported as what it is rather than as a failed check.
 */
let renderQueue: Promise<unknown> = Promise.resolve();
let hidden: { windowId: number; tabId: number } | undefined;
let rendersInFlight = 0;

export const budget = new RenderBudget();

/**
 * Is this message coming from the background tab the extension drives itself?
 *
 * Chrome stops the worker between events, which loses the ids held in memory while leaving the
 * window open, so they are mirrored into session storage and both are consulted. Getting this wrong
 * in the permissive direction is what lets a render loop start, so it errs the other way.
 */
const HIDDEN_KEY = "sloppycat:hiddenTab";

async function rememberHidden(v: { windowId: number; tabId: number } | undefined): Promise<void> {
  try {
    if (v) await chrome.storage.session.set({ [HIDDEN_KEY]: v });
    else await chrome.storage.session.remove(HIDDEN_KEY);
  } catch {
    /* session storage is a nicety; the in-memory copy still covers the common case */
  }
}

export async function isHiddenTab(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined) return false;
  if (hidden?.tabId === tabId) return true;
  try {
    const stored = (await chrome.storage.session.get(HIDDEN_KEY))[HIDDEN_KEY] as { tabId?: number } | undefined;
    return stored?.tabId === tabId;
  } catch {
    return false;
  }
}

/**
 * Close a background window left over from a previous worker. Without this, a worker restart during
 * a check orphans the window: nothing knows to close it, and nothing knows to ignore what its
 * content scripts say.
 */
export async function closeOrphanHidden(): Promise<void> {
  try {
    const stored = (await chrome.storage.session.get(HIDDEN_KEY))[HIDDEN_KEY] as { windowId?: number } | undefined;
    if (stored?.windowId === undefined) return;
    await rememberHidden(undefined);
    await chrome.windows.remove(stored.windowId);
  } catch {
    /* already gone, which is the outcome we wanted */
  }
}

async function getHiddenTab(): Promise<{ windowId: number; tabId: number }> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  if (hidden) {
    try {
      // The tab is what gets navigated, so it is the one worth proving still exists.
      await chrome.tabs.get(hidden.tabId);
      return hidden;
    } catch {
      hidden = undefined;
    }
  }
  await log("Opening a minimized background window to read pages in");
  const w = await chrome.windows.create({ url: "about:blank", state: "minimized", focused: false, type: "popup" });
  const tabId = w.tabs?.[0]?.id;
  if (w.id === undefined || tabId === undefined) throw new Error("Could not open a background window to read the page in");
  hidden = { windowId: w.id, tabId };
  await rememberHidden(hidden);
  return hidden;
}

/** How long the background window sticks around with nothing to do before it is closed. */
const HIDDEN_IDLE_MS = 20_000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** Close the background window, so it is not left sitting in the taskbar between checks. */
export async function closeHidden(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  if (rendersInFlight > 0 || !hidden) return;
  const { windowId } = hidden;
  hidden = undefined;
  await rememberHidden(undefined);
  try {
    await chrome.windows.remove(windowId);
  } catch {
    /* the user got there first */
  }
}

/**
 * Close it once the queue has been quiet for a moment. The run loop pauses a few seconds between
 * profiles, so closing the instant one render ends would mean opening a fresh window for every
 * profile instead of reusing one for the whole run.
 */
function closeHiddenSoon(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    void closeHidden();
  }, HIDDEN_IDLE_MS);
}

/**
 * Resolve when the tab finishes loading. Rejects as soon as the tab goes away, rather than waiting
 * out the timeout and then failing on the next call with a bare "No tab with id".
 */
function waitForLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(), timeoutMs);
    function finish(err?: Error) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (err) reject(err);
      else resolve();
    }
    function onUpdated(id: number, info: chrome.tabs.TabChangeInfo) {
      if (id === tabId && info.status === "complete") finish();
    }
    function onRemoved(id: number) {
      if (id === tabId) finish(new Error(RENDER_CLOSED));
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

/** Read the Spotify responses captured in the page's MAIN world by content/spotify-capture. */
async function readSpotifyCaptures(tabId: number): Promise<unknown[]> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => (window as unknown as { __sloppycatCaps?: unknown[] }).__sloppycatCaps ?? [],
  });
  return (res?.result as unknown[]) ?? [];
}

async function waitForSpotifyCaptures(tabId: number, profileId: string, timeoutMs: number): Promise<unknown[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const caps = await readSpotifyCaptures(tabId);
    const hit = caps.some((c) => (c as { data?: { artistUnion?: { id?: string } } })?.data?.artistUnion?.id === profileId);
    if (hit) return caps;
    await new Promise((r) => setTimeout(r, 500));
  }
  return readSpotifyCaptures(tabId);
}

/**
 * The artist page hands over the newest 10 albums and 10 singles. When it also made a paginated
 * request we can re-issue, walk the rest of the catalog with the page's own short-lived credentials,
 * for the artist the user is already looking at.
 */
async function pageThroughCatalog(caps: SpotifyCapture[], have: number): Promise<unknown[]> {
  const paginator = pickPaginator(caps);
  if (!paginator) return [];
  const limit = Math.max(25, Number(paginator.variables[paginator.limitKey]) || 50);
  const extra: unknown[] = [];
  for (let offset = have, page = 0; page < 12; page++, offset += limit) {
    const { url, init } = pageRequest(paginator, offset, limit);
    let json: unknown;
    try {
      const res = await fetch(url, init);
      if (!res.ok) break;
      json = await res.json();
    } catch {
      break;
    }
    const before = extra.length;
    extra.push(json);
    // Stop as soon as a page adds nothing new.
    const merged = parseSpotifyCaptures([...caps, ...extra], "", new Date().toISOString());
    if (extra.length === before || !merged.items.length) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  return extra;
}

/**
 * @param driveThePage true only for the background tab, where operating the page's own controls
 *   (sorting a grid, expanding it) is ours to do. Never for a tab the reader has open.
 */
export async function extractFromTab(
  tabId: number,
  platform: Platform,
  profileId: string,
  driveThePage = false,
): Promise<ExtractResult> {
  if (platform === "spotify" && !profileId.includes(":")) {
    // Structured data first; the DOM is virtualized and only a fallback.
    await log("Waiting for Spotify to hand over the catalogue (up to 12s)");
    const caps = (await waitForSpotifyCaptures(tabId, profileId, 12000)) as SpotifyCapture[];
    const now = new Date().toISOString();
    let parsed = parseSpotifyCaptures(caps, profileId, now);
    if (parsed.items.length) {
      const counts = parsed.counts ?? {};
      const total = counts["all"] ?? (counts["albums"] ?? 0) + (counts["singles"] ?? 0) + (counts["compilations"] ?? 0);
      const own = parsed.items.filter((i) => i.kind !== "appears_on").length;
      if (total > own) {
        await log(`Spotify says ${total} releases and sent ${own}; paging through the rest`);
        const extra = await pageThroughCatalog(caps, own);
        if (extra.length) parsed = parseSpotifyCaptures([...caps, ...extra], profileId, now);
      }
      const seen = parsed.items.filter((i) => i.kind !== "appears_on").length;
      parsed.partial = total > seen;
      return parsed;
    }
  }
  await log("Reading the page contents");
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content/extract.js"] });
  const res = (await withTimeout(
    chrome.tabs.sendMessage(tabId, { type: "extract:run", platform, profileId, driveThePage }),
    EXTRACT_TIMEOUT_MS,
    "Reading the page",
  )) as { ok: true; result: ExtractResult } | { ok: false; error: string };
  if (!res.ok) throw new Error(res.error);
  return res.result;
}

/** A big catalogue is slow to read; nothing is slow for this long because it is working. */
const EXTRACT_TIMEOUT_MS = 90_000;
/** Everything one page can take: load, settle, read, and for Spotify paging the rest of it. */
const RENDER_TIMEOUT_MS = 180_000;

/**
 * Cover the background page with a sign saying whose window this is.
 *
 * Chrome gives an extension a popup window with no address bar and no tab strip, so what the user
 * sees is a chromeless Spotify with an unfamiliar icon in the taskbar: the exact shape of a phishing
 * window. The page underneath still has to load and still has to be read, so it is covered rather
 * than replaced, and the title and favicon are changed so the taskbar agrees with the window.
 *
 * Runs in the page, so it is self-contained: nothing here may refer to anything outside it.
 */
function paint(heading: string, detail: string, iconUrl: string): void {
  const ID = "sloppycat-curtain";
  // Prefixed rather than replaced: the page's own title is evidence. Amazon serves a captcha as
  // "Robot Check", and throwing that away would turn a challenge into a silent empty catalogue.
  const mark = "Sloppycat is reading — ";
  // Stripped before prefixing rather than guarded with startsWith: the sign is re-applied on every
  // navigation event, two of which can read the title before either has written it, and the guard
  // then passes twice. Doing it this way lands on the same answer however many times it runs.
  let base = document.title;
  while (base.startsWith(mark)) base = base.slice(mark.length);
  document.title = mark + base;
  // The favicon is what the taskbar shows, and Spotify's own makes this look like Spotify's window.
  for (const l of Array.from(document.querySelectorAll("link[rel~='icon']"))) l.remove();
  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.href = iconUrl;
  document.head?.appendChild(icon);

  // Keyframes cannot be written inline, so the spinner needs a stylesheet. Added once.
  if (!document.getElementById(ID + "-style")) {
    const style = document.createElement("style");
    style.id = ID + "-style";
    style.textContent =
      "@keyframes sloppycat-spin{to{transform:rotate(360deg)}}" +
      "#" + ID + " .sc-spin{animation:sloppycat-spin 0.9s linear infinite}" +
      "@media (prefers-reduced-motion:reduce){#" + ID + " .sc-spin{animation:none;opacity:0.6}}";
    (document.head ?? document.documentElement).appendChild(style);
  }

  // Rebuilding on every navigation event churns the DOM, and the extractor decides a page has
  // settled by watching for the DOM to go quiet. Saying the same thing again is not worth fighting
  // it for, so an unchanged sign is left alone.
  const stamp = `${heading}|${detail}`;
  const existing = document.getElementById(ID);
  if (existing && existing.dataset.sloppycatStamp === stamp) return;

  let el = existing;
  if (!el) {
    el = document.createElement("div");
    el.id = ID;
    el.setAttribute("role", "status");
    // Translucent, so the page being examined stays visible behind the sign. Seeing the work
    // happen is what makes it read as deliberate rather than as something covering its tracks.
    el.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "background:rgba(9,9,11,0.72)",
      "backdrop-filter:blur(2px)",
      "-webkit-backdrop-filter:blur(2px)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:24px",
      "font:14px/1.6 system-ui,-apple-system,Segoe UI,sans-serif",
    ].join(";");
    (document.body ?? document.documentElement).appendChild(el);
  }
  el.dataset.sloppycatStamp = stamp;
  el.textContent = "";

  const card = document.createElement("div");
  card.style.cssText = [
    "background:#131316",
    "border:1px solid #2a2a30",
    "border-radius:14px",
    "box-shadow:0 18px 50px rgba(0,0,0,0.55)",
    "padding:26px 30px",
    "max-width:560px",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "gap:10px",
    "text-align:center",
    "color:#f4f4f5",
  ].join(";");
  el.appendChild(card);

  // Icon and spinner together: the spinner is the part that says this is still going.
  const top = document.createElement("div");
  top.style.cssText = "display:flex;align-items:center;gap:12px";
  const img = document.createElement("img");
  img.src = iconUrl;
  img.alt = "";
  img.width = 40;
  img.height = 40;
  top.appendChild(img);
  const spin = document.createElement("div");
  spin.className = "sc-spin";
  spin.style.cssText =
    "width:20px;height:20px;border-radius:50%;border:2px solid #3f3f46;border-top-color:#e8a33d;flex:none";
  top.appendChild(spin);
  card.appendChild(top);

  // The name first. Someone who finds this window needs to know whose it is before anything else.
  const brand = document.createElement("div");
  brand.style.cssText = "font-size:19px;font-weight:650;letter-spacing:-0.01em";
  brand.textContent = "Sloppycat";
  card.appendChild(brand);

  const where = document.createElement("div");
  where.style.cssText =
    "max-width:56ch;color:#a1a1aa;font-size:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all";
  where.textContent = heading;
  card.appendChild(where);

  // One line. Whose window it is and that it goes away by itself is the whole message; why it is
  // scanning is something the person who set it scanning already knows.
  const d = document.createElement("div");
  d.style.cssText = "color:#71717a;font-size:12px";
  d.textContent = `${detail}. This window closes itself.`;
  card.appendChild(d);
}

/**
 * Put the sign up, or change what it says. Cheap enough to call on every navigation event, which is
 * what it takes to beat the page's own paint: the window is on screen while the page loads.
 */
async function showCurtain(tabId: number, heading: string, detail: string): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: paint,
      args: [heading, detail, chrome.runtime.getURL("icons/icon-48.png")],
      injectImmediately: true,
    });
  } catch {
    // The page can be mid-navigation, or gone. The next event puts it up.
  }
}

/**
 * Set when the user closes the background window. Closing it is an instruction, not a fault: the run
 * stops there rather than opening another one, and nothing reopens until the user asks again. Asking
 * again means starting a check or any other piece of work, which is what `resume` is for.
 */
let abandoned = false;

/** Did the user close the background window during the current piece of work? */
export function stoppedByUser(): boolean {
  return abandoned;
}

/** A new piece of work was asked for, so a window closed during an earlier one no longer stops it. */
export function resume(): void {
  abandoned = false;
}

/** Say, in the URL, that this Spotify page is one the extension opened. See OWN_PAGE_MARK. */
function markOwnPage(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname !== "open.spotify.com") return url;
    u.hash = OWN_PAGE_MARK;
    return u.toString();
  } catch {
    return url;
  }
}

export function render(url: string, platform: Platform, profileId: string): Promise<ExtractResult> {
  const job = renderQueue.then(async () => {
    if (abandoned) throw new Error(RENDER_CLOSED);
    budget.spend();
    rendersInFlight++;
    try {
      const { tabId } = await getHiddenTab();
      // One reused tab rather than one per page: there is never a second tab to notice, and never a
      // stray tab left behind if the worker is stopped between opening and closing it.
      await log(`Loading ${short(url)}`);
      const where = short(url);
      const why = "Scanning";
      // Re-applied on every navigation event for this tab: each one repaints the page and takes the
      // sign with it. The listener goes at the end of the render.
      const repaint = (id: number) => {
        if (id === tabId) void showCurtain(tabId, where, why);
      };
      chrome.tabs.onUpdated.addListener(repaint);
      try {
        return await withTimeout(
          (async () => {
            await chrome.tabs.update(tabId, { url: markOwnPage(url), active: false });
            await showCurtain(tabId, where, why);
            await waitForLoad(tabId, 20000);
            await log("Page loaded, letting it settle");
            await showCurtain(tabId, where, "Reading the page");
            await new Promise((r) => setTimeout(r, 1500));
            return await extractFromTab(tabId, platform, profileId, true);
          })(),
          RENDER_TIMEOUT_MS,
          `Reading ${where}`,
        );
      } finally {
        chrome.tabs.onUpdated.removeListener(repaint);
      }
    } catch (e) {
      // There is deliberately no retry here. Reopening a window the user just closed is what made
      // this feel like it was fighting them.
      if (e instanceof Error && /gave up after/.test(e.message)) await log(e.message, true);
      if (isGone(e)) {
        abandoned = true;
        hidden = undefined;
        await rememberHidden(undefined);
        await log("You closed the background window, so the check stopped here.");
        throw new Error(RENDER_CLOSED);
      }
      throw e;
    } finally {
      rendersInFlight--;
      // Park on a blank page rather than leave the profile running, then drop the window once the
      // queue behind it is empty.
      if (hidden && !abandoned) {
        try {
          await chrome.tabs.update(hidden.tabId, { url: "about:blank" });
        } catch {
          /* already gone */
        }
      }
      closeHiddenSoon();
    }
  });
  renderQueue = job.catch(() => undefined);
  return job;
}

/** A page address short enough to read in a status line. */
function short(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 40 ? `${u.pathname.slice(0, 39)}…` : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return url;
  }
}
