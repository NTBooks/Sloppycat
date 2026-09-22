// Consumer overlay: badges on catalog items + hover report card, driven by subscribed lists.
// Vanilla DOM on purpose: runs on every platform page, must be light and must not shift layout.
import type { Platform, Verdict } from "../../types";
import { adapters, detectPlatform, detectProfile } from "../../adapters";

const platform: Platform | null = detectPlatform(location.href);

const STATUS_TEXT: Record<Verdict["status"], string> = {
  verified: "Verified by the artist",
  not_mine: "Artist says this is NOT theirs",
  unconfirmed: "Not yet confirmed by the artist",
  likely_accurate: "Likely genuine: released before AI knockoffs took off",
};
const STATUS_GLYPH: Record<Verdict["status"], string> = { verified: "✓", not_mine: "✗", unconfirmed: "○", likely_accurate: "◷" };

let card: HTMLElement | null = null;
let cardFor: HTMLElement | null = null;
/** Anchors already processed, with the item id they resolved to. */
const processed = new Map<HTMLAnchorElement, string>();
const verdictCache = new Map<string, Verdict | null>();
let scanTimer: number | undefined;
let enabled = true;

function ensureCard(): HTMLElement {
  if (card) return card;
  card = document.createElement("div");
  card.className = "sloppycat-card";
  card.setAttribute("role", "dialog");
  card.hidden = true;
  document.body.appendChild(card);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideCard();
  });
  return card;
}

function hideCard() {
  if (card) card.hidden = true;
  cardFor = null;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function showCard(anchor: HTMLElement, title: string, v: Verdict) {
  const c = ensureCard();
  cardFor = anchor;
  const disc = v.disclosure
    ? `<div class="sc-disc">${Object.entries(v.disclosure)
        .map(([k, val]) => `<span class="sc-k">${esc(k)}</span><span class="sc-v sc-${esc(String(val)).replace(/[^a-z-]/g, "")}">${esc(String(val))}</span>`)
        .join("")}</div>`
    : v.status === "verified"
      ? `<div class="sc-muted">No AI disclosure attached.</div>`
      : "";
  c.innerHTML = `
    <div class="sc-head sc-${v.status}"><span class="sc-glyph">${STATUS_GLYPH[v.status]}</span> ${STATUS_TEXT[v.status]}</div>
    <div class="sc-title">${esc(title)}</div>
    ${v.status === "not_mine" && v.note ? `<div class="sc-note">${esc(v.note)}</div>` : ""}
    ${v.status === "not_mine" && v.firstSeen ? `<div class="sc-muted">Reported ${esc(v.firstSeen)}</div>` : ""}
    ${v.status === "not_mine" && v.creatorProfile ? `<div><a class="sc-link" href="${esc(v.creatorProfile)}">Go to the real profile →</a></div>` : ""}
    ${v.status === "likely_accurate" ? `<div class="sc-muted">Released ${esc(v.released ?? "before " + (v.baselineBefore ?? "the cutoff"))}. Not yet confirmed by the artist.</div>` : ""}
    ${disc}
    <div class="sc-src">From list: <a class="sc-link" href="${esc(v.listUrl)}" target="_blank" rel="noreferrer">${esc(v.listTitle)}</a></div>
  `;
  c.hidden = false;
  const r = anchor.getBoundingClientRect();
  const cw = 300;
  let left = r.left + window.scrollX;
  if (left + cw > window.scrollX + window.innerWidth - 8) left = window.scrollX + window.innerWidth - cw - 8;
  c.style.left = `${Math.max(8, left)}px`;
  c.style.top = `${r.bottom + window.scrollY + 6}px`;
}

function badgeFor(v: Verdict, title: string): HTMLElement {
  const b = document.createElement("span");
  b.className = `sloppycat-badge sc-${v.status}`;
  b.textContent = STATUS_GLYPH[v.status];
  b.setAttribute("tabindex", "0");
  b.setAttribute("role", "button");
  b.setAttribute("aria-label", `Sloppycat: ${STATUS_TEXT[v.status]}`);
  b.title = STATUS_TEXT[v.status];
  const open = () => showCard(b, title, v);
  b.addEventListener("mouseenter", open);
  b.addEventListener("focus", open);
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    cardFor === b && card && !card.hidden ? hideCard() : open();
  });
  b.addEventListener("mouseleave", () => {
    setTimeout(() => {
      if (card && !card.matches(":hover") && cardFor === b) hideCard();
    }, 250);
  });
  return b;
}

function titleOf(a: HTMLAnchorElement): string {
  return (a.textContent ?? "").replace(/\s+/g, " ").trim() || a.getAttribute("aria-label") || a.getAttribute("title") || a.querySelector("img")?.alt || "";
}

async function scan() {
  if (!platform || !enabled) return;
  const adapter = adapters[platform];
  const anchors = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((a) => !processed.has(a));
  const byId = new Map<string, HTMLAnchorElement[]>();
  for (const a of anchors) {
    const id = adapter.parseItemUrl(a.href);
    if (!id) continue;
    processed.set(a, id);
    const arr = byId.get(id) ?? [];
    arr.push(a);
    byId.set(id, arr);
  }
  if (!byId.size) return;
  const need = [...byId.keys()].filter((id) => !verdictCache.has(id));
  if (need.length) {
    const profile = detectProfile(location.href);
    try {
      const res = (await chrome.runtime.sendMessage({ type: "lists:lookup", platform, ids: need, profileUrl: profile?.url })) as {
        ok: boolean;
        verdicts?: Record<string, Verdict>;
      };
      for (const id of need) verdictCache.set(id, res.verdicts?.[id] ?? null);
    } catch {
      return; // background asleep or extension reloaded; next scan retries
    }
  }
  for (const [id, list] of byId) {
    const v = verdictCache.get(id);
    if (!v) continue;
    for (const a of list) {
      if (a.querySelector(".sloppycat-badge")) continue;
      const t = titleOf(a);
      if (!t) continue; // image-only links: skip, the text link will carry the badge
      a.appendChild(badgeFor(v, t));
      if (v.status === "not_mine") a.closest("[data-asin], li, tr, article, [role='row']")?.classList.add("sloppycat-flagged");
    }
  }
}

function scheduleScan() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scan(), 400);
}

/** A list changed: drop cached verdicts, remove badges, and process every anchor again. */
function rebadgeAll() {
  verdictCache.clear();
  for (const b of document.querySelectorAll(".sloppycat-badge")) b.remove();
  for (const f of document.querySelectorAll(".sloppycat-flagged")) f.classList.remove("sloppycat-flagged");
  processed.clear();
  hideCard();
  scheduleScan();
}

async function init() {
  if (!platform) return;
  const { settings } = (await chrome.storage.local.get("settings")) as { settings?: { mode?: string } };
  enabled = settings?.mode !== "creator";
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch["settings"]) {
      enabled = (ch["settings"].newValue as { mode?: string })?.mode !== "creator";
      if (!enabled) {
        for (const b of document.querySelectorAll(".sloppycat-badge")) b.remove();
        hideCard();
      }
    }
    if (ch["listCache"] || ch["myList"] || ch["listSources"]) rebadgeAll();
  });
  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  // Platform pages are single-page apps: a URL change means a new set of items.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      hideCard();
      scheduleScan();
    }
  }, 500);
  void scan();
}

void init();
