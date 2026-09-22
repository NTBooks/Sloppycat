// Service worker: alarms, run loop, hidden-tab rendering, offscreen parsing, list refresh, messaging.
import type { Alert, ExtractResult, Message, Platform, Profile, SnapshotItem } from "./types";
import { profileKey as keyOf, itemKey } from "./types";
import * as storage from "./storage";
import { adapterFor, detectProfile, type FetchContext } from "./adapters";
import { diffSnapshots } from "./diff";
import { signalsFor, lookalikeSignal } from "./signals";
import { ensureDefaultSources, refreshAll, lookup, unprovenClaims } from "./lists/sources";
import { verifyProfile, runClaimCheck } from "./lists/verify";
import { getClaim, isFresh } from "./lists/claims";
import { mergeCreatorDoc } from "./lists/format";
import { parseSpotifyCaptures } from "./adapters/spotify-json";

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
    await chrome.tabs.create({ url: chrome.runtime.getURL("ui/onboard/index.html") });
  }
});
chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaultSources();
  await scheduleAlarms();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_RUN) void runAll();
  if (alarm.name === ALARM_LISTS) void refreshAll();
});

storage.onChange(["settings"], () => void scheduleAlarms());

// ---------- hidden-tab rendering ----------

let renderQueue: Promise<unknown> = Promise.resolve();
let hiddenWindowId: number | undefined;

async function getHiddenWindow(): Promise<number> {
  if (hiddenWindowId !== undefined) {
    try {
      await chrome.windows.get(hiddenWindowId);
      return hiddenWindowId;
    } catch {
      hiddenWindowId = undefined;
    }
  }
  const w = await chrome.windows.create({ url: "about:blank", state: "minimized", focused: false, type: "popup" });
  hiddenWindowId = w.id!;
  return hiddenWindowId;
}

function waitForLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, timeoutMs);
    function finish() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(id: number, info: chrome.tabs.TabChangeInfo) {
      if (id === tabId && info.status === "complete") finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
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

export async function extractFromTab(tabId: number, platform: Platform, profileId: string): Promise<ExtractResult> {
  if (platform === "spotify" && !profileId.includes(":")) {
    // Structured data first; the DOM is virtualized and only a fallback.
    const caps = await waitForSpotifyCaptures(tabId, profileId, 12000);
    const parsed = parseSpotifyCaptures(caps, profileId, new Date().toISOString());
    if (parsed.items.length) return parsed;
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content/extract.js"] });
  const res = (await chrome.tabs.sendMessage(tabId, { type: "extract:run", platform, profileId })) as
    | { ok: true; result: ExtractResult }
    | { ok: false; error: string };
  if (!res.ok) throw new Error(res.error);
  return res.result;
}

function render(url: string, platform: Platform, profileId: string): Promise<ExtractResult> {
  const job = renderQueue.then(async () => {
    const windowId = await getHiddenWindow();
    const tab = await chrome.tabs.create({ windowId, url, active: false });
    try {
      await waitForLoad(tab.id!, 20000);
      await new Promise((r) => setTimeout(r, 1500));
      return await extractFromTab(tab.id!, platform, profileId);
    } finally {
      try {
        await chrome.tabs.remove(tab.id!);
      } catch {
        /* already gone */
      }
    }
  });
  renderQueue = job.catch(() => undefined);
  return job;
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

export async function runAll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const settings = await storage.get("settings");
    if (settings.mode === "consumer") return;
    const profiles = await storage.get("profiles");
    const counter = await storage.update("runCounter", (n) => n + 1);
    const doLookalike = counter % Math.max(1, settings.lookalikeEveryNRuns) === 0;
    for (const p of Object.values(profiles)) {
      await runProfile(p, doLookalike);
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
    }
  } finally {
    running = false;
  }
}

export async function runProfile(profile: Profile, doLookalike: boolean): Promise<void> {
  const key = keyOf(profile);
  const adapter = adapterFor(profile.platform);
  const c = ctx();
  try {
    const result = await adapter.fetchSnapshot(profile.profileId, c, { withBio: !profile.verified });
    await ingestSnapshot(profile, result, doLookalike);
    await storage.update("profiles", (all) => ({
      ...all,
      [key]: { ...all[key]!, lastRunAt: c.now, lastError: undefined, displayName: result.displayName ?? all[key]!.displayName },
    }));
  } catch (e) {
    await storage.update("profiles", (all) => ({
      ...all,
      [key]: { ...all[key]!, lastRunAt: c.now, lastError: e instanceof Error ? e.message : String(e) },
    }));
  }
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
  await storage.update("snapshots", (all) => ({ ...all, [key]: { profileKey: key, takenAt: c.now, items } }));

  const newAlerts: Alert[] = [];
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
    for (const w of watched.slice(0, 3)) {
      try {
        const found = await adapter.searchLookalikes(w.title, c);
        for (const cand of found) {
          if (items.some((i) => i.itemId === cand.itemId)) continue;
          if (alreadyAlerted.has(itemKey(cand))) continue;
          const sig = lookalikeSignal(cand, [w]);
          if (!sig) continue;
          // Skip if the platform attributes it to the same creator string and it's already on the profile.
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

chrome.notifications.onClicked.addListener((id) => {
  const alertId = id.startsWith("alert:") ? id.slice(6) : "";
  void chrome.tabs.create({ url: chrome.runtime.getURL(`ui/alert/index.html${alertId ? `#${alertId}` : ""}`) });
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
    switch (msg.type) {
      case "run:now": {
        const m = msg as Extract<Message, { type: "run:now" }>;
        if (m.profileKey) {
          const p = (await storage.get("profiles"))[m.profileKey];
          if (p) await runProfile(p, true);
        } else await runAll();
        return { ok: true };
      }
      case "profile:add": {
        const m = msg as Extract<Message, { type: "profile:add" }>;
        const det = detectProfile(m.url);
        if (!det) return { ok: false, error: "Not a recognized profile URL" };
        const profile: Profile = { platform: det.platform, profileId: det.profileId, url: det.url, addedAt: new Date().toISOString() };
        await storage.update("profiles", (all) => ({ ...all, [keyOf(profile)]: all[keyOf(profile)] ?? profile }));
        void runProfile(profile, false);
        return { ok: true, profileKey: keyOf(profile) };
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
        // If a subscribed list claims this profile but hasn't proved it, prove it now. Nothing from
        // that list renders until it passes, so a forged claim shows the viewer nothing.
        if (m.profileUrl) void proveClaimsFor(m.platform, m.profileUrl);
        return { ok: true, verdicts: await lookup(m.platform, m.ids, m.profileUrl, m.pageIds) };
      }
      case "claims:check": {
        const m = msg as Extract<Message, { type: "claims:check" }>;
        const claim = await runClaimCheck(m.listUrl, m.platform, ctx());
        return { ok: claim.state === "verified", claim };
      }
      case "verify:profile": {
        const m = msg as Extract<Message, { type: "verify:profile" }>;
        const p = (await storage.get("profiles"))[m.profileKey];
        if (!p) return { ok: false, error: "Unknown profile" };
        const adapter = adapterFor(p.platform);
        const result = await adapter.fetchSnapshot(p.profileId, ctx(), { withBio: true });
        const v = await verifyProfile(p, result.bio);
        await storage.update("profiles", (all) => ({
          ...all,
          [m.profileKey]: { ...all[m.profileKey]!, verified: v.ok, verifiedListUrl: v.ok ? v.listUrl : undefined },
        }));
        return { ok: v.ok, reason: v.reason, listUrl: v.listUrl };
      }
      case "snapshot:fromTab": {
        // Wizard path: extract from the tab the creator is looking at.
        const m = msg as Extract<Message, { type: "snapshot:fromTab" }>;
        const tab = await chrome.tabs.get(m.tabId);
        const det = detectProfile(tab.url ?? "");
        if (!det) return { ok: false, error: "This tab is not a supported profile page" };
        const adapter = adapterFor(det.platform);
        // JSON platforms are more complete via their API than via the page.
        let result: ExtractResult;
        if (adapter.strategy === "json" || det.platform === "amazon") {
          // JSON APIs are complete; Amazon's full list is on the allbooks page, not the page the creator is on.
          result = await adapter.fetchSnapshot(det.profileId, ctx(), { withBio: true });
        } else {
          result = await extractFromTab(m.tabId, det.platform, det.profileId);
          if (!result.items.length) result = await adapter.fetchSnapshot(det.profileId, ctx(), { withBio: true });
        }
        return { ok: true, detected: det, result };
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
      case "open:onboard": {
        const m = msg as Extract<Message, { type: "open:onboard" }>;
        const q = m.platform && m.profileId ? `?platform=${m.platform}&profileId=${encodeURIComponent(m.profileId)}` : "";
        await chrome.tabs.create({ url: chrome.runtime.getURL(`ui/onboard/index.html${q}`) });
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

// Kick the schedule on worker start in case alarms were lost.
void (async () => {
  const existing = await chrome.alarms.get(ALARM_RUN);
  if (!existing) await scheduleAlarms();
})();
