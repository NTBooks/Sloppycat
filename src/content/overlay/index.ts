// Consumer overlay: badges on catalog items + hover report card, driven by subscribed lists.
// Vanilla DOM on purpose: runs on every platform page, must be light and must not shift layout.
import type { Identifiers, Platform, Verdict } from "../../types";
import { adapters, detectPlatform, detectProfile } from "../../adapters";
import { cardHtml, makeBadge } from "./card";

const platform: Platform | null = detectPlatform(location.href);


let card: HTMLElement | null = null;
/** Anchors already processed, with the item id they resolved to. */
const processed = new Map<HTMLAnchorElement, string>();
const verdictCache = new Map<string, Verdict | null>();
let scanTimer: number | undefined;
let enabled = false;
let blockFlagged = false;

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
}


function showCard(anchor: HTMLElement, title: string, v: Verdict) {
  const c = ensureCard();
  c.innerHTML = cardHtml(title, v);
  c.hidden = false;
  const r = anchor.getBoundingClientRect();
  const cw = 300;
  let left = r.left + window.scrollX;
  if (left + cw > window.scrollX + window.innerWidth - 8) left = window.scrollX + window.innerWidth - cw - 8;
  c.style.left = `${Math.max(8, left)}px`;
  c.style.top = `${r.bottom + window.scrollY + 6}px`;
}

function badgeFor(v: Verdict, title: string): HTMLElement {
  return makeBadge(
    v,
    (b) => showCard(b, title, v),
    () => setTimeout(() => {
      if (card && !card.matches(":hover")) hideCard();
    }, 250),
  );
}

/**
 * Identifiers printed on the page itself. ASIN is a shelf number Amazon hands to any upload, so an
 * ISBN, when the listing has one, is the identifier worth matching on.
 */
function pageIdentifiers(): Record<string, Identifiers> {
  if (platform !== "amazon" && platform !== "goodreads") return {};
  const itemId = platform ? adapters[platform].parseItemUrl(location.href) : null;
  if (!itemId) return {};
  const text = document.body.innerText.slice(0, 20000);
  const isbn13 = /ISBN[s-]?13[s:]*([0-9][0-9 -]{11,16}[0-9X])/i.exec(text)?.[1];
  const isbn10 = /ISBN[s-]?10[s:]*([0-9][0-9 -]{7,12}[0-9X])/i.exec(text)?.[1];
  const isbn = (isbn13 ?? isbn10)?.replace(/[^0-9X]/gi, "").toUpperCase();
  return isbn ? { [itemId]: { isbn } } : {};
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
      const res = (await chrome.runtime.sendMessage({
        type: "lists:lookup",
        platform,
        ids: need,
        profileUrl: profile?.url,
        pageIds: pageIdentifiers(),
      })) as {
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
      if (v.status === "not_mine") flag(a, v, t);
    }
  }
}

function scheduleScan() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scan(), 400);
}

/** The container a platform uses for one item in a list or grid. */
function rowFor(a: HTMLAnchorElement): HTMLElement | null {
  return a.closest<HTMLElement>(
    "[data-asin], [class*='ProductGridItem__itemOuter'], tr[itemtype], tr, li, article, [role='row'], [data-testid='tracklist-row']",
  );
}

/**
 * Mark an item the creator disowned. With the blockFlagged experiment on, the row is collapsed behind a
 * stub the reader can open, which is the ad-blocker behaviour; otherwise it is just outlined.
 */
function flag(a: HTMLAnchorElement, v: Verdict, title: string): void {
  const row = rowFor(a);
  if (!row) return;
  row.classList.add("sloppycat-flagged");
  if (!blockFlagged || row.dataset["sloppycatBlocked"]) return;
  row.dataset["sloppycatBlocked"] = "1";
  const stub = document.createElement("div");
  stub.className = "sloppycat-stub";
  stub.innerHTML =
    '<span class="sc-x">\u2717</span><span class="sc-msg"></span>' +
    '<button type="button" class="sc-show">Show anyway</button>';
  stub.querySelector(".sc-msg")!.textContent = `${title} \u2014 the artist says this isn't theirs`;
  stub.querySelector(".sc-show")!.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove("sloppycat-hidden");
    stub.remove();
  });
  row.classList.add("sloppycat-hidden");
  row.parentElement?.insertBefore(stub, row);
}

/** A list changed: drop cached verdicts, remove badges, and process every anchor again. */
function rebadgeAll() {
  verdictCache.clear();
  for (const b of document.querySelectorAll(".sloppycat-badge")) b.remove();
  for (const f of document.querySelectorAll(".sloppycat-flagged")) {
    f.classList.remove("sloppycat-flagged", "sloppycat-hidden");
    delete (f as HTMLElement).dataset["sloppycatBlocked"];
  }
  for (const s of document.querySelectorAll(".sloppycat-stub")) s.remove();
  processed.clear();
  hideCard();
  scheduleScan();
}

async function init() {
  if (!platform) return;
  type S = { experiments?: { blocker?: boolean; blockFlagged?: boolean } };
  const apply = (s: S | undefined) => {
    // Badging is an experiment and off by default, which is the only switch it needs.
    enabled = !!s?.experiments?.blocker;
    blockFlagged = enabled && !!s?.experiments?.blockFlagged;
  };
  const { settings } = (await chrome.storage.local.get("settings")) as { settings?: S };
  apply(settings);
  if (!enabled) return;
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch["settings"]) {
      const was = enabled;
      apply(ch["settings"].newValue as S);
      if (!enabled && was) {
        for (const b of document.querySelectorAll(".sloppycat-badge")) b.remove();
        hideCard();
      }
      if (enabled) rebadgeAll();
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
