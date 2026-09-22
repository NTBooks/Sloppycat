import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Button, Chip, CopyButton, Empty, ItemCard, SignalChips } from "../shared/components";
import { useHash, useStorage } from "../shared/hooks";
import { fmtDate, send } from "../shared/rpc";
import type { Alert } from "../../types";
import { buildPacket, packetAsText } from "../../remediation/packets";
import { parseDisclosure, serializeDisclosure } from "../../lists/format";

function AlertRow(props: { alert: Alert; highlight: boolean }) {
  const a = props.alert;
  const [profiles] = useStorage("profiles");
  const [settings] = useStorage("settings");
  const [disclosure, setDisclosure] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (settings && !disclosure) setDisclosure(serializeDisclosure(settings.defaultDisclosure));
  }, [settings]);
  const profile = profiles?.[a.profileKey];
  const packet = buildPacket({
    item: a.item,
    profile,
    situation: a.change === "lookalike" ? "elsewhere" : "on_profile",
    note,
  });
  const text = packetAsText(packet);
  return (
    <div class={`card stack`} id={a.id} style={props.highlight ? "outline:2px solid var(--accent)" : ""}>
      <div class="row" style="justify-content:space-between">
        <div class="row">
          <Chip tone={a.change === "lookalike" || a.change === "count_drift" ? "warn" : "bad"}>
            {a.change === "added"
              ? "New on your profile"
              : a.change === "changed"
                ? "Changed"
                : a.change === "lookalike"
                  ? "Lookalike elsewhere"
                  : "Something is hidden from view"}
          </Chip>
          {a.resolution && <Chip tone={a.resolution === "mine" ? "ok" : a.resolution === "not_mine" ? "bad" : "muted"}>{a.resolution.replace("_", " ")}</Chip>}
        </div>
        <span class="muted" style="font-size:12px">
          {fmtDate(a.createdAt)} · {profile?.displayName ?? a.profileKey}
        </span>
      </div>
      <ItemCard item={a.item}>
        <SignalChips signals={a.signals} />
      </ItemCard>
      {!a.resolution && a.change === "count_drift" && (
        <div class="row">
          <Button kind="ghost" onClick={() => void send({ type: "alert:resolve", alertId: a.id, resolution: "dismissed" })}>
            Dismiss
          </Button>
        </div>
      )}
      {!a.resolution && a.change !== "count_drift" && (
        <div class="stack">
          <div class="row">
            <input type="text" placeholder="disclosure if mine (text:human; cover:ai-assisted)" value={disclosure} onInput={(e) => setDisclosure((e.target as HTMLInputElement).value)} style="flex:1" />
            <Button
              kind="primary"
              onClick={() => void send({ type: "alert:resolve", alertId: a.id, resolution: "mine", disclosure: parseDisclosure(disclosure) })}
            >
              Mine
            </Button>
          </div>
          <div class="row">
            <input type="text" placeholder="note for the list (what happened, where you reported it)" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} style="flex:1" />
            <Button kind="danger" onClick={() => void send({ type: "alert:resolve", alertId: a.id, resolution: "not_mine", note })}>
              Not mine
            </Button>
            <Button kind="ghost" onClick={() => void send({ type: "alert:resolve", alertId: a.id, resolution: "dismissed" })}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
      {a.change === "count_drift" ? (
        <div class="stack">
          <div class="notice">
            Spotify only shows the ten newest albums and ten newest singles on an artist page, and a release can
            carry any date its uploader typed. So something added with an old date sits in the middle of your
            catalog where that view never reaches. The totals moved by more than what turned up at the top.
          </div>
          <div>
            <h3>What to do</h3>
            <ol>
              <li>
                Open{" "}
                <a href={a.item.url} target="_blank" rel="noreferrer">
                  your full discography
                </a>{" "}
                while signed in, and scroll to the bottom so the whole list loads.
              </li>
              <li>Come back and run a check. With the page loaded, Sloppycat can read past the newest ten.</li>
              <li>Anything that isn't yours gets its takedown letter as usual.</li>
            </ol>
          </div>
        </div>
      ) : (
      <details open={a.resolution === "not_mine" || props.highlight}>
        <summary>Takedown packet: {packet.title}</summary>
        <div class="stack" style="margin-top:8px">
          <div>
            <h3>Where to send</h3>
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
          </div>
          <div>
            <h3>Steps</h3>
            <ol>
              {packet.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
          <pre>{text}</pre>
          <div class="row">
            <CopyButton text={text} label="Copy packet" kind="primary" />
          </div>
        </div>
      </details>
      )}
    </div>
  );
}

function Alerts() {
  const [alerts] = useStorage("alerts");
  const hash = useHash();
  const all = Object.values(alerts ?? {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = all.filter((a) => !a.resolution);
  const closed = all.filter((a) => a.resolution);
  useEffect(() => {
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, [hash, alerts]);
  return (
    <div class="page stack">
      <div class="brand">
        <img src="../../icons/icon-48.png" alt="" />
        <h1>Alerts</h1>
      </div>
      {open.length === 0 ? <Empty>No open alerts. Nothing new has appeared on your watched profiles.</Empty> : open.map((a) => <AlertRow key={a.id} alert={a} highlight={a.id === hash} />)}
      {closed.length > 0 && (
        <details>
          <summary>Resolved ({closed.length})</summary>
          <div class="stack" style="margin-top:12px">
            {closed.map((a) => (
              <AlertRow key={a.id} alert={a} highlight={a.id === hash} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

render(<Alerts />, document.getElementById("root")!);
