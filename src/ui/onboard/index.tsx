// Onboarding wizard. Two ways through it, and the first question is which one you're in:
//   your own page:   Snapshot → Review → Generate → Publish & claim → Watch.
//   someone else's:  Snapshot → see what's there → Watch. No list to write, nothing to claim,
//                    because a catalog you don't own is not yours to vouch for.
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Button, Chip, CopyButton, Empty, RunPanel, SignalChips } from "../shared/components";
import { useRun, useStorage } from "../shared/hooks";
import { download, send, openPage} from "../shared/rpc";
import type { ExtractResult, ItemKind, Platform, Profile, SnapshotItem } from "../../types";
import { PLATFORM_LABEL } from "../../types";
import { adapterFor, detectProfile } from "../../adapters";
import { signalsFor } from "../../signals";
import { mergeCreatorDoc, parseDisclosure, serializeDisclosure, serializeList } from "../../lists/format";
import { buildPacket, packetAsText } from "../../remediation/packets";
import { githubNewFileUrl } from "../../github";
import { hostOf, isBuiltinListHost, listUrlProblem, requestListAccess } from "../../lists/permissions";
import { addSource } from "../../lists/sources";
import * as storage from "../../storage";

type Step = 0 | 1 | 2 | 3 | 4;
/** Whose page this is. "fan" skips everything that only an account holder can do. */
type Role = "creator" | "fan";
const STEP_NAMES: Record<Role, string[]> = {
  creator: ["Snapshot", "Review", "Generate", "Publish & claim", "Watching"],
  fan: ["Snapshot", "What's there now", "Watching"],
};

const KIND_ORDER: ItemKind[] = ["album", "ep", "single", "book", "unknown", "compilation", "appears_on"];
const KIND_LABEL: Record<ItemKind, string> = {
  album: "Albums",
  ep: "EPs",
  single: "Singles",
  book: "Books",
  unknown: "Other",
  compilation: "Compilations",
  appears_on: "Appears on",
};
// "Appears on" entries are other artists' releases the creator features on; they are legitimately not
// theirs to verify, so they start unticked and never become "not mine" claims.
const OFF_BY_DEFAULT = new Set<ItemKind>(["appears_on"]);

interface Row {
  item: SnapshotItem;
  mine: boolean;
  disclosure: string;
  note: string;
}

function Steps(props: { step: Step; role: Role }) {
  // The fan path has three stops, and its last one is the wizard's step 4.
  const at = props.role === "fan" ? Math.min(props.step, 2) : props.step;
  return (
    <div class="steps">
      {STEP_NAMES[props.role].map((n, i) => (
        <span key={n} class={`step ${i === at ? "active" : i < at ? "done" : ""}`}>
          {i + 1}. {n}
        </span>
      ))}
    </div>
  );
}

/**
 * What a snapshot looks like while it runs. It replaces the picker rather than sitting beside it:
 * leaving a URL box on screen with a spinner next to it reads as "paste something", which is the
 * one thing you should not do while a read is already going.
 */
function Working(props: { label: string; platform?: Platform }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const slow = props.platform === "spotify";
  return (
    <div class="card stack">
      <h2>Reading {props.label || "the page"}…</h2>
      <div class="progress">
        <span />
      </div>
      <p class="muted" style="margin:0">
        {slow ? (
          <>
            Spotify has no public API any more, so the page is opened in a background tab and read there. You may see the tab appear and
            close again. Ten to twenty seconds is normal.
          </>
        ) : (
          <>Fetching the public catalog. This is usually quick.</>
        )}
      </p>
      <div class="muted mono" style="font-size:11px">
        {seconds}s{seconds >= 30 ? " · taking longer than usual, it will stop by itself if the page never answers" : ""}
      </div>
    </div>
  );
}

function Wizard() {
  const params = new URLSearchParams(location.search);
  const initialTabId = params.get("tabId") ? Number(params.get("tabId")) : undefined;
  const initialRole = params.get("role") === "fan" ? "fan" : params.get("role") === "mine" ? "creator" : null;
  const [role, setRole] = useState<Role | null>(initialRole);
  const [step, setStep] = useState<Step>(0);
  const run = useRun();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [url, setUrl] = useState("");
  const [detected, setDetected] = useState<{ platform: Platform; profileId: string; url: string } | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [fullMsg, setFullMsg] = useState("");
  const [settings, setSettings] = useStorage("settings");
  const [myList] = useStorage("myList");
  const [listTitle, setListTitle] = useState("");
  const [homepage, setHomepage] = useState("");
  const [repo, setRepo] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");
  const [snapTarget, setSnapTarget] = useState("");
  const [snapPlatform, setSnapPlatform] = useState<Platform | undefined>(undefined);
  const [theirList, setTheirList] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [lookMsg, setLookMsg] = useState("");
  const fan = role === "fan";

  useEffect(() => {
    void chrome.tabs.query({}).then((all) => setTabs(all.filter((t) => t.url && detectProfile(t.url))));
  }, []);
  // The popup hands over both the tab and which case it is, so the snapshot starts once we know.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (initialTabId && role && !started) {
      setStarted(true);
      void snapshotTab(initialTabId);
    }
  }, [role]);
  useEffect(() => {
    if (settings?.myListUrl && !publishedUrl) setPublishedUrl(settings.myListUrl);
  }, [settings]);

  function toRows(res: ExtractResult, defaults: string): Row[] {
    const existingMine = new Set(myList?.mine.filter((r) => r.platform === res.platform).map((r) => r.id) ?? []);
    const existingNot = new Set(myList?.notMine.filter((r) => r.platform === res.platform).map((r) => r.id) ?? []);
    return res.items.map((item) => ({
      item,
      mine: existingNot.has(item.itemId) ? false : existingMine.has(item.itemId) ? true : !OFF_BY_DEFAULT.has(item.kind),
      disclosure: serializeDisclosure(myList?.mine.find((r) => r.platform === res.platform && r.id === item.itemId)?.disclosure) || defaults,
      note: myList?.notMine.find((r) => r.platform === res.platform && r.id === item.itemId)?.note ?? "",
    }));
  }

  /**
   * Read the platform's full-catalogue view and fold it into what is already on screen.
   *
   * The notice used to say "open it, scroll to the bottom, then snapshot again", which is three
   * manual steps and loses every decision already made on this screen. Existing rows keep their
   * ticks and notes; only the ones the first pass never saw are added.
   */
  async function scanFullCatalog() {
    if (!detected) return;
    setBusy("full");
    setError("");
    try {
      const r = await send<{ ok: boolean; error?: string; result?: ExtractResult }>({
        type: "snapshot:full",
        platform: detected.platform,
        profileId: detected.profileId,
      });
      if (!r.ok || !r.result) throw new Error(r.error ?? "Could not read the full catalogue");
      const known = new Set(rows.map((x) => x.item.itemId));
      const fresh = toRows({ ...r.result, items: r.result.items.filter((i) => !known.has(i.itemId)) }, serializeDisclosure(settings?.defaultDisclosure));
      setRows([...rows, ...fresh]);
      setResult({ ...r.result, items: [...rows.map((x) => x.item), ...fresh.map((x) => x.item)], partial: false });
      setFullMsg(fresh.length ? `Added ${fresh.length} more release${fresh.length === 1 ? "" : "s"}.` : "Nothing new: the first pass already had everything.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function snapshotTab(tabId: number) {
    const t = tabs.find((x) => x.id === tabId);
    setSnapTarget(t?.title ?? "this page");
    setBusy("snap");
    setError("");
    try {
      const r = await send<{ ok: boolean; error?: string; detected?: typeof detected; result?: ExtractResult }>({ type: "snapshot:fromTab", tabId });
      if (!r.ok || !r.result || !r.detected) throw new Error(r.error ?? "Snapshot failed");
      setDetected(r.detected);
      setResult(r.result);
      setRows(toRows(r.result, serializeDisclosure(settings?.defaultDisclosure)));
      setListTitle(myList?.title ?? `${r.result.displayName ?? "My"} — verified catalog`);
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function snapshotUrl(u: string) {
    const det = detectProfile(u);
    if (!det) {
      setError("That doesn't look like a supported profile URL.");
      return;
    }
    setSnapTarget(u);
    setBusy("snap");
    setError("");
    try {
      // Add as a watched profile and run once; the background does the fetch/render.
      await send({ type: "profile:add", url: u, watchOnly: fan });
      const key = `${det.platform}:${det.profileId}`;
      await send({ type: "run:now", profileKey: key });
      const snaps = await storage.get("snapshots");
      const snap = snaps[key];
      const profiles = await storage.get("profiles");
      const p = profiles[key];
      if (!snap) throw new Error(p?.lastError ?? "No snapshot came back. Try opening the profile in a tab and using the popup.");
      const res: ExtractResult = { platform: det.platform, profileId: det.profileId, displayName: p?.displayName, items: snap.items };
      setDetected(det);
      setResult(res);
      setRows(toRows(res, serializeDisclosure(settings?.defaultDisclosure)));
      setListTitle(myList?.title ?? `${p?.displayName ?? "My"} — verified catalog`);
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  // What the platform claims against what is actually on screen. The old wording promised "the ten
  // newest", which stops being true the moment paging works, and it did.
  const listedCount = rows.filter((r) => r.item.kind !== "appears_on").length;
  const counts = result?.counts;
  const summed = counts ? (counts["albums"] ?? 0) + (counts["singles"] ?? 0) + (counts["compilations"] ?? 0) : 0;
  const reportedTotal = counts?.["all"] ?? (summed || undefined);

  const grouped = useMemo(() => {
    const g = new Map<ItemKind, number[]>();
    rows.forEach((r, i) => {
      const arr = g.get(r.item.kind) ?? [];
      arr.push(i);
      g.set(r.item.kind, arr);
    });
    return KIND_ORDER.filter((k) => g.has(k)).map((k) => ({ kind: k, idx: g.get(k)! }));
  }, [rows]);

  const allItems = rows.map((r) => r.item);
  const doc = useMemo(() => {
    if (!detected || !result) return null;
    return mergeCreatorDoc(myList ?? null, {
      title: listTitle || "My verified catalog",
      homepage: homepage || undefined,
      creator: [{ platform: detected.platform, profile: detected.url }],
      mine: rows.filter((r) => r.mine).map((r) => ({ platform: r.item.platform, id: r.item.itemId, title: r.item.title, disclosure: parseDisclosure(r.disclosure) })),
      notMine: rows
        .filter((r) => !r.mine && !OFF_BY_DEFAULT.has(r.item.kind))
        .map((r) => ({ platform: r.item.platform, id: r.item.itemId, title: r.item.title, firstSeen: r.item.firstSeen.slice(0, 10), note: r.note || undefined })),
    });
  }, [rows, listTitle, homepage, detected, result, myList]);
  const listText = doc ? serializeList(doc) : "";
  const notMineRows = rows.filter((r) => !r.mine && !OFF_BY_DEFAULT.has(r.item.kind));

  async function commit() {
    if (!doc || !detected || !result) return;
    setBusy("commit");
    try {
      await storage.set("myList", doc);
      const profile: Profile = { platform: detected.platform, profileId: detected.profileId, url: detected.url, displayName: result.displayName, addedAt: new Date().toISOString() };
      await send({ type: "snapshot:commit", profile, result });
      setStep(2);
    } finally {
      setBusy("");
    }
  }

  /** The fan ending: record the profile and its first snapshot, and write nothing about ownership. */
  async function follow() {
    if (!detected || !result) return;
    setBusy("commit");
    try {
      const profile: Profile = { platform: detected.platform, profileId: detected.profileId, url: detected.url, displayName: result.displayName, addedAt: new Date().toISOString(), watchOnly: true };
      await send({ type: "snapshot:commit", profile, result });
      // snapshot:commit keeps an existing row as-is, so say it separately: this one is not mine.
      await send({ type: "profile:watchOnly", profileKey: `${detected.platform}:${detected.profileId}`, watchOnly: true });
      setStep(4);
      // The snapshot already read their bio, so look for their list with what is in hand rather
      // than making this a button. No second page load, and nothing for the reader to go and do.
      const r = await send<{ ok: boolean; listUrl?: string; subscribed?: boolean; reason?: string }>({
        type: "list:fromBio",
        profileKey: `${detected.platform}:${detected.profileId}`,
        bio: result.bio,
      });
      setTheirList(r.listUrl ?? "");
      setSubscribed(!!r.subscribed);
      setLookMsg(r.listUrl && !r.subscribed ? `Their list is on ${hostOf(r.listUrl)}, which Sloppycat needs your permission to read.` : "");
    } finally {
      setBusy("");
    }
  }

  const bioPlatforms = (doc?.creator ?? []).filter((c) => adapterFor(c.platform).supportsBio);
  const ghUrl = repo && listText.length < 6000 ? githubNewFileUrl(repo, listText) : "";

  return (
    <div class="page stack">
      <div class="brand">
        <img src="../../icons/icon-48.png" alt="" />
        <h1>{fan ? "Follow an artist's page" : role ? "Snapshot your profile" : "Set up Sloppycat"}</h1>
      </div>
      {role && <Steps step={step} role={role} />}
      {error && <div class="notice bad">{error}</div>}
      <RunPanel run={run} />

      {step === 0 && !role && (
        <div class="card stack">
          <h2>Whose page is this?</h2>
          <p class="muted">The two answers do different work, so it's worth getting right. You can do both later, one page at a time.</p>
          <div class="row" style="align-items:stretch;gap:12px">
            <div class="card stack" style="flex:1">
              <h3>It's mine</h3>
              <p class="muted">
                You're the artist or author. You'll go through your catalog, mark what's really yours, publish that list, and link it
                from your bio so anyone can check a release against it.
              </p>
              <Button kind="primary" onClick={() => setRole("creator")}>
                Set up my profile
              </Button>
            </div>
            <div class="card stack" style="flex:1">
              <h3>I follow them</h3>
              <p class="muted">
                Someone else's page. Sloppycat takes a snapshot and tells you when something new turns up on it, with the signals that
                make a release worth a second look. <strong>No list to write and nothing to publish</strong> — their catalog isn't yours
                to vouch for.
              </p>
              <Button kind="primary" onClick={() => setRole("fan")}>
                Follow someone's page
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 0 && role && busy === "snap" && (
        <Working label={snapTarget} platform={detectProfile(snapTarget)?.platform ?? snapPlatform} />
      )}

      {step === 0 && role && busy !== "snap" && (
        <div class="stack">
          <div class="card stack">
            <h2>{fan ? "Pick the page to follow" : "Pick your profile"}</h2>
            <p class="muted">
              {fan ? (
                <>
                  Open the artist or author page in a tab, or paste its URL. Sloppycat reads the public catalog once as a baseline, then
                  watches for what gets added to it.
                </>
              ) : (
                <>
                  Open your own artist or author page in a tab, or paste its URL. Sloppycat reads the public catalog, you untick anything
                  that isn't yours, and the result becomes your verified list.
                </>
              )}
            </p>
            <div class="row">
              <Chip>{fan ? "Following someone else's page" : "This is my own page"}</Chip>
              <Button kind="ghost" onClick={() => setRole(fan ? "creator" : "fan")}>
                {fan ? "Actually, it's mine" : "Actually, I just follow them"}
              </Button>
            </div>
            {tabs.length > 0 && (
              <div class="stack">
                <h3>Open tabs</h3>
                {tabs.map((t) => {
                  const d = detectProfile(t.url!)!;
                  return (
                    <div class="row" key={t.id}>
                      <Button
                        kind="primary"
                        onClick={() => {
                          setSnapPlatform(d.platform);
                          void snapshotTab(t.id!);
                        }}
                        disabled={busy === "snap"}
                      >
                        Snapshot
                      </Button>
                      <span>
                        <strong>{PLATFORM_LABEL[d.platform]}</strong> · {t.title}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <form
              class="row"
              onSubmit={(e) => {
                e.preventDefault();
                void snapshotUrl(url.trim());
              }}
            >
              <input type="url" placeholder="https://open.spotify.com/artist/… or https://www.amazon.com/stores/author/…" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} style="flex:1" />
              <Button type="submit" disabled={busy === "snap"}>
                {busy === "snap" ? "Reading…" : "Snapshot URL"}
              </Button>
            </form>
            <div class="muted" style="font-size:12px">
              Spotify pages are read in a background tab that opens and closes on its own (Spotify has no public API anymore). Apple Music
              and Deezer use their public JSON. Amazon and Goodreads pages are read through your own browser session.
            </div>
          </div>
        </div>
      )}

      {step === 1 && result && detected && (
        <div class="stack">
          <div class="card stack">
            <div class="row" style="justify-content:space-between">
              <div>
                <h2>
                  {result.displayName ?? detected.profileId} <span class="muted">· {PLATFORM_LABEL[detected.platform]}</span>
                </h2>
                <div class="muted">
                  {fan ? (
                    <>
                      {rows.length} items on the page right now. This is the baseline, and there is nothing to tick: whatever shows up
                      after it becomes an alert. Rows with a warning chip are worth a second look already.
                    </>
                  ) : (
                    <>
                      {rows.length} items · {rows.filter((r) => r.mine).length} marked mine. Untick anything that isn't yours. Rows with a
                      warning chip are worth a second look; nothing is unticked automatically.
                    </>
                  )}
                </div>
              </div>
              {!fan && (
                <div class="row">
                  <Button onClick={() => setRows(rows.map((r) => ({ ...r, mine: true })))}>All mine</Button>
                  <Button onClick={() => setRows(rows.map((r) => ({ ...r, mine: OFF_BY_DEFAULT.has(r.item.kind) ? false : r.mine })))}>Reset</Button>
                </div>
              )}
            </div>
            {!fan && (
              <div class="row">
                <label style="margin:0">Disclosure for all mine:</label>
                <input type="text" placeholder="text:human; cover:ai-assisted" style="flex:1" onChange={(e) => setRows(rows.map((r) => ({ ...r, disclosure: (e.target as HTMLInputElement).value })))} />
              </div>
            )}
          </div>
          {result.partial && adapterFor(detected.platform).fullCatalogUrl && (
            <div class="notice stack">
              <div>
                {reportedTotal
                  ? `${PLATFORM_LABEL[detected.platform]} reports ${reportedTotal} releases on this profile and ${listedCount} are listed here.`
                  : `${PLATFORM_LABEL[detected.platform]} says there are more releases than it listed here.`}{" "}
                Worth reading the rest: a fake can be uploaded with an old date, which puts it in the middle of the catalog
                rather than at the top, where a newest-first page never reaches it.
              </div>
              <div class="row">
                <Button kind="primary" disabled={busy === "full"} onClick={() => void scanFullCatalog()}>
                  {busy === "full" ? "Reading the full discography…" : "Scan the full discography"}
                </Button>
                <a class="muted" style="font-size:12px" href={adapterFor(detected.platform).fullCatalogUrl!(detected.profileId)} target="_blank" rel="noreferrer">
                  or open it yourself
                </a>
              </div>
              <div class="muted" style="font-size:12px">
                This opens the full view in the background window and reads it. Anything already ticked above stays as you
                left it.
              </div>
            </div>
          )}
          {fullMsg && <div class="notice ok">{fullMsg}</div>}
          {rows.length === 0 && <Empty>Nothing was found on this page. If it's a Spotify artist page, try the "…/discography/all" view.</Empty>}
          {grouped.map((g) => (
            <details class="card group" key={g.kind} open={!OFF_BY_DEFAULT.has(g.kind)}>
              <summary>
                {KIND_LABEL[g.kind]} ({g.idx.length}){OFF_BY_DEFAULT.has(g.kind) ? (
                  <span class="muted"> · {fan ? "other people's releases they appear on" : "off by default: usually other people's releases you appear on"}</span>
                ) : null}
              </summary>
              <table class="review">
                <colgroup>
                  {!fan && <col class="c-mine" />}
                  <col class="c-art" />
                  <col />
                  <col class="c-date" />
                  <col class="c-label" />
                  {!fan && <col class="c-note" />}
                </colgroup>
                <thead>
                  <tr>
                    {!fan && <th>Mine</th>}
                    <th></th>
                    <th>Title</th>
                    <th>Date</th>
                    <th>Label / publisher</th>
                    {!fan && <th>Disclosure or note</th>}
                  </tr>
                </thead>
                <tbody>
                  {g.idx.map((i) => {
                    const r = rows[i]!;
                    const sig = signalsFor(r.item, allItems);
                    return (
                      <tr key={r.item.itemId} class={fan || r.mine ? "" : "off"}>
                        {!fan && (
                          <td>
                            <input type="checkbox" class="toggle" checked={r.mine} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, mine: (e.target as HTMLInputElement).checked } : x)))} />
                          </td>
                        )}
                        <td>{r.item.imageUrl ? <img class="thumb t" src={r.item.imageUrl} alt="" /> : <div class="thumb t placeholder" />}</td>
                        <td>
                          <a href={r.item.url} target="_blank" rel="noreferrer">
                            {r.item.title}
                          </a>
                          {r.item.subtitle && <div class="muted" style="font-size:12px">{r.item.subtitle}</div>}
                          <SignalChips signals={sig} />
                        </td>
                        <td class="date">{r.item.releaseDate ?? ""}</td>
                        <td class="label" title={r.item.label ?? ""}>{r.item.label ?? ""}</td>
                        {!fan && (
                          <td>
                            {r.mine ? (
                              <input type="text" value={r.disclosure} placeholder="text:human" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, disclosure: (e.target as HTMLInputElement).value } : x)))} />
                            ) : (
                              <input type="text" value={r.note} placeholder="note: what happened" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, note: (e.target as HTMLInputElement).value } : x)))} />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          ))}
          <div class="card stack">
            {fan ? (
              <p class="muted">
                Nothing here gets published and nothing leaves this browser. Sloppycat keeps the snapshot locally and compares the page
                against it from now on.
              </p>
            ) : (
              <div class="kv">
                <label style="margin:0">List title</label>
                <input type="text" value={listTitle} onInput={(e) => setListTitle((e.target as HTMLInputElement).value)} />
                <label style="margin:0">Homepage (optional)</label>
                <input type="url" value={homepage} placeholder="https://yoursite.example" onInput={(e) => setHomepage((e.target as HTMLInputElement).value)} />
              </div>
            )}
            <div class="row" style="justify-content:space-between">
              <Button onClick={() => setStep(0)}>Back</Button>
              {fan ? (
                <Button kind="primary" onClick={follow} disabled={busy === "commit" || rows.length === 0}>
                  {busy === "commit" ? "Saving…" : "Watch this page"}
                </Button>
              ) : (
                <Button kind="primary" onClick={commit} disabled={busy === "commit" || rows.length === 0}>
                  Generate my list{notMineRows.length ? ` (${notMineRows.length} not mine)` : ""}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 2 && doc && !fan && (
        <div class="stack">
          {notMineRows.length > 0 && (
            <div class="card stack">
              <h2>
                {notMineRows.length} item{notMineRows.length === 1 ? "" : "s"} you said {notMineRows.length === 1 ? "isn't" : "aren't"} yours
              </h2>
              <p class="muted">Each has a ready-to-send takedown packet. Send them now while you're here.</p>
              {notMineRows.map((r) => {
                const packet = buildPacket({ item: r.item, creatorName: result?.displayName, correctProfileUrl: detected?.url, situation: "on_profile", note: r.note });
                const text = packetAsText(packet);
                return (
                  <details key={r.item.itemId} class="card">
                    <summary>
                      <Chip tone="bad">Not mine</Chip> {r.item.title} — {packet.title}
                    </summary>
                    <div class="stack" style="margin-top:8px">
                      <ul>
                        {packet.where.map((w) => (
                          <li key={w.label}>
                            {w.url ? (
                              <a href={w.url} target="_blank" rel="noreferrer">
                                {w.label}
                              </a>
                            ) : (
                              w.label
                            )}
                            {w.note ? <span class="muted"> — {w.note}</span> : null}
                          </li>
                        ))}
                      </ul>
                      <pre>{text}</pre>
                      <div class="row">
                        <CopyButton text={text} label="Copy packet" kind="primary" />
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
          <div class="card stack">
            <h2>Your list</h2>
            <div class="muted">
              {doc.mine.length} mine · {doc.notMine.length} not mine. Saved locally; monitoring of this profile has started.
            </div>
            <pre>{listText}</pre>
            <div class="row">
              <CopyButton text={listText} label="Copy list" kind="primary" />
              <Button onClick={() => download("sloppycat.md", listText)}>Download sloppycat.md</Button>
            </div>
            <div class="row" style="justify-content:space-between">
              <Button onClick={() => setStep(1)}>Back</Button>
              <Button kind="primary" onClick={() => setStep(3)}>
                Publish & claim
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && doc && !fan && (
        <div class="stack">
          <div class="card stack">
            <h2>1. Publish the list somewhere public</h2>
            <p class="muted">
              Any https URL works. GitHub Gist is easiest, and it is the one host every Sloppycat can already read; on your own
              domain, each subscriber is asked once to allow that host. The link is how fans and other Sloppycat users find your
              verified catalog.
            </p>
            <div class="stack">
              <div class="row">
                <CopyButton text={listText} label="Copy list" kind="primary" />
                <Button onClick={() => void chrome.tabs.create({ url: "https://gist.github.com/" })}>Open gist.github.com (paste, name it sloppycat.md, create public)</Button>
              </div>
              <div class="row">
                <input type="text" placeholder="your-github-user/your-repo (optional: publish to a repo instead)" value={repo} onInput={(e) => setRepo((e.target as HTMLInputElement).value)} style="flex:1" />
                <Button disabled={!ghUrl} onClick={() => void chrome.tabs.create({ url: ghUrl })} title={listText.length >= 6000 ? "List too long to prefill; use copy + paste" : ""}>
                  Open GitHub prefilled
                </Button>
              </div>
              <div class="muted" style="font-size:12px">
                Settings has a GitHub sign-in that can create and update the Gist for you, once a client ID is configured.
              </div>
            </div>
          </div>
          <div class="card stack">
            <h2>2. Paste the raw URL here</h2>
            <input
              type="url"
              placeholder="https://gist.githubusercontent.com/you/<id>/raw/sloppycat.md"
              value={publishedUrl}
              onInput={(e) => setPublishedUrl((e.target as HTMLInputElement).value)}
              onChange={() => settings && void setSettings({ ...settings, myListUrl: publishedUrl.trim() || undefined })}
            />
            <div class="muted" style="font-size:12px">
              For a Gist: open it, click "Raw", copy that address. Drop the commit hash from the path so it always serves the latest version.
            </div>
            {publishedUrl.trim() && !listUrlProblem(publishedUrl.trim()) && !isBuiltinListHost(publishedUrl.trim()) && (
              <div class="notice">
                That is not a GitHub host, which is fine. Sloppycat will ask you to allow {hostOf(publishedUrl.trim())} when you
                verify below, and it asks each subscriber the same thing once, when they add your list.
              </div>
            )}
          </div>
          <div class="card stack">
            <h2>3. Put the link in your bio to prove it's you</h2>
            <p class="muted">Bios can only be edited from Spotify for Artists, Amazon Author Central or a claimed Goodreads profile, so the link proves you control the account.</p>
            {bioPlatforms.length === 0 ? (
              <div class="notice">
                {PLATFORM_LABEL[detected!.platform]} has no creator-editable bio. Snapshot a Spotify, Amazon or Goodreads profile too and claim there; this platform's items are still covered by your list.
              </div>
            ) : (
              <ul>
                {bioPlatforms.map((c) => (
                  <li key={c.platform}>
                    <strong>{PLATFORM_LABEL[c.platform]}</strong>: add <code>{publishedUrl || "your list URL"}</code> to your bio
                    {c.platform === "spotify" && " (Spotify for Artists → Profile → About)"}
                    {c.platform === "amazon" && " (Author Central → Profile → Biography)"}
                    {c.platform === "goodreads" && " (Author dashboard → Edit profile → About)"}
                  </li>
                ))}
              </ul>
            )}
            <div class="row">
              <Button
                kind="primary"
                disabled={!publishedUrl || !detected || busy === "verify" || !adapterFor(detected.platform).supportsBio}
                onClick={async () => {
                  const listUrl = publishedUrl.trim();
                  const problem = listUrlProblem(listUrl);
                  if (problem) {
                    setVerifyMsg(problem);
                    return;
                  }
                  // Checking the claim means fetching your own list. On a host outside GitHub that
                  // needs a grant, and this click is the gesture Chrome requires to ask for one.
                  if (!(await requestListAccess(listUrl))) {
                    setVerifyMsg(`Sloppycat needs your permission to read ${hostOf(listUrl)} before it can check the claim.`);
                    return;
                  }
                  setBusy("verify");
                  setVerifyMsg("");
                  try {
                    if (settings) await setSettings({ ...settings, myListUrl: listUrl });
                    const r = await send<{ ok: boolean; reason?: string }>({ type: "verify:profile", profileKey: `${detected!.platform}:${detected!.profileId}` });
                    setVerifyMsg(r.ok ? "Verified. Your profile now shows as claimed." : (r.reason ?? "Not verified yet."));
                  } finally {
                    setBusy("");
                  }
                }}
              >
                {busy === "verify" ? "Checking…" : "Verify now"}
              </Button>
              <Button onClick={() => setStep(4)}>Skip for now</Button>
            </div>
            {verifyMsg && <div class={`notice ${verifyMsg.startsWith("Verified") ? "ok" : ""}`}>{verifyMsg}</div>}
          </div>
          <div class="row" style="justify-content:space-between">
            <Button onClick={() => setStep(2)}>Back</Button>
            <Button kind="primary" onClick={() => setStep(4)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {step === 4 && fan && (
        <div class="stack">
          <div class="card stack">
            <h2>Following {result?.displayName ?? detected?.profileId}</h2>
            <p>
              Sloppycat checks this page every {settings?.intervalMinutes ?? 60} minutes while Chrome is open, and tells you when something
              new appears on it: a first-time label, a release dated into the back catalog, a title that shadows one already there.
            </p>
            <p class="muted">
              There is nothing to publish here. The list, the bio link and the takedown letters are for the account holder, and this
              account isn't yours. What you can do with an alert is tell the artist, who can then act on it.
            </p>
          </div>
          <div class="card stack">
            <h2>Their list</h2>
            {theirList && subscribed ? (
              <div class="stack">
                <p class="muted">
                  {result?.displayName ?? "This artist"} publishes a list and links it from their bio, which only the account holder
                  can edit. You are subscribed to it, so anything they disown shows up on the page and in your alerts.
                </p>
                <div class="muted" style="font-size:12px;word-break:break-all">{theirList}</div>
              </div>
            ) : theirList ? (
              <div class="stack">
                <p class="muted">
                  {result?.displayName ?? "This artist"} publishes a list, and it is hosted on {hostOf(theirList)}, which Sloppycat
                  cannot read without your say-so. Chrome will name the host and you can decline.
                </p>
                <div class="muted" style="font-size:12px;word-break:break-all">{theirList}</div>
                <div class="row">
                  <Button
                    kind="primary"
                    disabled={busy === "sub"}
                    onClick={async () => {
                      setBusy("sub");
                      // The grant has to come from this click; Chrome will not take it from a check.
                      if (!(await requestListAccess(theirList))) {
                        setLookMsg(`Sloppycat needs your permission to read ${hostOf(theirList)} before it can fetch their list.`);
                        setBusy("");
                        return;
                      }
                      try {
                        await addSource(theirList);
                        setSubscribed(true);
                        setLookMsg("");
                      } catch (e) {
                        setLookMsg(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    {busy === "sub" ? "Subscribing…" : `Allow ${hostOf(theirList)} and subscribe`}
                  </Button>
                </div>
              </div>
            ) : (
              <p class="muted">
                They do not link one from their bio yet. Every check looks again, and subscribes for you if one appears, so there is
                nothing here to come back and do. Meanwhile the community list you already subscribe to covers some of the gap.
              </p>
            )}
            {lookMsg && <div class="notice">{lookMsg}</div>}
          </div>
          <div class="card row">
            <Button
              kind="primary"
              onClick={() => {
                setStep(0);
                setResult(null);
                setRows([]);
                setDetected(null);
                setTheirList("");
                setSubscribed(false);
                setLookMsg("");
                setError("");
              }}
            >
              Follow another page
            </Button>
            <Button onClick={() => void openPage("ui/following/index.html")}>
              Everyone you follow
            </Button>
            <Button onClick={() => void openPage("ui/alert/index.html")}>Alerts</Button>
            <Button onClick={() => void chrome.runtime.openOptionsPage()}>Open settings</Button>
          </div>
        </div>
      )}

      {step === 4 && !fan && (
        <div class="card stack">
          <h2>Watching {result?.displayName ?? detected?.profileId}</h2>
          <p>
            Sloppycat now checks this profile every {settings?.intervalMinutes ?? 60} minutes while Chrome is open. Anything new that you haven't marked
            "mine" becomes an alert with a takedown packet.
          </p>
          <div class="row">
            <Button
              kind="primary"
              onClick={() => {
                setStep(0);
                setResult(null);
                setRows([]);
                setDetected(null);
                setError("");
              }}
            >
              Snapshot another profile
            </Button>
            <Button onClick={() => void chrome.runtime.openOptionsPage()}>Open settings</Button>
            <Button onClick={() => void openPage("ui/alert/index.html")}>Alerts</Button>
          </div>
        </div>
      )}
    </div>
  );
}

render(<Wizard />, document.getElementById("root")!);
