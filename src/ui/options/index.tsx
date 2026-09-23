import type preact from "preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Button, Chip, CopyButton, Empty, RunPanel } from "../shared/components";
import { useRun, useStorage } from "../shared/hooks";
import { download, fmtDate, send, openPage} from "../shared/rpc";
import { PLATFORM_LABEL } from "../../types";
import { adapterFor } from "../../adapters";
import { serializeList, parseDisclosure, serializeDisclosure } from "../../lists/format";
import { addSource, refreshSource, removeSource, setSourceEnabled } from "../../lists/sources";
import { hasListAccess, hostOf, listUrlProblem, requestListAccess } from "../../lists/permissions";
import { toUblockFilters } from "../../lists/export-ublock";
import * as storage from "../../storage";
import { GITHUB_CLIENT_ID, startDeviceFlow, pollDeviceFlow, upsertGist } from "../../github";

function Profiles() {
  const [profiles] = useStorage("profiles");
  const [url, setUrl] = useState("");
  const [watchOnly, setWatchOnly] = useState(true);
  const [err, setErr] = useState("");
  const run = useRun();
  const list = Object.entries(profiles ?? {});
  return (
    <section class="card stack">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">Watched profiles</h2>
        <a href="../following/index.html">Open the Following page</a>
      </div>
      <form
        class="row"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          const r = await send<{ ok: boolean; error?: string }>({ type: "profile:add", url, watchOnly });
          if (!r.ok) setErr(r.error ?? "Could not add");
          else setUrl("");
        }}
      >
        <input type="url" placeholder="Paste a Spotify / Apple Music / Deezer / Amazon author / Goodreads author URL" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} style="flex:1" />
        <select value={watchOnly ? "fan" : "mine"} onChange={(e) => setWatchOnly((e.target as HTMLSelectElement).value === "fan")} title="Whose page this is">
          <option value="fan">I follow them</option>
          <option value="mine">It's mine</option>
        </select>
        <Button type="submit" kind="primary">
          Watch
        </Button>
      </form>
      <div class="muted" style="font-size:12px">
        A page you follow is watched and nothing more: no list to publish, no bio to claim, and alerts on it never write into your own
        list. Use the wizard for your own page, where the rest of that applies. This table is the settings view; the Following page is
        the same profiles laid out to read.
      </div>
      {err && <div class="notice bad">{err}</div>}
      <RunPanel run={run} />
      {list.length === 0 ? (
        <Empty>No profiles yet. Add one above, or use the popup on a profile page you have open.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Profile</th>
              <th>Status</th>
              <th>Last check</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map(([key, p]) => (
              <tr key={key}>
                <td>
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {p.displayName ?? p.profileId}
                  </a>
                  <div class="muted" style="font-size:12px">
                    {PLATFORM_LABEL[p.platform]} · {adapterFor(p.platform).strategy}
                  </div>
                </td>
                <td>
                  {p.watchOnly ? (
                    <span title="Someone else's page. Watched, and nothing more.">
                      <Chip>Following</Chip>
                    </span>
                  ) : p.verified ? (
                    <span title="This profile's bio links to your list, so every copy of the extension can tell the list really speaks for it.">
                      <Chip tone="ok">Claimed</Chip>
                    </span>
                  ) : adapterFor(p.platform).supportsBio ? (
                    <span title="Your list works as it is. Putting its URL in this profile's bio is what proves the list is yours. Every check looks again, so there is nothing to press.">
                      <Chip>List link not in bio yet</Chip>
                    </span>
                  ) : (
                    <span title="This platform has no bio only the account holder can edit, so there is nothing here to prove it with. Claim on Spotify, Amazon or Goodreads instead.">
                      <Chip>No bio on this platform</Chip>
                    </span>
                  )}
                  {p.lastError && (
                    <div class="muted" style="font-size:12px;color:var(--bad)">
                      {p.lastError}
                    </div>
                  )}
                </td>
                <td class="when">{fmtDate(p.lastRunAt)}</td>
                <td class="row" style="justify-content:flex-end">
                  <select
                    value={p.watchOnly ? "fan" : "mine"}
                    onChange={(e) => void send({ type: "profile:watchOnly", profileKey: key, watchOnly: (e.target as HTMLSelectElement).value === "fan" })}
                    title="Whose page this is. A page you follow is watched and nothing else."
                  >
                    <option value="fan">I follow them</option>
                    <option value="mine">It's mine</option>
                  </select>
                  <Button
                    onClick={() => void send({ type: "run:now", profileKey: key })}
                    disabled={run.running}
                    title={run.running ? "A check is already running" : "Read the page now and compare it with the last snapshot, instead of waiting for the timer"}
                  >
                    {run.running && run.currentKey === key ? "Checking…" : "Check now"}
                  </Button>
                  <Button kind="danger" onClick={() => void send({ type: "profile:remove", profileKey: key })} title="Forget this page and its snapshot. Alerts it already raised stay.">
                    Stop watching
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function General() {
  const [settings, setSettings] = useStorage("settings");
  if (!settings) return null;
  return (
    <section class="card stack">
      <h2>Monitoring</h2>
      <div class="row" style="gap:20px">
        <div>
          <label>Check every (minutes, min 15)</label>
          <input
            type="number"
            min={15}
            step={5}
            value={settings.intervalMinutes}
            onChange={(e) => void setSettings({ ...settings, intervalMinutes: Math.max(15, Number((e.target as HTMLInputElement).value) || 60) })}
          />
        </div>
        <div>
          <label title="Only does anything while Wider search is turned on below.">Lookalike search every N checks</label>
          <input
            type="number"
            min={1}
            disabled={!settings.experiments.lookalikeSearch}
            value={settings.lookalikeEveryNRuns}
            onChange={(e) => void setSettings({ ...settings, lookalikeEveryNRuns: Math.max(1, Number((e.target as HTMLInputElement).value) || 6) })}
          />
        </div>
        <div>
          <label>Notifications</label>
          <input type="checkbox" class="toggle" checked={settings.notifications} onChange={(e) => void setSettings({ ...settings, notifications: (e.target as HTMLInputElement).checked })} />
        </div>
        <div>
          <label title="One notification per refresh, however many rows changed.">Tell me about list updates</label>
          <input
            type="checkbox"
            class="toggle"
            checked={settings.listUpdates}
            disabled={!settings.notifications}
            onChange={(e) => void setSettings({ ...settings, listUpdates: (e.target as HTMLInputElement).checked })}
          />
        </div>
      </div>
      <div>
        <label>Default disclosure for new "mine" items (key:value; e.g. text:human; cover:ai-assisted)</label>
        <input
          type="text"
          value={serializeDisclosure(settings.defaultDisclosure)}
          onChange={(e) => void setSettings({ ...settings, defaultDisclosure: parseDisclosure((e.target as HTMLInputElement).value) ?? {} })}
        />
        <div class="muted" style="font-size:12px">
          Music keys: vocals, instruments, postproduction, art, lyrics. Book keys: text, images, cover, translation. Values: human, ai-assisted, ai-generated.
        </div>
      </div>
      <div class="muted" style="font-size:12px">
        Checks run only while Chrome is open. Alarms are re-created when Chrome starts.
      </div>
    </section>
  );
}

function Experimental() {
  const [settings, setSettings] = useStorage("settings");
  if (!settings) return null;
  const x = settings.experiments;
  const set = (patch: Partial<typeof x>) => void setSettings({ ...settings, experiments: { ...x, ...patch } });
  const Row = (props: { on: boolean; onChange: (v: boolean) => void; title: string; children: preact.ComponentChildren }) => (
    <div class="row" style="align-items:flex-start;gap:12px">
      <input
        type="checkbox"
        class="toggle"
        checked={props.on}
        style="margin-top:3px"
        onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)}
      />
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">{props.title}</div>
        <div class="muted" style="font-size:12px">
          {props.children}
        </div>
      </div>
    </div>
  );
  return (
    <section class="card stack">
      <div class="row">
        <h2 style="margin:0">Slopblocker</h2>
        <Chip tone="warn">Experimental</Chip>
      </div>
      <p class="muted" style="margin:0">
        These change what platform pages look like, so they only work in the web client: not the Spotify desktop
        app, not phones, not the Kindle app. They are off until you turn them on, and they only ever act on lists
        you subscribed to.
      </p>
      <Row on={x.blocker} onChange={(v) => set({ blocker: v, blockFlagged: v ? x.blockFlagged : false })} title="Badge items on platform pages">
        Puts a mark on albums and books your lists know about, on Spotify, Apple Music, Amazon author pages and
        Goodreads. Hover it for who said what.
      </Row>
      <Row on={x.blockFlagged} onChange={(v) => set({ blockFlagged: v, blocker: v ? true : x.blocker })} title="Hide items the artist disowned">
        Collapses those rows behind a line you can click to open, instead of only outlining them. Only applies to
        items a verified creator says are not theirs, never to a guess.
      </Row>
      <Row on={x.slopscan} onChange={(v) => set({ slopscan: v })} title="Slopscan">
        Check a library or shelf page you have open against your lists, and list what came back.
      </Row>
      {x.slopscan && (
        <div class="row">
          <Button onClick={() => void openPage("ui/scan/index.html")}>Open Slopscan</Button>
        </div>
      )}
    </section>
  );
}

function WiderSearch() {
  const [settings, setSettings] = useStorage("settings");
  if (!settings) return null;
  const on = settings.experiments.lookalikeSearch;
  return (
    <section class="card stack">
      <div class="row">
        <h2 style="margin:0">Wider search</h2>
        <Chip tone="warn">Experimental</Chip>
      </div>
      <p class="muted" style="margin:0">
        Off by default, and worth leaving off unless you are willing to sort through it. Everything above works
        from what is on the page you watch. This looks past it, for titles elsewhere on the platform that resemble
        yours, which means it is guessing from titles alone: a common phrase in one of your titles will keep
        turning up other people's records. It cannot tell a coincidence from a hijack, so it asks you to.
      </p>
      <div class="row" style="align-items:flex-start;gap:12px">
        <input
          type="checkbox"
          class="toggle"
          checked={on}
          style="margin-top:3px"
          onChange={(e) =>
            void setSettings({
              ...settings,
              experiments: { ...settings.experiments, lookalikeSearch: (e.target as HTMLInputElement).checked },
            })
          }
        />
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">Search for lookalike titles</div>
          <div class="muted" style="font-size:12px">
            Runs on the cadence set in General, and only ever raises a heads-up. Nothing it finds is ever treated
            as a claim about anybody.
          </div>
        </div>
      </div>
    </section>
  );
}

function MyList() {
  const [myList] = useStorage("myList");
  const [settings, setSettings] = useStorage("settings");
  const [busy, setBusy] = useState("");
  const [deviceMsg, setDeviceMsg] = useState("");
  if (!settings) return null;
  const text = myList ? serializeList(myList) : "";
  return (
    <section class="card stack">
      <h2>My list</h2>
      {!myList ? (
        <Empty>
          Nothing yet, and nothing needed if the pages you watch are other people's. This is where your own catalog goes: run the{" "}
          <a href="../onboard/index.html">snapshot wizard</a> on a profile you hold the account for.
        </Empty>
      ) : (
        <>
          <div class="muted">
            {myList.mine.length} mine · {myList.notMine.length} not mine · {myList.creator.length} profile{myList.creator.length === 1 ? "" : "s"}
          </div>
          <div class="row">
            <CopyButton text={text} label="Copy list" />
            <Button onClick={() => download("sloppycat.md", text)}>Download .md</Button>
            <Button onClick={() => download("sloppycat-ublock.txt", toUblockFilters([myList]), "text/plain")}>Export uBlock filters</Button>
            {GITHUB_CLIENT_ID && !settings.githubToken && (
              <Button
                onClick={async () => {
                  setBusy("gh");
                  try {
                    const d = await startDeviceFlow();
                    setDeviceMsg(`Go to ${d.verification_uri} and enter code ${d.user_code}`);
                    void chrome.tabs.create({ url: d.verification_uri });
                    const token = await pollDeviceFlow(d);
                    await setSettings({ ...settings, githubToken: token });
                    setDeviceMsg("Signed in to GitHub.");
                  } catch (e) {
                    setDeviceMsg(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy("");
                  }
                }}
                disabled={busy === "gh"}
              >
                Sign in to GitHub
              </Button>
            )}
            {settings.githubToken && (
              <Button
                kind="primary"
                onClick={async () => {
                  setBusy("gist");
                  try {
                    const g = await upsertGist(settings.githubToken!, settings.githubGistId, text);
                    await setSettings({ ...settings, githubGistId: g.id, myListUrl: g.rawUrl });
                    setDeviceMsg(`Published: ${g.rawUrl}`);
                  } catch (e) {
                    setDeviceMsg(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy("");
                  }
                }}
                disabled={busy === "gist"}
              >
                {settings.githubGistId ? "Update Gist" : "Publish as Gist"}
              </Button>
            )}
          </div>
          {deviceMsg && <div class="notice">{deviceMsg}</div>}
          <div>
            <label>Published list URL (raw). Paste this into your Spotify / Author Central / Goodreads bio.</label>
            <input type="url" value={settings.myListUrl ?? ""} onChange={(e) => void setSettings({ ...settings, myListUrl: (e.target as HTMLInputElement).value.trim() || undefined })} />
          </div>
          <details>
            <summary>Preview</summary>
            <pre>{text}</pre>
          </details>
          <Button
            kind="danger"
            onClick={async () => {
              if (confirm("Clear your local list? Published copies are not affected.")) await storage.set("myList", null);
            }}
          >
            Clear local list
          </Button>
        </>
      )}
    </section>
  );
}

function Testing() {
  const [profiles] = useStorage("profiles");
  const [alerts] = useStorage("alerts");
  const [msg, setMsg] = useState("");
  const watched = Object.keys(profiles ?? {}).length;
  const run = async (kind: "new" | "lookalike" | "drift" | "listupdate") => {
    const r = await send<{ ok: boolean; error?: string }>({ type: "dev:simulate", kind });
    const where = kind === "listupdate" ? "Open List updates." : "Open Alerts.";
    setMsg(r.ok ? `Planted. ${where}` : (r.error ?? "Failed"));
  };
  return (
    <section class="card stack">
      <h2>Testing</h2>
      <p class="muted" style="margin:0">
        Plant something on a watched profile so you can walk the whole path (alert, signals, takedown letter)
        without waiting for a real one, or owning a catalogue for it to happen to. Nothing is sent anywhere and
        nothing changes on the platform; these live only in this browser.
      </p>
      {watched === 0 ? (
        <Empty>Watch a profile first. Any public artist or author page will do, it doesn't have to be yours.</Empty>
      ) : (
        <div class="row">
          <Button onClick={() => void run("new")}>Plant a new release</Button>
          <Button onClick={() => void run("lookalike")}>Plant a lookalike</Button>
          <Button onClick={() => void run("drift")}>Plant a hidden-count warning</Button>
          <Button
            kind="danger"
            onClick={async () => {
              await storage.set("alerts", {});
              setMsg("Alerts cleared.");
            }}
            disabled={!Object.keys(alerts ?? {}).length}
          >
            Clear all alerts
          </Button>
        </div>
      )}
      <div class="row">
        <Button onClick={() => void run("listupdate")}>Plant a list update</Button>
      </div>
      <p class="muted" style="margin:0;font-size:12px">
        The blocker half: pretends a list you subscribe to confirmed a release, so you can see the notification
        and the changelog without waiting for the next refresh.
      </p>
      {msg && <div class="notice ok">{msg}</div>}
    </section>
  );
}

/**
 * Which subscribed lists the extension can actually fetch. A list on a host outside the manifest
 * needs an optional permission, and the user can take it back from Chrome's own settings at any
 * time, so this is re-read rather than assumed.
 */
function useListAccess(sources: { url: string }[] | undefined) {
  const [blocked, setBlocked] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  // URLs never contain a space, so one string of them is a safe dependency key.
  const key = (sources ?? []).map((s) => s.url).join(" ");
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: string[] = [];
      for (const u of key ? key.split(" ") : []) if (!(await hasListAccess(u))) out.push(u);
      if (live) setBlocked(out);
    })();
    return () => {
      live = false;
    };
  }, [key, tick]);
  useEffect(() => {
    const recheck = () => setTick((t) => t + 1);
    chrome.permissions.onAdded.addListener(recheck);
    chrome.permissions.onRemoved.addListener(recheck);
    return () => {
      chrome.permissions.onAdded.removeListener(recheck);
      chrome.permissions.onRemoved.removeListener(recheck);
    };
  }, []);
  return blocked;
}

function Sources() {
  const [sources] = useStorage("listSources");
  const [cache] = useStorage("listCache");
  const [changes] = useStorage("listChanges");
  const unseen = (changes ?? []).filter((c) => !c.seen).length;
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const blocked = useListAccess(sources);
  const all = Object.values(cache ?? {}).map((c) => c.doc);
  return (
    <section class="card stack">
      <h2>List sources</h2>
      <p class="muted">
        Like an ad blocker's filter lists. Add any https URL to a Sloppycat list: a creator's Gist, a community list, your own.
        Lists on GitHub and Gist work straight away; for any other host Chrome asks you once whether Sloppycat may read it.
      </p>
      <form
        class="row"
        onSubmit={async (e) => {
          e.preventDefault();
          const raw = url.trim();
          if (!raw) return;
          setErr("");
          const problem = listUrlProblem(raw);
          if (problem) {
            setErr(problem);
            return;
          }
          // Ask Chrome first, while the submit is still a user gesture. A GitHub host returns true
          // without a prompt; anywhere else this is the dialog naming the one host being granted.
          const granted = await requestListAccess(raw);
          if (!granted) {
            setErr(`Sloppycat needs your permission to read ${hostOf(raw)} before it can fetch that list.`);
            return;
          }
          setBusy(true);
          try {
            await addSource(raw);
            setUrl("");
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          }
          setBusy(false);
        }}
      >
        <input type="url" placeholder="https://gist.githubusercontent.com/…/raw or https://your-site.example/sloppycat.md" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} style="flex:1" />
        <Button type="submit" kind="primary" disabled={busy}>
          Add
        </Button>
        <Button onClick={() => void send({ type: "lists:refresh" })}>Refresh all</Button>
        <Button onClick={() => void openPage("ui/changes/index.html")}>
          What changed{unseen ? ` (${unseen})` : ""}
        </Button>
      </form>
      {err && <div class="notice bad">{err}</div>}
      <table>
        <thead>
          <tr>
            <th></th>
            <th>List</th>
            <th>Type</th>
            <th>Entries</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(sources ?? []).map((s) => (
            <tr key={s.url}>
              <td>
                <input type="checkbox" class="toggle" checked={s.enabled} onChange={(e) => void setSourceEnabled(s.url, (e.target as HTMLInputElement).checked)} />
              </td>
              <td>
                <div>{s.title ?? s.url}</div>
                <div class="muted" style="font-size:12px;word-break:break-all">
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.url}
                  </a>
                </div>
                {s.error && (
                  <div style="font-size:12px;color:var(--bad)">{s.error}</div>
                )}
                {blocked.includes(s.url) && (
                  <div class="row" style="font-size:12px;margin-top:4px;align-items:center">
                    <span style="color:var(--bad)">Sloppycat cannot read {hostOf(s.url)} until you allow it.</span>
                    <Button
                      onClick={async () => {
                        if (await requestListAccess(s.url)) await refreshSource(s.url, true);
                      }}
                    >
                      Allow {hostOf(s.url)}
                    </Button>
                  </div>
                )}
              </td>
              <td>{s.type ?? "–"}</td>
              <td>{s.entryCount ?? "–"}</td>
              <td class="when">{fmtDate(s.fetchedAt)}</td>
              <td style="text-align:right">
                {!s.builtin && (
                  <Button kind="danger" onClick={() => void removeSource(s.url)}>
                    Remove
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="row">
        <Button onClick={() => download("sloppycat-all-ublock.txt", toUblockFilters(all, "Sloppycat: all subscribed lists"), "text/plain")} disabled={!all.length}>
          Export all as uBlock filters
        </Button>
      </div>
    </section>
  );
}

function Options() {
  return (
    <div class="page stack">
      <div class="brand">
        <img src="../../icons/icon-48.png" alt="" />
        <h1>Sloppycat settings</h1>
      </div>
      <Profiles />
      <General />
      <Experimental />
      <WiderSearch />
      <MyList />
      <Sources />
      <Testing />
    </div>
  );
}

render(<Options />, document.getElementById("root")!);
