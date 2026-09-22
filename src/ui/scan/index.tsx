// Slopscan (experimental): read an open library or shelf page and report which items your subscribed
// lists have something to say about. Web client only: it reads a page you have open, so it can't see
// the Spotify desktop app, a phone, or a Kindle.
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Button, Chip, Empty } from "../shared/components";
import { useStorage } from "../shared/hooks";
import { send } from "../shared/rpc";
import { adapters, detectPlatform } from "../../adapters";
import type { Platform, Verdict } from "../../types";
import { PLATFORM_LABEL } from "../../types";

/** Pages worth scanning, and what they are. */
const LIBRARY_PAGES: { platform: Platform; label: string; url: string; match: RegExp }[] = [
  { platform: "spotify", label: "Saved albums", url: "https://open.spotify.com/collection/albums", match: /open\.spotify\.com\/(collection|playlist)/ },
  { platform: "spotify", label: "A playlist", url: "https://open.spotify.com/collection/playlists", match: /open\.spotify\.com\/(collection|playlist)/ },
  { platform: "goodreads", label: "Your shelves", url: "https://www.goodreads.com/review/list", match: /goodreads\.com\/review\/list/ },
  { platform: "amazon", label: "Your Kindle library", url: "https://www.amazon.com/kindle-library", match: /amazon\.[a-z.]+\/(kindle-library|gp\/yourstore|hz\/mycd)/ },
];

interface Found {
  id: string;
  title: string;
  url: string;
  verdict?: Verdict;
}

function verdictChip(v: Verdict | undefined) {
  if (!v) return <Chip>Not on any list</Chip>;
  if (v.status === "not_mine") return <Chip tone="bad">Artist says not theirs</Chip>;
  if (v.status === "verified") return <Chip tone="ok">Verified by the artist</Chip>;
  if (v.status === "likely_accurate") return <Chip>Predates the cutoff</Chip>;
  return <Chip>Not confirmed yet</Chip>;
}

function Scan() {
  const [settings, setSettings] = useStorage("settings");
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scanned, setScanned] = useState<{ url: string; platform: Platform; items: Found[] } | null>(null);

  const refreshTabs = () =>
    void chrome.tabs
      .query({})
      .then((all) => setTabs(all.filter((t) => t.url && LIBRARY_PAGES.some((p) => p.match.test(t.url!)))))
      .catch(() => setTabs([]));
  useEffect(refreshTabs, []);

  const on = settings?.experiments.slopscan ?? false;

  async function scan(tab: chrome.tabs.Tab) {
    setBusy(true);
    setError("");
    try {
      const platform = detectPlatform(tab.url ?? "");
      if (!platform) throw new Error("That tab isn't a supported platform");
      const res = await send<{ ok: boolean; error?: string; links?: { href: string; text: string }[] }>({
        type: "scan:collect",
        tabId: tab.id!,
      });
      if (!res.ok || !res.links) throw new Error(res.error ?? "Could not read the page");

      const adapter = adapters[platform];
      const byId = new Map<string, Found>();
      for (const l of res.links) {
        const id = adapter.parseItemUrl(l.href);
        if (!id || byId.has(id)) continue;
        byId.set(id, { id, title: l.text || id, url: l.href });
      }
      const ids = [...byId.keys()];
      if (!ids.length) throw new Error("No albums or books found on that page. Scroll it once so everything loads, then scan again.");

      const look = await send<{ ok: boolean; verdicts?: Record<string, Verdict> }>({ type: "lists:lookup", platform, ids });
      for (const [id, item] of byId) item.verdict = look.verdicts?.[id];
      setScanned({ url: tab.url ?? "", platform, items: [...byId.values()] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const flagged = scanned?.items.filter((i) => i.verdict?.status === "not_mine") ?? [];
  const verified = scanned?.items.filter((i) => i.verdict?.status === "verified") ?? [];
  const unknown = scanned?.items.filter((i) => !i.verdict) ?? [];

  return (
    <div class="page stack">
      <div class="brand">
        <img src="../../icons/icon-48.png" alt="" />
        <h1>Slopscan</h1>
        <Chip tone="warn">Experimental</Chip>
      </div>

      <div class="card stack">
        <p class="muted" style="margin:0">
          Checks a library or shelf page you already have open against the lists you subscribe to, and tells you
          which items a creator has disowned. It reads an open page, so it only works in the web client: not the
          Spotify desktop app, not a phone, not the Kindle app.
        </p>
        {!on && (
          <div class="row">
            <div class="notice" style="flex:1">Slopscan is off. Turn it on to use it.</div>
            <Button
              kind="primary"
              onClick={() => settings && void setSettings({ ...settings, experiments: { ...settings.experiments, slopscan: true } })}
            >
              Turn on
            </Button>
          </div>
        )}
      </div>

      {on && (
        <div class="card stack">
          <h2>Pick a page to scan</h2>
          {tabs.length === 0 ? (
            <Empty>
              Nothing open to scan. Open one of these, let it load, then come back.
              <div class="stack" style="margin-top:12px;align-items:center">
                {LIBRARY_PAGES.map((p) => (
                  <a key={p.url} href={p.url} target="_blank" rel="noreferrer">
                    {PLATFORM_LABEL[p.platform]}: {p.label}
                  </a>
                ))}
              </div>
            </Empty>
          ) : (
            <div class="stack">
              {tabs.map((t) => (
                <div class="tabrow" key={t.id}>
                  <div>
                    <div>{t.title}</div>
                    <div class="where">{t.url}</div>
                  </div>
                  <Button kind="primary" disabled={busy} onClick={() => void scan(t)}>
                    {busy ? "Scanning…" : "Scan this tab"}
                  </Button>
                </div>
              ))}
              <Button onClick={refreshTabs}>Refresh the list of tabs</Button>
            </div>
          )}
          <div class="muted" style="font-size:12px">
            Long libraries load as you scroll, so the scan scrolls the page for you before reading it.
          </div>
        </div>
      )}

      {error && <div class="notice bad">{error}</div>}

      {scanned && (
        <div class="card stack">
          <h2>
            {scanned.items.length} item{scanned.items.length === 1 ? "" : "s"} on that page
          </h2>
          <div class="counts">
            <div class="count bad">
              <b>{flagged.length}</b>
              <span>Disowned</span>
            </div>
            <div class="count ok">
              <b>{verified.length}</b>
              <span>Verified</span>
            </div>
            <div class="count">
              <b>{unknown.length}</b>
              <span>No list covers</span>
            </div>
          </div>
          {flagged.length === 0 ? (
            <div class="notice ok">Nothing here is on a list as disowned. That covers only what your subscribed lists know about.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>What the list says</th>
                </tr>
              </thead>
              <tbody>
                {flagged.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <a href={i.url} target="_blank" rel="noreferrer">
                        {i.title}
                      </a>
                      {i.verdict?.note && (
                        <div class="muted" style="font-size:12px">
                          {i.verdict.note}
                        </div>
                      )}
                    </td>
                    <td>
                      {verdictChip(i.verdict)}
                      <div class="muted" style="font-size:11px">
                        from {i.verdict?.listTitle}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

render(<Scan />, document.getElementById("root")!);
