import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Button } from "../shared/components";
import { useStorage } from "../shared/hooks";
import { send } from "../shared/rpc";
import { detectProfile } from "../../adapters";
import { PLATFORM_LABEL, type Platform } from "../../types";

function Popup() {
  const [settings, setSettings] = useStorage("settings");
  const [profiles] = useStorage("profiles");
  const [alerts] = useStorage("alerts");
  const [changes] = useStorage("listChanges");
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [detected, setDetected] = useState<{ platform: Platform; profileId: string; url: string } | null>(null);

  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      setTab(t ?? null);
      setDetected(t?.url ? detectProfile(t.url) : null);
    });
  }, []);

  const open = Object.values(alerts ?? {}).filter((a) => !a.resolution).length;
  const unseen = (changes ?? []).filter((c) => !c.seen).length;
  const nProfiles = Object.keys(profiles ?? {}).length;
  const mode = settings?.mode ?? "both";

  return (
    <div class="pop stack">
      <div class="brand">
        <img src="../../icons/icon-48.png" alt="" />
        <h1>Sloppycat</h1>
      </div>

      {detected && tab?.id !== undefined ? (
        <div class="card stack">
          <div>
            <strong>{PLATFORM_LABEL[detected.platform]} profile detected</strong>
            <div class="muted" style="font-size:12px;word-break:break-all">{detected.url}</div>
          </div>
          <Button
            kind="primary"
            onClick={() => {
              void chrome.tabs.create({
                url: chrome.runtime.getURL(`ui/onboard/index.html?tabId=${tab.id}&role=mine`),
              });
              window.close();
            }}
          >
            This is my page
          </Button>
          <div class="muted" style="font-size:12px">
            Mark what's really yours, publish that list, link it from your bio.
          </div>
          <Button
            onClick={() => {
              void chrome.tabs.create({
                url: chrome.runtime.getURL(`ui/onboard/index.html?tabId=${tab.id}&role=fan`),
              });
              window.close();
            }}
          >
            I follow this artist
          </Button>
          <div class="muted" style="font-size:12px">
            Watch the page and get told when something new turns up. Nothing to publish.
          </div>
        </div>
      ) : (
        <div class="muted" style="font-size:12px">
          Open a Spotify, Apple Music, Deezer, Amazon or Goodreads page and come back here. Your own page, or one you follow: both work.
        </div>
      )}

      <div class="card">
        <div class="stat">
          <span>Watching</span>
          <strong>
            <a href={chrome.runtime.getURL("ui/following/index.html")} target="_blank">
              {nProfiles} profile{nProfiles === 1 ? "" : "s"}
            </a>
          </strong>
        </div>
        <div class="stat">
          <span>Open alerts</span>
          <strong style={open ? "color:var(--bad)" : ""}>{open}</strong>
        </div>
        <div class="stat">
          <span>List updates</span>
          <strong>{unseen}</strong>
        </div>
        <div class="stat">
          <span>Mode</span>
          <select
            value={mode}
            onChange={(e) => settings && void setSettings({ ...settings, mode: (e.target as HTMLSelectElement).value as typeof mode })}
          >
            <option value="both">Watch pages + badge them</option>
            <option value="creator">Watch pages only</option>
            <option value="consumer">Badge pages only</option>
          </select>
        </div>
      </div>

      <div class="row">
        <Button onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("ui/following/index.html") })} title="Every page you watch, with links to each">
          Following{nProfiles ? ` (${nProfiles})` : ""}
        </Button>
        <Button onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("ui/alert/index.html") })}>Alerts</Button>
        <Button onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("ui/changes/index.html") })} title="What the lists you subscribe to changed">
          Lists{unseen ? ` (${unseen})` : ""}
        </Button>
        <Button onClick={() => void chrome.runtime.openOptionsPage()}>Settings</Button>
        <Button onClick={() => void send({ type: "run:now" })} disabled={!nProfiles} title="Check all watched profiles now">
          Check now
        </Button>
        {settings?.experiments.slopscan && (
          <Button onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("ui/scan/index.html") })}>Slopscan</Button>
        )}
      </div>
      <div class="muted" style="font-size:11px">
        Monitoring runs while Chrome is open. Blocker features are experimental and work in the web client only.
      </div>
    </div>
  );
}

render(<Popup />, document.getElementById("root")!);
