// What the lists you subscribe to have started, or stopped, saying since you added them.
//
// Two jobs: tell a listener when an artist they follow confirms something new, and make a list that
// has gone bad visible. Subscribing is the whole trust decision, so being able to see what a list
// did after you subscribed is what makes unsubscribing a real sanction rather than a theoretical one.
import { render } from "preact";
import { useEffect } from "preact/hooks";
import { Button, Chip, Empty } from "../shared/components";
import { useHash, useStorage } from "../shared/hooks";
import { fmtDate, send } from "../shared/rpc";
import { adapterFor } from "../../adapters";
import { CHANGE_LABEL, markAllSeen } from "../../lists/changes";
import { serializeDisclosure } from "../../lists/format";
import { PLATFORM_LABEL, type ListChange } from "../../types";

function tone(kind: ListChange["kind"]): "ok" | "bad" | "muted" {
  return kind === "verified" ? "ok" : kind === "flagged" ? "bad" : "muted";
}

function ChangeRow(props: { change: ListChange; highlight: boolean }) {
  const c = props.change;
  let url = "";
  try {
    url = adapterFor(c.platform).itemUrl(c.itemId);
  } catch {
    /* an unknown platform just loses the link */
  }
  const disclosure = serializeDisclosure(c.disclosure);
  return (
    <div class="card stack" id={c.id} style={props.highlight ? "outline:2px solid var(--accent)" : ""}>
      <div class="row" style="justify-content:space-between">
        <div class="row">
          <Chip tone={tone(c.kind)}>{CHANGE_LABEL[c.kind]}</Chip>
          {!c.seen && <Chip tone="warn">New</Chip>}
        </div>
        <span class="muted" style="font-size:12px">
          {fmtDate(c.at)}
        </span>
      </div>
      <div>
        <div class="item-title">
          {url ? (
            <a href={url} target="_blank" rel="noreferrer">
              {c.title}
            </a>
          ) : (
            c.title
          )}
        </div>
        <div class="item-meta">
          {PLATFORM_LABEL[c.platform]} · {c.itemId}
          {c.creatorProfile && (
            <>
              {" · "}
              <a href={c.creatorProfile} target="_blank" rel="noreferrer">
                profile
              </a>
            </>
          )}
        </div>
      </div>
      {disclosure && <div class="muted" style="font-size:12px">Disclosure: {disclosure}</div>}
      {c.note && <div class="muted" style="font-size:12px">“{c.note}”</div>}
      <div class="muted" style="font-size:12px;word-break:break-all">
        from{" "}
        <a href={c.source} target="_blank" rel="noreferrer">
          {c.listTitle || c.source}
        </a>{" "}
        · {c.listType === "creator" ? "a creator's own list" : "a community list"}
      </div>
    </div>
  );
}

function Changes() {
  const [changes] = useStorage("listChanges");
  const hash = useHash();
  const all = changes ?? [];
  const unseen = all.filter((c) => !c.seen).length;

  useEffect(() => {
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, [hash, changes]);

  return (
    <div class="page stack">
      <div class="brand">
        <img src="../../icons/icon-48.png" alt="" />
        <h1>List updates</h1>
      </div>
      <p class="muted" style="margin:0">
        Everything the lists you subscribe to changed since you added them. Nothing here is a guess: each row is
        something a creator or a curator published, and dropping the list drops its history with it.
      </p>
      <div class="row">
        <Button onClick={() => void send({ type: "lists:refresh" })}>Check lists now</Button>
        <Button onClick={() => void markAllSeen()} disabled={!unseen}>
          {unseen ? `Mark ${unseen} as read` : "All read"}
        </Button>
      </div>
      {all.length === 0 ? (
        <Empty>
          Nothing yet. Lists are re-fetched every few hours, and the first fetch of a list you just added counts as
          the starting point rather than news.
        </Empty>
      ) : (
        all.map((c) => <ChangeRow key={c.id} change={c} highlight={c.id === hash} />)
      )}
    </div>
  );
}

render(<Changes />, document.getElementById("root")!);
