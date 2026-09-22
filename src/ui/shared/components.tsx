import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { Signal, SnapshotItem } from "../../types";
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
