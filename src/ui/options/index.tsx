import { render } from "preact";
import { useState } from "preact/hooks";
import { Button, Chip, CopyButton, Empty } from "../shared/components";
import { useStorage } from "../shared/hooks";
import { download, fmtDate, send } from "../shared/rpc";
import { PLATFORM_LABEL } from "../../types";
import { adapterFor } from "../../adapters";
import { serializeList, parseDisclosure, serializeDisclosure } from "../../lists/format";
import { addSource, removeSource, setSourceEnabled } from "../../lists/sources";
import { toUblockFilters } from "../../lists/export-ublock";
import * as storage from "../../storage";
import { GITHUB_CLIENT_ID, startDeviceFlow, pollDeviceFlow, upsertGist } from "../../github";

function Profiles() {
  const [profiles] = useStorage("profiles");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const list = Object.entries(profiles ?? {});
  return (
    <section class="card stack">
      <h2>Watched profiles</h2>
      <form
        class="row"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          const r = await send<{ ok: boolean; error?: string }>({ type: "profile:add", url });
          if (!r.ok) setErr(r.error ?? "Could not add");
          else setUrl("");
        }}
      >
        <input type="url" placeholder="Paste a Spotify / Apple Music / Deezer / Amazon author / Goodreads author URL" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} style="flex:1" />
        <Button type="submit" kind="primary">
          Watch
        </Button>
      </form>
      {err && <div class="notice bad">{err}</div>}
      {list.length === 0 ? (
        <Empty>No profiles yet. Add one above, or use the popup on your own profile page.</Empty>
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
                  {p.verified ? <Chip tone="ok">Verified</Chip> : adapterFor(p.platform).supportsBio ? <Chip>Unclaimed</Chip> : <Chip>No bio on this platform</Chip>}
                  {p.lastError && (
                    <div class="muted" style="font-size:12px;color:var(--bad)">
                      {p.lastError}
                    </div>
                  )}
                </td>
                <td class="when">{fmtDate(p.lastRunAt)}</td>
                <td class="row" style="justify-content:flex-end">
                  <Button onClick={() => void send({ type: "run:now", profileKey: key })}>Check</Button>
                  {adapterFor(p.platform).supportsBio && (
                    <Button
                      onClick={async () => {
                        const r = await send<{ ok: boolean; reason?: string }>({ type: "verify:profile", profileKey: key });
                        alert(r.ok ? "Verified." : (r.reason ?? "Not verified"));
                      }}
                    >
                      Verify
                    </Button>
                  )}
                  <Button kind="danger" onClick={() => void send({ type: "profile:remove", profileKey: key })}>
                    Remove
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
          <label>Mode</label>
          <select value={settings.mode} onChange={(e) => void setSettings({ ...settings, mode: (e.target as HTMLSelectElement).value as typeof settings.mode })}>
            <option value="both">Creator + blocker</option>
            <option value="creator">Creator only</option>
            <option value="consumer">Blocker only</option>
          </select>
        </div>
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
          <label>Lookalike search every N checks</label>
          <input
            type="number"
            min={1}
            value={settings.lookalikeEveryNRuns}
            onChange={(e) => void setSettings({ ...settings, lookalikeEveryNRuns: Math.max(1, Number((e.target as HTMLInputElement).value) || 6) })}
          />
        </div>
        <div>
          <label>Notifications</label>
          <input type="checkbox" class="toggle" checked={settings.notifications} onChange={(e) => void setSettings({ ...settings, notifications: (e.target as HTMLInputElement).checked })} />
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
          Nothing yet. Run the <a href="../onboard/index.html">snapshot wizard</a> on your profile.
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

function Sources() {
  const [sources] = useStorage("listSources");
  const [cache] = useStorage("listCache");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const all = Object.values(cache ?? {}).map((c) => c.doc);
  return (
    <section class="card stack">
      <h2>List sources</h2>
      <p class="muted">
        Like an ad blocker's filter lists. Add any raw URL to a Sloppycat list: a creator's Gist, a community list, your own.
      </p>
      <form
        class="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!url.trim()) return;
          setBusy(true);
          await addSource(url.trim());
          setUrl("");
          setBusy(false);
        }}
      >
        <input type="url" placeholder="https://gist.githubusercontent.com/…/raw or https://raw.githubusercontent.com/…/sloppycat.md" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} style="flex:1" />
        <Button type="submit" kind="primary" disabled={busy}>
          Add
        </Button>
        <Button onClick={() => void send({ type: "lists:refresh" })}>Refresh all</Button>
      </form>
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
      <MyList />
      <Sources />
    </div>
  );
}

render(<Options />, document.getElementById("root")!);
