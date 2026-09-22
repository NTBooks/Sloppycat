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
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [detected, setDetected] = useState<{ platform: Platform; profileId: string; url: string } | null>(null);

  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      setTab(t ?? null);
      setDetected(t?.url ? detectProfile(t.url) : null);
    });
  }, []);

  const open = Object.values(alerts ?? {}).filter((a) => !a.resolution).length;
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
                url: chrome.runtime.getURL(`ui/onboard/index.html?tabId=${tab.id}`),
              });
              window.close();
            }}
          >
            Snapshot this profile
          </Button>
          <div class="muted" style="font-size:12px">
            Is this you? Snapshot it, untick anything that isn't yours, and publish your verified catalog.
          </div>
        </div>
      ) : (
        <div class="muted" style="font-size:12px">
          Open your Spotify, Apple Music, Deezer, Amazon or Goodreads profile and come back here to snapshot it.
        </div>
      )}

      <div class="card">
        <div class="stat">
          <span>Watching</span>
          <strong>{nProfiles} profile{nProfiles === 1 ? "" : "s"}</strong>
        </div>
        <div class="stat">
          <span>Open alerts</span>
          <strong style={open ? "color:var(--bad)" : ""}>{open}</strong>
        </div>
        <div class="stat">
          <span>Mode</span>
          <select
            value={mode}
            onChange={(e) => settings && void setSettings({ ...settings, mode: (e.target as HTMLSelectElement).value as typeof mode })}
          >
            <option value="both">Creator + blocker</option>
            <option value="creator">Creator only</option>
            <option value="consumer">Blocker only</option>
          </select>
        </div>
      </div>

      <div class="row">
        <Button onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("ui/alert/index.html") })}>Alerts</Button>
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
