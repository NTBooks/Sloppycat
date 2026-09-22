import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { RunLogEntry, Signal, SnapshotItem } from "../../types";
import { PLATFORM_LABEL } from "../../types";
import { describeSignal } from "../../signals";
import { copy } from "./rpc";

export function Button(props: {
  onClick?: () => void | Promise<void>;
  children: ComponentChildren;
  kind?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={props.type ?? "button"}
      class={`btn ${props.kind ?? ""}`}
      disabled={props.disabled}
      title={props.title}
      onClick={() => void props.onClick?.()}
    >
      {props.children}
    </button>
  );
}

export function CopyButton(props: { text: string; label?: string; kind?: "primary" | "ghost" }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      kind={props.kind ?? "ghost"}
      onClick={async () => {
        if (await copy(props.text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? "Copied" : (props.label ?? "Copy")}
    </Button>
  );
}

export function Chip(props: { children: ComponentChildren; tone?: "warn" | "ok" | "bad" | "muted" }) {
  return <span class={`chip ${props.tone ?? "muted"}`}>{props.children}</span>;
}

export function SignalChips(props: { signals: Signal[] }) {
  if (!props.signals.length) return null;
  return (
    <div class="chips">
      {props.signals.map((s, i) => (
        <Chip key={i} tone="warn">
          {describeSignal(s)}
        </Chip>
      ))}
    </div>
  );
}

export function ItemCard(props: { item: SnapshotItem; children?: ComponentChildren }) {
  const it = props.item;
  return (
    <div class="item">
      {it.imageUrl ? <img class="thumb" src={it.imageUrl} alt="" /> : <div class="thumb placeholder" />}
      <div class="item-body">
        <div class="item-title">
          <a href={it.url} target="_blank" rel="noreferrer">
            {it.title || it.itemId}
          </a>
        </div>
        <div class="item-meta">
          {PLATFORM_LABEL[it.platform]}
          {it.subtitle ? ` · ${it.subtitle}` : ""}
          {it.kind !== "unknown" ? ` · ${it.kind.replace("_", " ")}` : ""}
          {it.releaseDate ? ` · ${it.releaseDate}` : ""}
          {it.label ? ` · ${it.label}` : ""}
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function Empty(props: { children: ComponentChildren }) {
  return <div class="empty">{props.children}</div>;
}

/**
 * The running commentary on a check. A minimized window appearing with no explanation is a window
 * that gets closed, so this says which page is loading, what came back, and what to do about it.
 */
export function RunPanel(props: {
  run: { running: boolean; label?: string; phase?: string; done: number; total: number; log: RunLogEntry[] };
  compact?: boolean;
}) {
  const { run, compact } = props;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [run.log.length]);
  if (!run.running && !run.log.length) return null;
  return (
    <div class={`notice run-panel${run.running ? " is-running" : ""}`}>
      <div class="run-head">
        <strong>
          {run.running ? `Checking ${Math.min(run.done + 1, run.total)} of ${run.total}` : "Last check"}
          {run.label ? `: ${run.label}` : ""}
        </strong>
        {run.running && <span class="run-dot" aria-hidden="true" />}
      </div>
      {run.running && (
        <div class="muted run-warn">
          Spotify and Amazon can only be read in a real page, so a minimized Sloppycat window is open while this
          runs. <strong>Leave it alone and it closes itself.</strong> Closing it stops the check.
        </div>
      )}
      <div class="run-log" role="log" style={compact ? "max-height:120px" : undefined}>
        {run.log.map((l, i) => (
          <div key={`${l.at}-${i}`} class={l.bad ? "run-line bad" : "run-line"}>
            <span class="run-time">{new Date(l.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            <span>{l.text}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}
