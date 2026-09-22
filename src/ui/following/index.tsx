// Every page Sloppycat is watching, with a link out to each one.
//
// For someone following other people's pages this is the whole extension, so it is its own page
// rather than a table in Settings between the GitHub sign-in and the disclosure defaults. Pages you
// follow come first; your own are listed under them, because there the wizard is the place to go.
import { render } from "preact";
import { useState } from "preact/hooks";
import { Button, Chip, Empty } from "../shared/components";
import { useStorage } from "../shared/hooks";
import { fmtDate, send } from "../shared/rpc";
import { PLATFORM_LABEL, type Alert, type Profile, type Snapshot } from "../../types";
import { normalizeListUrl } from "../../adapters/shared";
import { addSource } from "../../lists/sources";

/** A few covers off the last snapshot, so a row reads as an artist rather than a record. */
function Sleeves(props: { snapshot?: Snapshot }) {
  const art = (props.snapshot?.items ?? []).filter((i) => i.imageUrl).slice(0, 5);
  if (!art.length) return null;
  return (
    <div class="sleeves">
      {art.map((i) => (
        <img key={i.itemId} class="thumb" src={i.imageUrl} alt="" title={i.title} />
      ))}
    </div>
  );
}

function TheirList(props: { profileKey: string; profile: Profile; subscribed: boolean }) {
  const { profile } = props;
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const url = profile.verifiedListUrl;

  if (url && props.subscribed) {
    return (
      <div class="facts">
        Subscribed to their list. What they disown shows up in{" "}
        <a href="../changes/index.html">list updates</a>.
      </div>
    );
  }
  if (url) {
    return (
      <div class="stack" style="gap:6px">
        <div class="facts" style="word-break:break-all">
          They publish a list, linked from their own bio: {url}
        </div>
        <div class="row">
          <Button
            kind="primary"
            disabled={busy === "sub"}
            onClick={async () => {
              setBusy("sub");
              try {
                await addSource(url);
              } catch (e) {
                setMsg(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "sub" ? "Subscribing…" : "Subscribe to their list"}
          </Button>
          {msg && <span class="facts" style="color:var(--bad)">{msg}</span>}
        </div>
      </div>
    );
  }
  return (
    <div class="row">
      <Button
        disabled={busy === "look"}
        title="Read their bio on the platform and see whether it links to a Sloppycat list"
        onClick={async () => {
          setBusy("look");
          setMsg("");
          try {
            const r = await send<{ ok: boolean; reason?: string }>({ type: "verify:profile", profileKey: props.profileKey });
            if (!r.ok) setMsg(r.reason ?? "No list linked from their bio yet.");
          } finally {
            setBusy("");
          }
        }}
      >
        {busy === "look" ? "Looking…" : "Look for their list"}
      </Button>
      {msg && <span class="facts">{msg}</span>}
    </div>
  );
}

function Watched(props: { profileKey: string; profile: Profile; snapshot?: Snapshot; openAlerts: number; subscribed: boolean }) {
  const { profile: p, openAlerts } = props;
  const items = props.snapshot?.items.length ?? 0;
  return (
    <div class="card stack">
      <div class="who">
        <div>
          <h2>
            <a href={p.url} target="_blank" rel="noreferrer">
              {p.displayName ?? p.profileId}
            </a>
          </h2>
          <div class="facts">
            {PLATFORM_LABEL[p.platform]} · {items} item{items === 1 ? "" : "s"} seen · checked {fmtDate(p.lastRunAt)}
          </div>
        </div>
        <div class="row">
          {openAlerts > 0 ? (
            <a class="chip-link" href="../alert/index.html">
              <Chip tone="bad">
                {openAlerts} open alert{openAlerts === 1 ? "" : "s"}
              </Chip>
            </a>
          ) : (
            <Chip tone="ok">Nothing new</Chip>
          )}
        </div>
      </div>
      <Sleeves snapshot={props.snapshot} />
      {p.lastError && <div class="facts" style="color:var(--bad)">Last check failed: {p.lastError}</div>}
      {p.watchOnly && <TheirList profileKey={props.profileKey} profile={p} subscribed={props.subscribed} />}
      <div class="row">
        <Button onClick={() => void send({ type: "run:now", profileKey: props.profileKey })} title="Read the page now instead of waiting for the timer">
          Check now
        </Button>
        {!p.watchOnly && (
          <a class="btn" href={`../onboard/index.html?role=mine`}>
            Open the wizard
          </a>
        )}
        <Button
          kind="danger"
          title="Forget this page and its snapshot. Alerts it already raised stay where they are."
          onClick={() => void send({ type: "profile:remove", profileKey: props.profileKey })}
        >
          {p.watchOnly ? "Unfollow" : "Stop watching"}
        </Button>
      </div>
    </div>
  );
}

function Following() {
  const [profiles] = useStorage("profiles");
  const [snapshots] = useStorage("snapshots");
  const [alerts] = useStorage("alerts");
  const [sources] = useStorage("listSources");
  const [settings] = useStorage("settings");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const all = Object.entries(profiles ?? {});
  const followed = all.filter(([, p]) => p.watchOnly);
  const own = all.filter(([, p]) => !p.watchOnly);
  const subscribed = new Set((sources ?? []).filter((s) => s.enabled).map((s) => normalizeListUrl(s.url)));
  const openBy = new Map<string, number>();
  for (const a of Object.values(alerts ?? {}) as Alert[]) {
    if (a.resolution) continue;
    openBy.set(a.profileKey, (openBy.get(a.profileKey) ?? 0) + 1);
  }

  const card = ([key, p]: [string, Profile]) => (
    <Watched
      key={key}
      profileKey={key}
      profile={p}
      snapshot={snapshots?.[key]}
      openAlerts={openBy.get(key) ?? 0}
      subscribed={!!p.verifiedListUrl && subscribed.has(normalizeListUrl(p.verifiedListUrl))}
    />
  );

  return (
    <div class="page stack">
      <div class="brand">
        <img src="../../icons/icon-48.png" alt="" />
        <h1>Following</h1>
      </div>
      <p class="muted" style="margin:0">
        Every page Sloppycat is watching in this browser. Checks run about every {settings?.intervalMinutes ?? 60} minutes while Chrome is
        open, and anything new turns into an alert.
      </p>

      <div class="card stack">
        <form
          class="row"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr("");
            setBusy(true);
            try {
              const r = await send<{ ok: boolean; error?: string }>({ type: "profile:add", url, watchOnly: true });
              if (!r.ok) setErr(r.error ?? "Could not add that one");
              else setUrl("");
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            type="url"
            placeholder="Paste an artist or author page: Spotify, Apple Music, Deezer, Amazon, Goodreads"
            value={url}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
            style="flex:1"
          />
          <Button type="submit" kind="primary" disabled={busy}>
            {busy ? "Reading…" : "Follow"}
          </Button>
        </form>
        {err && <div class="notice bad">{err}</div>}
        <div class="muted" style="font-size:12px">
          Following a page watches it and nothing else: nothing to publish, nothing to claim. If the page is your own, use{" "}
          <a href="../onboard/index.html">the wizard</a> instead, which sets up your list as well.
        </div>
      </div>

      <div class="lane">
        {followed.length === 0 ? (
          <Empty>
            Not following anyone yet. Paste a page above, or open an artist or author you follow and use the toolbar button.
          </Empty>
        ) : (
          followed.map(card)
        )}
      </div>

      {own.length > 0 && (
        <>
          <h2 style="margin:18px 0 0">Your own pages</h2>
          <p class="muted" style="margin:0">
            These are the ones you've said are yours, so they come with a list to publish and a bio to claim.
          </p>
          <div class="lane">{own.map(card)}</div>
        </>
      )}

      <div class="row">
        <Button onClick={() => void send({ type: "run:now" })} disabled={!all.length} title="Check every page now">
          Check all now
        </Button>
        <a class="btn" href="../alert/index.html">
          Alerts
        </a>
        <a class="btn" href="../changes/index.html">
          List updates
        </a>
      </div>
    </div>
  );
}

render(<Following />, document.getElementById("root")!);
