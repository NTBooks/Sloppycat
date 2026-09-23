// Service worker: alarms, the run loop, offscreen parsing, list refresh, messaging.
// Reading pages in the background window lives in worker/hidden, the commentary in worker/runlog.
import type { Alert, ExtractResult, ListDocument, Message, Platform, Profile, SnapshotItem } from "./types";
import { profileKey as keyOf, itemKey } from "./types";
import * as storage from "./storage";
import { adapterFor, detectProfile, type FetchContext } from "./adapters";
import { diffSnapshots } from "./diff";
import { signalsFor, lookalikeSignal } from "./signals";
import { addSource, ensureDefaultSources, refreshAll, lookup, unprovenClaims } from "./lists/sources";
import { hasListAccess, hostOf } from "./lists/permissions";
import { verifyProfile, runClaimCheck, type VerifyResult } from "./lists/verify";
import { claimKey, getClaim, isFresh } from "./lists/claims";
import { mergeCreatorDoc } from "./lists/format";
import { driftBetween } from "./adapters/spotify-json";
import { addAlerts, sameReleaseDateOrLater } from "./alerts";
import { log, setRun } from "./worker/runlog";
import { budget, closeHidden, closeOrphanHidden, extractFromTab, isHiddenTab, render, resume, stoppedByUser } from "./worker/hidden";
import { notify, notifyListChanges, simulate } from "./worker/simulate";

const ALARM_RUN = "sloppycat:run";
const ALARM_LISTS = "sloppycat:lists";

// ---------- scheduling ----------

/**
 * @param firstInMinutes when the first check comes. A minute after the browser starts, so a check
 *   happens even if the browser is never open for a full interval; a full interval after the user
 *   changes the interval, since changing a setting is not asking for a check.
 */
async function scheduleRun(firstInMinutes?: number): Promise<void> {
  const settings = await storage.get("settings");
  const period = Math.max(15, settings.intervalMinutes);
  const jitter = period * (Math.random() * 0.2 - 0.1);
  await chrome.alarms.create(ALARM_RUN, { delayInMinutes: firstInMinutes ?? period, periodInMinutes: period + jitter });
}

async function scheduleAlarms(): Promise<void> {
  await scheduleRun(1);
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

// Only the interval moves the schedule. Settings is written for every toggle and for the GitHub token
// too, and rescheduling on each of those started a full check a minute after flipping a switch.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes["settings"]) return;
  const before = (changes["settings"].oldValue as { intervalMinutes?: number } | undefined)?.intervalMinutes;
  const after = (changes["settings"].newValue as { intervalMinutes?: number } | undefined)?.intervalMinutes;
  if (before !== after) void scheduleRun();
});

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
  try {
    await chrome.tabs.create({ url: hash ? `${url}#${hash}` : url });
  } catch (e) {
    console.error("Sloppycat: could not open", path, e);
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

// ---------- who is using the background window ----------

/**
 * Two kinds of work open the background window: a check (the schedule or "Check now"), and a task
 * (a wizard snapshot, a claim check from Settings). This is the one place that decides how they
 * share it, which used to be split across several flags that disagreed:
 *
 * - A check does not start while a task is going. The schedule simply comes round again; a click
 *   on "Check now" is told it did not run.
 * - A task during a check rides along: its page loads join the check's queue and its lines join the
 *   check's commentary.
 * - Whichever finishes last, the check or the last task, ends the status and closes the window.
 *
 * Held in memory on purpose. Work happens in the worker and nowhere else, so a worker that holds no
 * work is doing none; stored state is for the UI, and a worker Chrome killed leaves it stale.
 */
let running = false;
let tasks = 0;

async function activity<T>(phase: string, fn: () => Promise<T>): Promise<T> {
  if (tasks++ === 0 && !running) {
    // Asking for something is asking again, whatever happened to the window last time.
    resume();
    const at = new Date().toISOString();
    await storage.set("runState", { startedAt: at, beatAt: at, queue: [], done: 0, log: [], phase });
  }
  await log(phase);
  try {
    return await fn();
  } catch (e) {
    await log(e instanceof Error ? e.message : String(e), true);
    throw e;
  } finally {
    if (--tasks === 0 && !running) {
      await setRun(null);
      await closeHidden();
    }
  }
}

// ---------- run loop ----------

/** Check the given profiles, or all of them. Resolves false when another piece of work is going. */
export async function runAll(profileKeys?: string[]): Promise<boolean> {
  if (running || tasks > 0) return false;
  running = true;
  try {
    const settings = await storage.get("settings");
    const profiles = await storage.get("profiles");
    const queue = (profileKeys ?? Object.keys(profiles)).filter((k) => profiles[k]);
    const startedAt = new Date().toISOString();
    await storage.set("runState", { startedAt, beatAt: startedAt, queue, done: 0, log: [] });
    budget.startRun(queue.length);
    resume();
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
      if (stoppedByUser()) {
        await log("Stopping here. Run the check again when you are ready.", true);
        break;
      }
      if (key !== queue[queue.length - 1]) await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
    }
    if (!stoppedByUser()) {
      await setRun({ currentKey: undefined, currentLabel: undefined, phase: "Checking claims on the lists you subscribe to" });
      for (const key of queue) {
        const p = profiles[key];
        if (p) await proveClaimsFor(p.platform, p.url);
        if (stoppedByUser()) break;
      }
    }
    await log(stoppedByUser() ? "Check stopped." : "Check finished.");
    return true;
  } finally {
    running = false;
    budget.endRun();
    // The window exists for the work; when none is left it has no reason to still be there.
    if (tasks === 0) {
      await setRun(null);
      await closeHidden();
    }
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
async function checkOwnList(profile: Profile, bio: string | undefined): Promise<VerifyResult> {
  const who = profile.displayName ?? profile.profileId;
  await log(`${who}: looking for your list link in the bio`);
  const v = await storeOwnListCheck(profile, bio);
  await log(v.ok ? `${who}: list link found and it names this profile` : `${who}: ${v.reason ?? "no list link yet"}`, !v.ok);
  return v;
}

/** The check itself, recorded on the profile. The one place a profile's `verified` is written. */
async function storeOwnListCheck(profile: Profile, bio: string | undefined): Promise<VerifyResult> {
  const key = keyOf(profile);
  const v = await verifyProfile(profile, bio);
  await storage.update("profiles", (all) =>
    all[key] ? { ...all, [key]: { ...all[key]!, verified: v.ok, verifiedListUrl: v.ok ? v.listUrl : undefined } } : all,
  );
  return v;
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
  const read = result.items.map((i) => ({ ...i, firstSeen: prevMap.get(i.itemId)?.firstSeen ?? i.firstSeen }));

  /**
   * A read that did not reach the end of the catalogue cannot be compared against one that did.
   * Amazon hands over its grid sixteen at a time and an author with eighteen hundred titles is not
   * going to fit; Spotify says outright when it sent fewer than it has. Diffing a window against a
   * window reports whatever happened to load this time as newly published, and calling a real
   * release fake is the failure this project does not get to make twice.
   *
   * So a partial read adds to what is known rather than replacing it, and raises nothing. The
   * baseline only grows, and a complete read later compares against all of it.
   */
  const trusted = !result.partial;
  const items = trusted ? read : [...read, ...(prev?.items ?? []).filter((o) => !read.some((n) => n.itemId === o.itemId))];
  /**
   * A partial read in publication order is the top of the catalogue, so something genuinely new is
   * in it and everything the boundary dropped is old. Comparing by date rather than by membership
   * survives the window changing size between checks, which it will.
   */
  const newestKnown = (prev?.items ?? []).reduce((a, i) => (i.releaseDate && i.releaseDate > a ? i.releaseDate : a), "");
  const worthAlerting = (i: SnapshotItem) =>
    trusted || (!!result.newestFirst && !!i.releaseDate && sameReleaseDateOrLater(i.releaseDate, newestKnown));
  if (!trusted) {
    await log(
      result.newestFirst
        ? `${profile.displayName ?? profile.profileId}: read the newest ${read.length} of a longer list`
        : `${profile.displayName ?? profile.profileId}: read ${read.length} of a longer list, so nothing here counts as new`,
    );
  }
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

  if (prev && (trusted || result.newestFirst)) {
    const d = diffSnapshots(prev.items, items);
    for (let added of d.added) {
      if (mine.has(added.itemId) || notMine.has(added.itemId)) continue;
      if (!worthAlerting(added)) continue;
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
    await addAlerts(newAlerts);
    await notify(profile, newAlerts);
  }
  // The list link in the bio is checked by the callers, once each: a check does it after this, and
  // the wizard's commit does it itself. Doing it here as well read the same list two or three times.
  return newAlerts;
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

/** Check each unproven list claiming this profile against the profile's own bio, one at a time. */
async function proveClaimsFor(platform: Platform, profileUrl: string): Promise<void> {
  let pending: string[];
  try {
    pending = await unprovenClaims(platform, profileUrl);
  } catch {
    return;
  }
  for (const listUrl of pending) {
    const key = `${listUrl}|${platform}|${profileUrl}`;
    if (proving.has(key)) continue;
    const existing = await getClaim(listUrl, platform, profileUrl);
    if (isFresh(existing)) continue; // already checked recently, good or bad
    proving.add(key);
    try {
      await runClaimCheck(listUrl, platform, profileUrl, ctx());
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
  let a: Alert | undefined;
  await storage.update("alerts", (all) => {
    const cur = all[alertId];
    if (!cur) return all;
    a = { ...cur, resolution, resolvedAt: new Date().toISOString() };
    return { ...all, [alertId]: a };
  });
  if (!a || resolution === "dismissed") return;

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
        // background window the same way a full run does. `ran` is false when one was already
        // going: the caller asked for a check and did not get one, and should be told so rather
        // than left reading a snapshot that was never taken.
        const m = msg as Extract<Message, { type: "run:now" }>;
        return { ok: true, ran: await runAll(m.profileKey ? [m.profileKey] : undefined) };
      }
      case "profile:add": {
        const m = msg as Extract<Message, { type: "profile:add" }>;
        const det = detectProfile(m.url);
        if (!det) return { ok: false, error: "Not a recognized profile URL" };
        const profile: Profile = { platform: det.platform, profileId: det.profileId, url: det.url, addedAt: new Date().toISOString(), watchOnly: m.watchOnly };
        await storage.update("profiles", (all) => ({ ...all, [keyOf(profile)]: all[keyOf(profile)] ?? profile }));
        // Adding is adding. It used to start a check of its own straight through runProfile, which
        // ignored the one-at-a-time guard, so its lines landed in whatever sweep was already
        // running and adding one page looked like it had gone and scanned them all. Callers that
        // want it read now say so with run:now, which takes its turn like everything else.
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
          const v = await checkOwnList(p, result.bio);
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
            } else if (result.partial && det.platform === "spotify") {
              // Paging past Spotify's first twenty takes the page's login tokens, which are only
              // kept on a page the extension opened itself, never on one the user has open.
              await log("That tab only shows the newest releases, reading the rest in the background");
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
      case "dev:simulate":
        return simulate(msg as Extract<Message, { type: "dev:simulate" }>);
      case "alerts:clear":
        await storage.set("alerts", {});
        return { ok: true };
      case "myList:set": {
        const m = msg as Extract<Message, { type: "myList:set" }>;
        await storage.set("myList", m.doc);
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
    const { profile, result, myList } = msg as { profile: Profile; result: ExtractResult; myList?: ListDocument };
    // The worker writes these itself, so pages hand them over rather than writing them alongside it.
    if (myList) await storage.set("myList", myList);
    await storage.update("profiles", (all) => ({ ...all, [keyOf(profile)]: { ...profile, ...(all[keyOf(profile)] ?? {}) } }));
    await ingestSnapshot(profile, result, false);
    const stored = (await storage.get("profiles"))[keyOf(profile)] ?? profile;
    if (!stored.watchOnly) await storeOwnListCheck(stored, result.bio);
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
  // Claims were once stored per list and platform. Those say nothing about any one profile, so they
  // go, and the next check proves each profile afresh.
  await storage.update("claims", (all) =>
    Object.fromEntries(Object.entries(all).filter(([k, c]) => c.profileUrl && k === claimKey(c.listUrl, c.platform, c.profileUrl))),
  );
  const existing = await chrome.alarms.get(ALARM_RUN);
  if (!existing) await scheduleAlarms();
})();
