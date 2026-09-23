// Alert notifications, and the Testing panel's way of planting alerts to walk the path with.
import type { Alert, ListChange, Message, Profile, SnapshotItem } from "../types";
import { profileKey as keyOf } from "../types";
import * as storage from "../storage";
import { adapterFor } from "../adapters";
import { signalsFor } from "../signals";
import { MAX_CHANGES, summarize } from "../lists/changes";
import { addAlerts } from "../alerts";

export async function notify(profile: Profile, alerts: Alert[]): Promise<void> {
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
export async function notifyListChanges(changes: ListChange[]): Promise<void> {
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

/**
 * Testing aid: plant something on a watched profile so the whole alert path can be exercised
 * without waiting for a real hijack, or owning a catalogue for one to happen to.
 */
export async function simulate(m: Extract<Message, { type: "dev:simulate" }>): Promise<{ ok: boolean; error?: string }> {
  // Testing aid: plant something on a watched profile so the whole alert path can be exercised
  // without waiting for a real hijack, or owning a catalogue for one to happen to.

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
    await addAlerts([alert]);
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
  await addAlerts([alert]);
  await notify(profile, [alert]);
  return { ok: true };
}
