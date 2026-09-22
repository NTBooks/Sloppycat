// Onboarding wizard: Snapshot → Review → Generate → Publish → Claim → Watch.
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Button, Chip, CopyButton, Empty, SignalChips } from "../shared/components";
import { useStorage } from "../shared/hooks";
import { download, send } from "../shared/rpc";
import type { ExtractResult, ItemKind, Platform, Profile, SnapshotItem } from "../../types";
import { PLATFORM_LABEL } from "../../types";
import { adapterFor, detectProfile } from "../../adapters";
import { signalsFor } from "../../signals";
import { mergeCreatorDoc, parseDisclosure, serializeDisclosure, serializeList } from "../../lists/format";
import { buildPacket, packetAsText } from "../../remediation/packets";
import { githubNewFileUrl } from "../../github";
import * as storage from "../../storage";

type Step = 0 | 1 | 2 | 3 | 4;
const STEP_NAMES = ["Snapshot", "Review", "Generate", "Publish & claim", "Watching"];

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

function Steps(props: { step: Step }) {
  return (
    <div class="steps">
      {STEP_NAMES.map((n, i) => (
        <span key={n} class={`step ${i === props.step ? "active" : i < props.step ? "done" : ""}`}>
          {i + 1}. {n}
        </span>
      ))}
    </div>
  );
}

function Wizard() {
  const params = new URLSearchParams(location.search);
  const initialTabId = params.get("tabId") ? Number(params.get("tabId")) : undefined;
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [url, setUrl] = useState("");
  const [detected, setDetected] = useState<{ platform: Platform; profileId: string; url: string } | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [settings, setSettings] = useStorage("settings");
  const [myList] = useStorage("myList");
  const [listTitle, setListTitle] = useState("");
  const [homepage, setHomepage] = useState("");
  const [repo, setRepo] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");

  useEffect(() => {
    void chrome.tabs.query({}).then((all) => setTabs(all.filter((t) => t.url && detectProfile(t.url))));
  }, []);
  useEffect(() => {
    if (initialTabId) void snapshotTab(initialTabId);
  }, []);
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

  async function snapshotTab(tabId: number) {
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
    setBusy("snap");
    setError("");
    try {
      // Add as a watched profile and run once; the background does the fetch/render.
      await send({ type: "profile:add", url: u });
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

  const bioPlatforms = (doc?.creator ?? []).filter((c) => adapterFor(c.platform).supportsBio);
  const ghUrl = repo && listText.length < 6000 ? githubNewFileUrl(repo, listText) : "";

  return (
    <div class="page stack">
      <div class="brand">
        <img src="../../icons/icon-48.png" alt="" />
        <h1>Snapshot your profile</h1>
      </div>
      <Steps step={step} />
      {error && <div class="notice bad">{error}</div>}

      {step === 0 && (
        <div class="stack">
          <div class="card stack">
            <h2>Pick your profile</h2>
            <p class="muted">
              Open your own artist or author page in a tab, or paste its URL. Sloppycat reads the public catalog, you untick anything that
              isn't yours, and the result becomes your verified list.
            </p>
            {tabs.length > 0 && (
              <div class="stack">
                <h3>Open tabs</h3>
                {tabs.map((t) => {
                  const d = detectProfile(t.url!)!;
                  return (
                    <div class="row" key={t.id}>
                      <Button kind="primary" onClick={() => snapshotTab(t.id!)} disabled={busy === "snap"}>
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
              Spotify pages are read in a hidden window (Spotify has no public API anymore). Apple Music and Deezer use their public JSON.
              Amazon and Goodreads pages are read through your own browser session.
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
                  {rows.length} items · {rows.filter((r) => r.mine).length} marked mine. Untick anything that isn't yours. Rows with a warning chip are worth a
                  second look; nothing is unticked automatically.
                </div>
              </div>
              <div class="row">
                <Button onClick={() => setRows(rows.map((r) => ({ ...r, mine: true })))}>All mine</Button>
                <Button onClick={() => setRows(rows.map((r) => ({ ...r, mine: OFF_BY_DEFAULT.has(r.item.kind) ? false : r.mine })))}>Reset</Button>
              </div>
            </div>
            <div class="row">
              <label style="margin:0">Disclosure for all mine:</label>
              <input type="text" placeholder="text:human; cover:ai-assisted" style="flex:1" onChange={(e) => setRows(rows.map((r) => ({ ...r, disclosure: (e.target as HTMLInputElement).value })))} />
            </div>
          </div>
          {result.partial && (
            <div class="notice">
              Spotify's artist page only gives up the ten newest albums and ten newest singles, and it says you have
              more than that. Open{" "}
              <a href={`${detected.url}/discography/all`} target="_blank" rel="noreferrer">
                your full discography
              </a>{" "}
              while signed in, scroll to the bottom, then snapshot again to catch the rest. Worth doing: a fake can
              be uploaded with an old date, which puts it in the middle of your catalog rather than at the top.
            </div>
          )}
          {rows.length === 0 && <Empty>Nothing was found on this page. If it's a Spotify artist page, try the "…/discography/all" view.</Empty>}
          {grouped.map((g) => (
            <details class="card group" key={g.kind} open={!OFF_BY_DEFAULT.has(g.kind)}>
              <summary>
                {KIND_LABEL[g.kind]} ({g.idx.length}){OFF_BY_DEFAULT.has(g.kind) ? <span class="muted"> · off by default: usually other people's releases you appear on</span> : null}
              </summary>
              <table class="review">
                <colgroup>
                  <col class="c-mine" />
                  <col class="c-art" />
                  <col />
                  <col class="c-date" />
                  <col class="c-label" />
                  <col class="c-note" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Mine</th>
                    <th></th>
                    <th>Title</th>
                    <th>Date</th>
                    <th>Label / publisher</th>
                    <th>Disclosure or note</th>
                  </tr>
                </thead>
                <tbody>
                  {g.idx.map((i) => {
                    const r = rows[i]!;
                    const sig = signalsFor(r.item, allItems);
                    return (
                      <tr key={r.item.itemId} class={r.mine ? "" : "off"}>
                        <td>
                          <input type="checkbox" class="toggle" checked={r.mine} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, mine: (e.target as HTMLInputElement).checked } : x)))} />
                        </td>
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
                        <td>
                          {r.mine ? (
                            <input type="text" value={r.disclosure} placeholder="text:human" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, disclosure: (e.target as HTMLInputElement).value } : x)))} />
                          ) : (
                            <input type="text" value={r.note} placeholder="note: what happened" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, note: (e.target as HTMLInputElement).value } : x)))} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          ))}
          <div class="card stack">
            <div class="kv">
              <label style="margin:0">List title</label>
              <input type="text" value={listTitle} onInput={(e) => setListTitle((e.target as HTMLInputElement).value)} />
              <label style="margin:0">Homepage (optional)</label>
              <input type="url" value={homepage} placeholder="https://yoursite.example" onInput={(e) => setHomepage((e.target as HTMLInputElement).value)} />
            </div>
            <div class="row" style="justify-content:space-between">
              <Button onClick={() => setStep(0)}>Back</Button>
              <Button kind="primary" onClick={commit} disabled={busy === "commit" || rows.length === 0}>
                Generate my list{notMineRows.length ? ` (${notMineRows.length} not mine)` : ""}
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && doc && (
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

      {step === 3 && doc && (
        <div class="stack">
          <div class="card stack">
            <h2>1. Publish the list somewhere public</h2>
            <p class="muted">Any raw URL works. GitHub Gist is easiest. The link is how fans and other Sloppycat users find your verified catalog.</p>
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
                  setBusy("verify");
                  setVerifyMsg("");
                  try {
                    if (settings) await setSettings({ ...settings, myListUrl: publishedUrl.trim() });
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

      {step === 4 && (
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
            <Button onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("ui/alert/index.html") })}>Alerts</Button>
          </div>
        </div>
      )}
    </div>
  );
}

render(<Wizard />, document.getElementById("root")!);
