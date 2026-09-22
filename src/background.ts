// Service worker: alarms, run loop, hidden-tab rendering, offscreen parsing, list refresh, messaging.
import type { Alert, ExtractResult, ListChange, Message, Platform, Profile, RunState, SnapshotItem } from "./types";
import { profileKey as keyOf, itemKey, isRunning, MAX_RUN_LOG } from "./types";
import * as storage from "./storage";
import { adapterFor, detectProfile, type FetchContext } from "./adapters";
import { diffSnapshots } from "./diff";
import { isGone, RENDER_CLOSED, RenderBudget } from "./render-guard";
import { signalsFor, lookalikeSignal } from "./signals";
import { addSource, ensureDefaultSources, refreshAll, lookup, unprovenClaims } from "./lists/sources";
import { hasListAccess, hostOf } from "./lists/permissions";
import { MAX_CHANGES, summarize } from "./lists/changes";
import { verifyProfile, runClaimCheck } from "./lists/verify";
import { getClaim, isFresh } from "./lists/claims";
import { mergeCreatorDoc } from "./lists/format";
import {
  countsOf,
  driftBetween,
  pageRequest,
  parseSpotifyCaptures,
  pickPaginator,
  type SpotifyCapture,
} from "./adapters/spotify-json";

const ALARM_RUN = "sloppycat:run";
const ALARM_LISTS = "sloppycat:lists";

// ---------- scheduling ----------

async function scheduleAlarms(): Promise<void> {
  const settings = await storage.get("settings");
  const period = Math.max(15, settings.intervalMinutes);
  const jitter = period * (Math.random() * 0.2 - 0.1);
  await chrome.alarms.create(ALARM_RUN, { delayInMinutes: 1, periodInMinutes: period + jitter });
  await chrome.alarms.create(ALARM_LISTS, { delayInMinutes: 2, periodInMinutes: 360 });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureDefaultSources();
  await scheduleAlarms();
  if (details.reason === "install") {
    await openPage("ui/onboard/index.html");
  }
});
chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaultSources();
  await scheduleAlarms();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_RUN) void runAll();
  if (alarm.name === ALARM_LISTS) void refreshLists();
});

/** Scheduled list refresh: unlike the one Settings triggers, this one is worth telling you about. */
async function refreshLists(): Promise<void> {
  const changes = await refreshAll();
  await notifyListChanges(changes);
}

storage.onChange(["settings"], () => void scheduleAlarms());

/**
 * Show one of the extension's own pages, reusing the tab it is already in. A notification per check
 * opening a tab per click is how you end up with nine copies of the alerts page.
 */
async function openPage(path: string): Promise<void> {
  const [file, hash] = path.split("#");
  const url = chrome.runtime.getURL(file!);
  try {
    const existing = (await chrome.tabs.query({ url })).find((t) => t.id !== undefined);
    if (existing?.id !== undefined) {
      await chrome.tabs.update(existing.id, { active: true, ...(hash ? { url: `${url}#${hash}` } : {}) });
      if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch {
    /* falling through opens a new tab, which is the old behaviour */
  }
  await chrome.tabs.create({ url: hash ? `${url}#${hash}` : url });
}

// ---------- run commentary ----------

/**
 * Append a line to the running commentary. Every page load, every wait and every result goes
 * through here, because the alternative is a window appearing with no explanation, which is a
 * window that gets closed.
 */
async function log(text: string, bad = false): Promise<void> {
  const at = new Date().toISOString();
  await storage.update("runState", (cur) => {
    // Lazily open one rather than dropping the line. Work started from the wizard is not a run, and
    // a page load nobody narrates is a page load the user closes.
    const base = cur && !cur.endedAt ? cur : { startedAt: at, queue: [], done: 0, log: [] };
    return { ...base, beatAt: at, log: [...base.log, { at, text, bad }].slice(-MAX_RUN_LOG) };
  });
}

/**
 * Narrate a piece of work that is not a scheduled run: a snapshot from the wizard, a claim check.
 * These open the same background window and take just as long, so they get the same commentary.
 */
async function activity<T>(phase: string, fn: () => Promise<T>): Promise<T> {
  const ours = !isRunning(await storage.get("runState"));
  if (ours) {
    const at = new Date().toISOString();
    await storage.set("runState", { startedAt: at, beatAt: at, queue: [], done: 0, log: [], phase });
    await log(phase);
  }
  try {
    return await fn();
  } catch (e) {
    if (ours) await log(e instanceof Error ? e.message : String(e), true);
    throw e;
  } finally {
    if (ours) {
      await setRun(null);
      await closeHidden();
    }
  }
}

// ---------- hidden-tab rendering ----------

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

const budget = new RenderBudget();

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
async function closeOrphanHidden(): Promise<void> {
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

export async function extractFromTab(tabId: number, platform: Platform, profileId: string): Promise<ExtractResult> {
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
  const res = (await chrome.tabs.sendMessage(tabId, { type: "extract:run", platform, profileId })) as
    | { ok: true; result: ExtractResult }
    | { ok: false; error: string };
  if (!res.ok) throw new Error(res.error);
  return res.result;
}

/**
 * Set when the user closes the background window. Closing it is an instruction, not a fault: the run
 * stops there rather than opening another one, and nothing reopens until the user asks again.
 */
let abandoned = false;

export function wasAbandoned(): boolean {
  return abandoned;
}

function render(url: string, platform: Platform, profileId: string): Promise<ExtractResult> {
  const job = renderQueue.then(async () => {
    if (abandoned) throw new Error(RENDER_CLOSED);
    budget.spend();
    rendersInFlight++;
    try {
      const { tabId } = await getHiddenTab();
      // One reused tab rather than one per page: there is never a second tab to notice, and never a
      // stray tab left behind if the worker is stopped between opening and closing it.
      await log(`Loading ${short(url)}`);
      await chrome.tabs.update(tabId, { url, active: false });
      await waitForLoad(tabId, 20000);
      await log("Page loaded, letting it settle");
      await new Promise((r) => setTimeout(r, 1500));
      return await extractFromTab(tabId, platform, profileId);
    } catch (e) {
      // There is deliberately no retry here. Reopening a window the user just closed is what made
      // this feel like it was fighting them.
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

// ---------- offscreen HTML parsing ----------

let offscreenReady: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (!offscreenReady) {
    offscreenReady = (async () => {
      const has = await chrome.offscreen.hasDocument?.();
      if (!has) {
        await chrome.offscreen.createDocument({
          url: "offscreen/index.html",
          reasons: [chrome.offscreen.Reason.DOM_PARSER],
          justification: "Parse server-rendered catalog pages",
        });
      }
    })();
  }
  return offscreenReady;
}

async function parseHtml(html: string, url: string, platform: Platform, profileId: string): Promise<ExtractResult> {
  await ensureOffscreen();
  const res = (await chrome.runtime.sendMessage({ type: "offscreen:parse", html, url, platform, profileId })) as
    | { ok: true; result: ExtractResult }
    | { ok: false; error: string };
  if (!res || !res.ok) throw new Error(res?.error ?? "offscreen parse failed");
  return res.result;
}

function ctx(): FetchContext {
  return { now: new Date().toISOString(), render, parseHtml };
}

// ---------- run loop ----------

let running = false;

/** Publish what the run is doing, so a click on "Check now" is visibly doing something. */
async function setRun(patch: Partial<RunState> | null): Promise<void> {
  if (patch === null) {
    await storage.update("runState", (cur) => (cur ? { ...cur, endedAt: new Date().toISOString(), currentKey: undefined, currentLabel: undefined, phase: undefined } : cur));
    return;
  }
  const beatAt = new Date().toISOString();
  await storage.update("runState", (cur) => ({ ...(cur ?? { startedAt: beatAt, queue: [], done: 0, log: [] }), ...patch, beatAt }));
}

export async function runAll(profileKeys?: string[]): Promise<void> {
  // A second run while one is going would fight the first over the same background tab. This flag is
  // the only authority on that: runs happen in the worker and nowhere else, so a worker that says it
  // is not running is not running. The stored state is for the UI, and a run Chrome killed leaves it
  // saying "running" forever; consulting it here would let that skip real checks.
  if (running) return;
  running = true;
  try {
    const settings = await storage.get("settings");
    if (settings.mode === "consumer") return;
    const profiles = await storage.get("profiles");
    const queue = (profileKeys ?? Object.keys(profiles)).filter((k) => profiles[k]);
    const startedAt = new Date().toISOString();
    await storage.set("runState", { startedAt, beatAt: startedAt, queue, done: 0, log: [] });
    budget.startRun(queue.length);
    abandoned = false;
    const counter = await storage.update("runCounter", (n) => n + 1);
    // Lookalike search is opt-in: it reads titles, not provenance, so most of what it finds is a
    // coincidence rather than a hijack.
    const doLookalike =
      settings.experiments.lookalikeSearch && counter % Math.max(1, settings.lookalikeEveryNRuns) === 0;
    await log(`Checking ${queue.length} profile${queue.length === 1 ? "" : "s"}`);
    for (const key of queue) {
      const p = profiles[key]!;
      await setRun({ currentKey: key, currentLabel: p.displayName ?? p.profileId, phase: `Reading ${adapterFor(p.platform).label}` });
      await log(`${p.displayName ?? p.profileId} on ${adapterFor(p.platform).label}`);
      await runProfile(p, doLookalike);
      await setRun({ done: (await storage.get("runState"))!.done + 1 });
      if (abandoned) {
        await log("Stopping here. Run the check again when you are ready.", true);
        break;
      }
      if (key !== queue[queue.length - 1]) await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
    }
    if (!abandoned) {
      await setRun({ currentKey: undefined, currentLabel: undefined, phase: "Checking claims on the lists you subscribe to" });
      for (const key of queue) {
        const p = profiles[key];
        if (p) await proveClaimsFor(p.platform, p.url);
        if (abandoned) break;
      }
    }
    await log(abandoned ? "Check stopped." : "Check finished.");
  } finally {
    running = false;
    budget.endRun();
    await setRun(null);
    // The window exists for the run; when the run is over it has no reason to still be there.
    await closeHidden();
  }
}

export async function runProfile(profile: Profile, doLookalike: boolean): Promise<void> {
  const key = keyOf(profile);
  const adapter = adapterFor(profile.platform);
  const c = ctx();
  const who = profile.displayName ?? profile.profileId;
  try {
    // The bio comes back with the snapshot on every platform that has one, so reading it costs
    // nothing extra once the page is already open. On your own page it is checked for your list
    // link; on a page you follow it is where their list would be announced.
    const wantBio = adapter.supportsBio;
    const result = await adapter.fetchSnapshot(profile.profileId, c, { withBio: wantBio });
    await log(`${who}: found ${result.items.length} release${result.items.length === 1 ? "" : "s"}`);
    await ingestSnapshot(profile, result, doLookalike);
    await storage.update("profiles", (all) => ({
      ...all,
      [key]: { ...all[key]!, lastRunAt: c.now, lastError: undefined, displayName: result.displayName ?? all[key]!.displayName },
    }));
    if (wantBio) {
      if (profile.watchOnly) await findTheirList(profile, result.bio);
      else await checkOwnList(profile, result.bio);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log(`${who}: ${msg}`, true);
    await storage.update("profiles", (all) => ({
      ...all,
      [key]: { ...all[key]!, lastRunAt: c.now, lastError: msg },
    }));
  }
}

/**
 * Look for a list the artist publishes, on a page the user follows.
 *
 * Finding it was a button the user had to know to press, which is the wrong way round: the check
 * already opens the page and already reads the bio, so the link is sitting there either way. The
 * bio is the proof as well as the announcement - only the account holder can edit it - so a list
 * found this way is one the artist put their name to, and it is subscribed to on the spot.
 *
 * The exception is a list on a host the extension has no permission for. Chrome only grants those
 * from a click, which a background check does not have, so it is recorded and the page offers it.
 */
async function findTheirList(profile: Profile, bio: string | undefined): Promise<{ listUrl?: string; subscribed: boolean; reason?: string }> {
  const key = keyOf(profile);
  const who = profile.displayName ?? profile.profileId;
  await log(`${who}: looking for a list they publish`);
  const v = await verifyProfile(profile, bio);
  await storage.update("profiles", (all) => ({ ...all, [key]: { ...all[key]!, verifiedListUrl: v.ok ? v.listUrl : undefined } }));
  if (!v.ok || !v.listUrl) {
    await log(`${who}: ${v.reason ?? "no list linked from their bio"}`);
    return { subscribed: false, reason: v.reason };
  }
  const sources = await storage.get("listSources");
  if (sources.some((x) => x.url === v.listUrl)) return { listUrl: v.listUrl, subscribed: true };
  if (!(await hasListAccess(v.listUrl))) {
    await log(`${who}: publishes a list at ${hostOf(v.listUrl)}, which needs your permission before it can be read`, true);
    return { listUrl: v.listUrl, subscribed: false, reason: "needs-permission" };
  }
  await addSource(v.listUrl);
  await log(`${who}: subscribed to the list they publish`);
  return { listUrl: v.listUrl, subscribed: true };
}

/**
 * Look for the user's own list in the profile bio, as part of the check rather than as a button
 * they have to know to press. The page is already open at this point, so it is free.
 */
async function checkOwnList(profile: Profile, bio: string | undefined): Promise<void> {
  const key = keyOf(profile);
  const who = profile.displayName ?? profile.profileId;
  await log(`${who}: looking for your list link in the bio`);
  const v = await verifyProfile(profile, bio);
  await storage.update("profiles", (all) => ({
    ...all,
    [key]: { ...all[key]!, verified: v.ok, verifiedListUrl: v.ok ? v.listUrl : undefined },
  }));
  await log(v.ok ? `${who}: list link found and it names this profile` : `${who}: ${v.reason ?? "no list link yet"}`, !v.ok);
}

/** Store the snapshot, diff against the previous one, raise alerts. Shared by polling and the wizard. */
export async function ingestSnapshot(profile: Profile, result: ExtractResult, doLookalike: boolean): Promise<Alert[]> {
  const key = keyOf(profile);
  const adapter = adapterFor(profile.platform);
  const c = ctx();
  const snapshots = await storage.get("snapshots");
  const prev = snapshots[key];
  const myList = await storage.get("myList");
  const mine = new Set(myList?.mine.filter((r) => r.platform === profile.platform).map((r) => r.id) ?? []);
  const notMine = new Set(myList?.notMine.filter((r) => r.platform === profile.platform).map((r) => r.id) ?? []);

  // Preserve firstSeen from the previous snapshot.
  const prevMap = new Map((prev?.items ?? []).map((i) => [i.itemId, i]));
  const items = result.items.map((i) => ({ ...i, firstSeen: prevMap.get(i.itemId)?.firstSeen ?? i.firstSeen }));
  await storage.update("snapshots", (all) => ({
    ...all,
    [key]: { profileKey: key, takenAt: c.now, items, counts: result.counts ?? prev?.counts },
  }));

  const newAlerts: Alert[] = [];

  // A release dated in the past never shows up in a newest-first window, so compare the counts the
  // platform reports as well as the items it handed us.
  const drift = driftBetween(prev?.counts, result.counts ?? {});
  if (drift.length && prev) {
    const addedVisible = prev ? result.items.filter((i) => !prevMap.has(i.itemId)).length : 0;
    for (const d of drift) {
      if (d.added <= addedVisible) continue;
      newAlerts.push({
        id: crypto.randomUUID(),
        profileKey: key,
        createdAt: c.now,
        change: "count_drift",
        signals: [{ kind: "count_drift", category: d.category, added: d.added, seen: addedVisible }],
        item: {
          platform: profile.platform,
          itemId: `counts:${d.category}`,
          title: `${d.added} more ${d.category} than last time, and not all of them are visible`,
          kind: "unknown",
          url: `${profile.url}/discography/all`,
          firstSeen: c.now,
          source: "profile",
        },
      });
    }
  }

  if (prev) {
    const d = diffSnapshots(prev.items, items);
    for (let added of d.added) {
      if (mine.has(added.itemId) || notMine.has(added.itemId)) continue;
      if (adapter.enrich) added = await adapter.enrich(added, c);
      newAlerts.push({
        id: crypto.randomUUID(),
        profileKey: key,
        createdAt: c.now,
        item: added,
        change: "added",
        signals: signalsFor(added, prev.items),
      });
    }
    for (const ch of d.changed) {
      if (mine.has(ch.after.itemId)) continue;
      newAlerts.push({
        id: crypto.randomUUID(),
        profileKey: key,
        createdAt: c.now,
        item: ch.after,
        change: "changed",
        signals: [],
      });
    }
  }

  if (doLookalike && adapter.searchLookalikes && items.length) {
    const watched = items.filter((i) => mine.size === 0 || mine.has(i.itemId));
    const existing = await storage.get("alerts");
    const alreadyAlerted = new Set(Object.values(existing).map((a) => itemKey(a.item)));
    // Search the most recent few titles; that is where clones cluster.
    const owner = result.displayName ?? profile.displayName;
    for (const w of watched.slice(0, 3)) {
      try {
        await log(`Searching ${adapter.label} for copies of "${w.title}"`);
        const found = await adapter.searchLookalikes(w.title, c);
        for (const cand of found) {
          if (items.some((i) => i.itemId === cand.itemId)) continue;
          if (alreadyAlerted.has(itemKey(cand))) continue;
          // The artist's own records come back in their own search results, often under a second
          // id for another market, so the creator is passed in and their own catalogue is skipped.
          const sig = lookalikeSignal(cand, [w], { name: profile.displayName ?? result.displayName ?? owner, id: profile.profileId });
          if (!sig) continue;
          alreadyAlerted.add(itemKey(cand));
          newAlerts.push({
            id: crypto.randomUUID(),
            profileKey: key,
            createdAt: c.now,
            item: cand,
            change: "lookalike",
            signals: [sig, ...signalsFor(cand, items)],
          });
        }
      } catch {
        /* search failures are non-fatal */
      }
    }
  }

  if (newAlerts.length) {
    await storage.update("alerts", (all) => {
      const next = { ...all };
      for (const a of newAlerts) next[a.id] = a;
      return next;
    });
    await notify(profile, newAlerts);
  }

  // Verification: a bio that links to a list which names this profile.
  if (result.bio !== undefined || profile.verified === undefined) {
    const v = await verifyProfile({ ...profile, displayName: result.displayName ?? profile.displayName }, result.bio);
    await storage.update("profiles", (all) => ({
      ...all,
      [key]: { ...all[key]!, verified: v.ok, verifiedListUrl: v.ok ? v.listUrl : all[key]?.verifiedListUrl },
    }));
  }
  return newAlerts;
}

async function notify(profile: Profile, alerts: Alert[]): Promise<void> {
  const settings = await storage.get("settings");
  if (!settings.notifications) return;
  const first = alerts[0]!;
  const who = profile.displayName ?? profile.url;
  const title = alerts.length === 1 ? `New item on ${who}` : `${alerts.length} new items on ${who}`;
  const message =
    alerts.length === 1
      ? `"${first.item.title}"${first.signals.length ? " · " + first.signals.length + " signal(s)" : ""}`
      : alerts.map((a) => a.item.title).slice(0, 3).join(", ");
  await chrome.notifications.create(`alert:${first.id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title,
    message,
    priority: 2,
  });
}

/**
 * One notification per refresh, not one per row: a community list can add fifty things at once, and
 * fifty toasts would teach people to turn the whole thing off.
 */
async function notifyListChanges(changes: ListChange[]): Promise<void> {
  if (!changes.length) return;
  const settings = await storage.get("settings");
  // Gated on its own toggle only: watching pages without badging them is what following an artist
  // looks like, and that is exactly when a list you subscribe to changing its mind matters.
  if (!settings.notifications || !settings.listUpdates) return;
  const { title, message } = summarize(changes);
  await chrome.notifications.create(`lists:${changes[0]!.id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title,
    message,
    priority: 1,
  });
}

chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith("lists:")) {
    const changeId = id.slice(6);
    void openPage(`ui/changes/index.html${changeId ? `#${changeId}` : ""}`);
    return;
  }
  const alertId = id.startsWith("alert:") ? id.slice(6) : "";
  void openPage(`ui/alert/index.html${alertId ? `#${alertId}` : ""}`);
});

// ---------- claim checking ----------

let proving = new Set<string>();

/** Verify any unproven claim over the profile the viewer is looking at, one at a time. */
async function proveClaimsFor(platform: Platform, profileUrl: string): Promise<void> {
  let pending: string[];
  try {
    pending = await unprovenClaims(platform, profileUrl);
  } catch {
    return;
  }
  for (const listUrl of pending) {
    const key = `${listUrl}|${platform}`;
    if (proving.has(key)) continue;
    const existing = await getClaim(listUrl, platform);
    if (isFresh(existing)) continue; // already checked recently, good or bad
    proving.add(key);
    try {
      await runClaimCheck(listUrl, platform, ctx());
    } catch {
      /* a failed check just leaves the list untrusted */
    } finally {
      proving.delete(key);
    }
  }
}

// ---------- creator decisions ----------

async function resolveAlert(
  alertId: string,
  resolution: "mine" | "not_mine" | "dismissed",
  disclosure?: Record<string, string>,
  note?: string,
): Promise<void> {
  const alerts = await storage.get("alerts");
  const a = alerts[alertId];
  if (!a) return;
  a.resolution = resolution;
  a.resolvedAt = new Date().toISOString();
  await storage.set("alerts", { ...alerts, [alertId]: a });
  if (resolution === "dismissed") return;

  const profiles = await storage.get("profiles");
  const p = profiles[a.profileKey];
  // A page you follow as a fan is not yours to speak for: resolving there records what you decided and
  // stops. Writing it into your own list would put someone else's profile in your Creator table.
  if (p?.watchOnly) return;
  const settings = await storage.get("settings");
  const existing = await storage.get("myList");
  const creator = p ? [{ platform: p.platform, profile: p.url }] : [];
  const title = existing?.title ?? `${p?.displayName ?? "My"} — verified catalog`;
  const doc = mergeCreatorDoc(existing, {
    title,
    creator,
    mine:
      resolution === "mine"
        ? [{ platform: a.item.platform, id: a.item.itemId, title: a.item.title, disclosure: disclosure ?? settings.defaultDisclosure }]
        : [],
    notMine:
      resolution === "not_mine"
        ? [{ platform: a.item.platform, id: a.item.itemId, title: a.item.title, firstSeen: a.item.firstSeen.slice(0, 10), note }]
        : [],
  });
  await storage.set("myList", doc);
}

// ---------- messaging ----------

chrome.runtime.onMessage.addListener((msg: Message | { type: string }, sender, sendResponse) => {
  (async () => {
    // Pages the extension loads for itself run the same content scripts as pages the user opened,
    // and those scripts ask the background questions. Answering them is how a single check turned
    // into a stream of page loads: a claim check rendered an artist page, the overlay in that page
    // asked about the same profile, and that asked for another render. The background tab is not a
    // page anybody is looking at, so nothing it says is acted on.
    if (await isHiddenTab(sender.tab?.id)) return { ok: true, verdicts: {} };
    switch (msg.type) {
      case "run:now": {
        // Both paths go through runAll, so a single-profile check reports progress and closes the
        // background window the same way a full run does.
        const m = msg as Extract<Message, { type: "run:now" }>;
        await runAll(m.profileKey ? [m.profileKey] : undefined);
        return { ok: true };
      }
      case "profile:add": {
        const m = msg as Extract<Message, { type: "profile:add" }>;
        const det = detectProfile(m.url);
        if (!det) return { ok: false, error: "Not a recognized profile URL" };
        const profile: Profile = { platform: det.platform, profileId: det.profileId, url: det.url, addedAt: new Date().toISOString(), watchOnly: m.watchOnly };
        await storage.update("profiles", (all) => ({ ...all, [keyOf(profile)]: all[keyOf(profile)] ?? profile }));
        void runProfile(profile, false);
        return { ok: true, profileKey: keyOf(profile) };
      }
      case "profile:watchOnly": {
        const m = msg as Extract<Message, { type: "profile:watchOnly" }>;
        await storage.update("profiles", (all) => (all[m.profileKey] ? { ...all, [m.profileKey]: { ...all[m.profileKey]!, watchOnly: m.watchOnly } } : all));
        return { ok: true };
      }
      case "profile:remove": {
        const m = msg as Extract<Message, { type: "profile:remove" }>;
        await storage.update("profiles", (all) => {
          const n = { ...all };
          delete n[m.profileKey];
          return n;
        });
        await storage.update("snapshots", (all) => {
          const n = { ...all };
          delete n[m.profileKey];
          return n;
        });
        return { ok: true };
      }
      case "alert:resolve": {
        const m = msg as Extract<Message, { type: "alert:resolve" }>;
        await resolveAlert(m.alertId, m.resolution, m.disclosure, m.note);
        return { ok: true };
      }
      case "lists:refresh":
        await refreshAll(true);
        return { ok: true };
      case "lists:lookup": {
        const m = msg as Extract<Message, { type: "lists:lookup" }> & {
          profileUrl?: string;
          pageIds?: Record<string, import("./types").Identifiers>;
        };
        // Deliberately does not start a claim check. Proving a claim means loading the artist's
        // page, and doing that from a page event is what let one visit turn into a stream of them:
        // the loaded page ran the same content script, which asked the same question again. Claims
        // are proved during a check instead, where the work is counted and reported.
        return { ok: true, verdicts: await lookup(m.platform, m.ids, m.profileUrl, m.pageIds) };
      }
      case "claims:check": {
        const m = msg as Extract<Message, { type: "claims:check" }>;
        const claim = await runClaimCheck(m.listUrl, m.platform, ctx());
        return { ok: claim.state === "verified", claim };
      }
      case "list:fromBio": {
        // The wizard has just taken a snapshot and holds the bio, so this costs no second page load.
        const m = msg as Extract<Message, { type: "list:fromBio" }>;
        const p = (await storage.get("profiles"))[m.profileKey];
        if (!p) return { ok: false, error: "Unknown profile" };
        const r = await findTheirList(p, m.bio);
        return { ok: true, ...r };
      }
      case "verify:profile": {
        const m = msg as Extract<Message, { type: "verify:profile" }>;
        const p = (await storage.get("profiles"))[m.profileKey];
        if (!p) return { ok: false, error: "Unknown profile" };
        const adapter = adapterFor(p.platform);
        return activity(`Looking for your list link on ${adapter.label}`, async () => {
        const result = await adapter.fetchSnapshot(p.profileId, ctx(), { withBio: true });
        const v = await verifyProfile(p, result.bio);
        await storage.update("profiles", (all) => ({
          ...all,
          [m.profileKey]: { ...all[m.profileKey]!, verified: v.ok, verifiedListUrl: v.ok ? v.listUrl : undefined },
        }));
        await log(v.ok ? "Your bio links to your list and the list names this profile" : (v.reason ?? "Not verified"), !v.ok);
        return { ok: v.ok, reason: v.reason, listUrl: v.listUrl };
        });
      }
      case "snapshot:fromTab": {
        // Wizard path: extract from the tab the creator is looking at.
        const m = msg as Extract<Message, { type: "snapshot:fromTab" }>;
        const tab = await chrome.tabs.get(m.tabId);
        const det = detectProfile(tab.url ?? "");
        if (!det) return { ok: false, error: "This tab is not a supported profile page" };
        const adapter = adapterFor(det.platform);
        return activity(`Reading your ${adapter.label} profile`, async () => {
          // JSON platforms are more complete via their API than via the page.
          let result: ExtractResult;
          if (adapter.strategy === "json" || det.platform === "amazon") {
            // JSON APIs are complete; Amazon's full list is on the allbooks page, not the page the creator is on.
            await log(`Asking ${adapter.label} for the full catalogue`);
            result = await adapter.fetchSnapshot(det.profileId, ctx(), { withBio: true });
          } else {
            await log("Reading the tab you have open");
            result = await extractFromTab(m.tabId, det.platform, det.profileId);
            if (!result.items.length) {
              await log("Nothing on that tab yet, opening the profile in the background instead");
              result = await adapter.fetchSnapshot(det.profileId, ctx(), { withBio: true });
            }
          }
          await log(`Found ${result.items.length} release${result.items.length === 1 ? "" : "s"}`);
          return { ok: true, detected: det, result };
        });
      }
      case "snapshot:full": {
        // The "open it and scroll to the bottom yourself" instruction, done by the extension. The
        // full view is loaded in the background window and paged through like any other page.
        const m = msg as Extract<Message, { type: "snapshot:full" }>;
        const adapter = adapterFor(m.platform);
        const url = adapter.fullCatalogUrl?.(m.profileId);
        if (!url) return { ok: false, error: `${adapter.label} has no separate full-catalogue page` };
        return activity(`Reading the full ${adapter.label} catalogue`, async () => {
          const result = await render(url, m.platform, m.profileId);
          await log(`Found ${result.items.length} release${result.items.length === 1 ? "" : "s"} in the full catalogue`);
          return { ok: true, result };
        });
      }
      case "scan:collect": {
        const m = msg as Extract<Message, { type: "scan:collect" }>;
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: m.tabId },
          // Runs in the page: scrolls so virtualized lists mount, then hands back every link it saw.
          // Ids are parsed on the extension side with the real adapters, so nothing is duplicated here.
          func: async () => {
            const seen = new Map<string, string>();
            const harvest = () => {
              for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
                if (!seen.has(a.href)) {
                  seen.set(
                    a.href,
                    (a.textContent ?? "").replace(/\s+/g, " ").trim() ||
                      a.getAttribute("aria-label") ||
                      a.getAttribute("title") ||
                      a.querySelector("img")?.getAttribute("alt") ||
                      "",
                  );
                }
              }
            };
            const scroller =
              document.querySelector<HTMLElement>("[data-overlayscrollbars-viewport]") ??
              (document.scrollingElement as HTMLElement);
            harvest();
            const startTop = scroller.scrollTop;
            for (let i = 0; i < 60; i++) {
              const before = scroller.scrollTop;
              scroller.scrollTop += Math.max(300, scroller.clientHeight * 0.85);
              await new Promise((r) => setTimeout(r, 220));
              harvest();
              if (scroller.scrollTop === before) break;
            }
            scroller.scrollTop = startTop;
            return [...seen].map(([href, text]) => ({ href, text }));
          },
        });
        return { ok: true, links: (res?.result as { href: string; text: string }[]) ?? [] };
      }
      case "dev:simulate": {
        // Testing aid: plant something on a watched profile so the whole alert path can be exercised
        // without waiting for a real hijack, or owning a catalogue for one to happen to.
        const m = msg as Extract<Message, { type: "dev:simulate" }>;

        if (m.kind === "listupdate") {
          // The consumer half of the same aid: a subscribed list saying something new, without
          // waiting six hours for a refresh or asking an artist to edit their file for you.
          const sources = await storage.get("listSources");
          const src = sources.find((s) => s.enabled);
          const change: ListChange = {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            source: src?.url ?? "local:test",
            listTitle: src?.title ?? "A list you subscribe to",
            listType: src?.type ?? "community",
            kind: "verified",
            platform: "spotify",
            itemId: `test${Math.random().toString(36).slice(2, 8)}`,
            title: "Midnight Jazz Vibes (test) — confirmed by the creator",
            seen: false,
          };
          await storage.update("listChanges", (cur) => [change, ...cur].slice(0, MAX_CHANGES));
          await notifyListChanges([change]);
          return { ok: true };
        }

        const profiles = await storage.get("profiles");
        const profile = m.profileKey ? profiles[m.profileKey] : Object.values(profiles)[0];
        if (!profile) return { ok: false, error: "Watch a profile first, then simulate against it." };
        const pk = keyOf(profile);
        const stamp = new Date().toISOString();
        const suffix = Math.random().toString(36).slice(2, 8);
        const adapter = adapterFor(profile.platform);

        if (m.kind === "drift") {
          const snaps = await storage.get("snapshots");
          const snap = snaps[pk];
          const counts = { ...(snap?.counts ?? { singles: 10 }) };
          const category = Object.keys(counts)[0] ?? "singles";
          const alert: Alert = {
            id: crypto.randomUUID(),
            profileKey: pk,
            createdAt: stamp,
            change: "count_drift",
            signals: [{ kind: "count_drift", category, added: 3, seen: 0 }],
            item: {
              platform: profile.platform,
              itemId: `counts:${category}`,
              title: `3 more ${category} than last time, and none of them are visible`,
              kind: "unknown",
              url: `${profile.url}/discography/all`,
              firstSeen: stamp,
              source: "profile",
            },
          };
          await storage.update("alerts", (all) => ({ ...all, [alert.id]: alert }));
          await notify(profile, [alert]);
          return { ok: true };
        }

        const fake: SnapshotItem = {
          platform: profile.platform,
          itemId: profile.platform === "amazon" ? `B0TEST${suffix.toUpperCase().slice(0, 4)}` : `test${suffix}`,
          title: m.kind === "lookalike" ? "Test Release: Summary & Analysis" : "Midnight Jazz Vibes (test)",
          subtitle: profile.displayName,
          kind: profile.platform === "amazon" || profile.platform === "goodreads" ? "book" : "single",
          releaseDate: stamp.slice(0, 10),
          label: profile.platform === "amazon" ? "Independently published" : "8412 Records DK",
          url: adapter.itemUrl(profile.platform === "amazon" ? "B0TESTFAKE" : "testfake"),
          meta: { simulated: true, reviewCount: 0 },
          firstSeen: stamp,
          source: m.kind === "lookalike" ? "search" : "profile",
        };
        const snapshots = await storage.get("snapshots");
        const history = snapshots[pk]?.items ?? [];
        const alert: Alert = {
          id: crypto.randomUUID(),
          profileKey: pk,
          createdAt: stamp,
          change: m.kind === "lookalike" ? "lookalike" : "added",
          item: fake,
          signals:
            m.kind === "lookalike"
              ? [{ kind: "lookalike", ofTitle: history[0]?.title ?? "Your title", score: 0.93 }, ...signalsFor(fake, history)]
              : signalsFor(fake, history),
        };
        await storage.update("alerts", (all) => ({ ...all, [alert.id]: alert }));
        await notify(profile, [alert]);
        return { ok: true };
      }
      case "open:onboard": {
        const m = msg as Extract<Message, { type: "open:onboard" }>;
        const q = m.platform && m.profileId ? `?platform=${m.platform}&profileId=${encodeURIComponent(m.profileId)}` : "";
        await openPage(`ui/onboard/index.html${q}`);
        return { ok: true };
      }
      case "offscreen:parse":
        return undefined; // handled by the offscreen document
      default:
        return undefined;
    }
  })()
    .then((r) => {
      if (r !== undefined) sendResponse(r);
    })
    .catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true;
});

// Wizard hands finished decisions back through storage; background ingests the snapshot as baseline.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "snapshot:commit") return;
  (async () => {
    const { profile, result } = msg as { profile: Profile; result: ExtractResult };
    await storage.update("profiles", (all) => ({ ...all, [keyOf(profile)]: { ...profile, ...(all[keyOf(profile)] ?? {}) } }));
    await ingestSnapshot(profile, result, false);
    sendResponse({ ok: true });
  })().catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true;
});

// Kick the schedule on worker start in case alarms were lost, and clear up after a worker that was
// stopped mid-check.
void (async () => {
  await closeOrphanHidden();
  // A run this worker is not doing is not running, whatever the last worker left behind.
  await storage.update("runState", (cur) => (cur && !cur.endedAt ? { ...cur, endedAt: new Date().toISOString() } : cur));
  const existing = await chrome.alarms.get(ALARM_RUN);
  if (!existing) await scheduleAlarms();
})();
