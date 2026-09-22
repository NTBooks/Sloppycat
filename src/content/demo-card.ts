// Dev-only: renders the real badge and report card onto sample platform rows, so the docs and the
// promo page show the actual component instead of a redrawn copy. Not referenced by the manifest.
import { cardHtml, makeBadge } from "./overlay/card";
import type { Verdict } from "../types";

interface Sample {
  title: string;
  meta: string;
  verdict: Verdict;
  openCard?: boolean;
}

const SAMPLES: Sample[] = [
  {
    title: "The Queen Is Dead",
    meta: "Album · 1986 · WM UK",
    verdict: { status: "verified", listTitle: "The Smiths — verified catalog", listUrl: "#", disclosure: { vocals: "human", instruments: "human" } },
  },
  {
    title: "Midnight Jazz Vibes",
    meta: "Single · 2026 · 8412 Records DK",
    verdict: {
      status: "not_mine",
      listTitle: "The Smiths — verified catalog",
      listUrl: "#",
      note: "Not ours. Uploaded through a distributor under our name; reported to Spotify 15 Sep.",
      firstSeen: "2026-09-14",
      creatorProfile: "#",
    },
    openCard: true,
  },
  {
    title: "Rank",
    meta: "Album · 1988 · WM UK",
    verdict: { status: "likely_accurate", listTitle: "Sloppycat community list", listUrl: "#", released: "1988-09-05", baselineBefore: "2022-11-30" },
  },
  {
    title: "Strangeways, Here We Come",
    meta: "Album · 1987 · WM UK",
    verdict: { status: "unconfirmed", listTitle: "The Smiths — verified catalog", listUrl: "#" },
  },
];

function mount() {
  const host = document.getElementById("rows");
  if (!host) return;
  for (const s of SAMPLES) {
    const row = document.createElement("div");
    row.className = "demo-row";
    const art = document.createElement("div");
    art.className = "demo-art";
    const text = document.createElement("div");
    const a = document.createElement("a");
    a.className = "demo-title";
    a.href = "#";
    a.textContent = s.title;
    const meta = document.createElement("div");
    meta.className = "demo-meta";
    meta.textContent = s.meta;
    const badge = makeBadge(
      s.verdict,
      (b) => show(b, s.title, s.verdict),
      () => undefined,
    );
    a.appendChild(badge);
    text.append(a, meta);
    row.append(art, text);
    if (s.verdict.status === "not_mine") row.classList.add("sloppycat-flagged");
    host.appendChild(row);
    if (s.openCard) queueMicrotask(() => show(badge, s.title, s.verdict));
  }
}

function show(anchor: HTMLElement, title: string, v: Verdict) {
  let card = document.querySelector<HTMLElement>(".sloppycat-card");
  if (!card) {
    card = document.createElement("div");
    card.className = "sloppycat-card";
    document.body.appendChild(card);
  }
  card.innerHTML = cardHtml(title, v);
  card.hidden = false;
  const r = anchor.getBoundingClientRect();
  card.style.left = `${r.left + window.scrollX}px`;
  card.style.top = `${r.bottom + window.scrollY + 6}px`;
}

mount();
