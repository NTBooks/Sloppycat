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
      // A handler that rejects would otherwise surface as an uncaught error on the extension page,
      // with a minified stack and no clue which button caused it. Most of these are async now.
      onClick={() => {
        try {
          const r = props.onClick?.();
          if (r && typeof r.catch === "function") r.catch((e: unknown) => console.error("Sloppycat: button action failed", e));
        } catch (e) {
          console.error("Sloppycat: button action failed", e);
        }
      }}
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
  // Work started from the wizard has no queue to count, so the bar runs indeterminate rather than
  // claiming a progress it cannot know.
  const counted = run.total > 0;
  const pct = counted ? Math.round((run.done / run.total) * 100) : 0;
  const headline = !run.running
    ? "Last check"
    : counted
      ? `Step ${Math.min(run.done + 1, run.total)} of ${run.total}`
      : (run.phase ?? "Working");
  return (
    <div class={`notice run-panel${run.running ? " is-running" : ""}`}>
      <div class="run-head">
        <strong>
          {headline}
          {counted && run.label ? `: ${run.label}` : ""}
        </strong>
        {run.running && <span class="run-dot" aria-hidden="true" />}
      </div>
      {run.running && (
        <div
          class={`run-bar${counted ? "" : " indeterminate"}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={counted ? 100 : undefined}
          aria-valuenow={counted ? pct : undefined}
          aria-label={headline}
        >
          <span style={counted ? `width:${pct}%` : undefined} />
        </div>
      )}
      {run.running && run.log.length > 0 && (
        <div class="run-now">{run.log[run.log.length - 1]!.text}</div>
      )}
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
