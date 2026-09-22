// Badge and report-card markup, shared by the live overlay and the docs demo page so the
// screenshots in the README are the real component.
import type { Verdict } from "../../types";

export const STATUS_TEXT: Record<Verdict["status"], string> = {
  verified: "Verified by the artist",
  not_mine: "Artist says this is NOT theirs",
  unconfirmed: "Not yet confirmed by the artist",
  likely_accurate: "Likely genuine: released before AI knockoffs took off",
};

// U+FE0E keeps these as text glyphs; without it Windows renders emoji versions that ignore the badge colour.
export const STATUS_GLYPH: Record<Verdict["status"], string> = {
  verified: "✓︎",
  not_mine: "✗︎",
  unconfirmed: "○︎",
  likely_accurate: "◷︎",
};

// How the list came to be on this page. Proof is a label here, not a gate: every one of these
// renders, and the difference between them is whether anybody checked the claim at the platform.
export const VIA_TEXT: Record<NonNullable<Verdict["via"]>, string> = {
  "own-list": "Your own list",
  "self-checked": "Your browser checked this against the artist's profile",
  attested: "Checked by a list you subscribe to",
  community: "A list you subscribe to",
  unproved: "A list you added. Nothing has checked it against the artist's profile.",
};

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function cardHtml(title: string, v: Verdict): string {
  const disc = v.disclosure
    ? `<div class="sc-disc">${Object.entries(v.disclosure)
        .map(
          ([k, val]) =>
            `<span class="sc-k">${esc(k)}</span><span class="sc-v sc-${esc(String(val)).replace(/[^a-z-]/g, "")}">${esc(String(val))}</span>`,
        )
        .join("")}</div>`
    : v.status === "verified"
      ? `<div class="sc-muted">No AI disclosure attached.</div>`
      : "";
  return `
    <div class="sc-head sc-${v.status}"><span class="sc-glyph">${STATUS_GLYPH[v.status]}</span> ${STATUS_TEXT[v.status]}</div>
    <div class="sc-title">${esc(title)}</div>
    ${v.status === "not_mine" && v.note ? `<div class="sc-note">${esc(v.note)}</div>` : ""}
    ${v.status === "not_mine" && v.firstSeen ? `<div class="sc-muted">Reported ${esc(v.firstSeen)}</div>` : ""}
    ${v.status === "not_mine" && v.creatorProfile ? `<div><a class="sc-link" href="${esc(v.creatorProfile)}">Go to the real profile →</a></div>` : ""}
    ${
      v.status === "likely_accurate"
        ? `<div class="sc-muted">Released ${esc(v.released ?? "before " + (v.baselineBefore ?? "the cutoff"))}. Not yet confirmed by the artist.</div>`
        : ""
    }
    ${disc}
    <div class="sc-src">From list: <a class="sc-link" href="${esc(v.listUrl)}" target="_blank" rel="noreferrer">${esc(v.listTitle)}</a></div>
    ${v.via ? `<div class="sc-via sc-via-${v.via}">${esc(v.via === "attested" && v.attestedBy ? `Checked by ${v.attestedBy}` : VIA_TEXT[v.via])}</div>` : ""}
  `;
}

/** Build the badge element for a verdict. `onOpen` shows the card anchored to it. */
export function makeBadge(v: Verdict, onOpen: (badge: HTMLElement) => void, onClose: () => void): HTMLElement {
  const b = document.createElement("span");
  b.className = `sloppycat-badge sc-${v.status}`;
  b.textContent = STATUS_GLYPH[v.status];
  b.setAttribute("tabindex", "0");
  b.setAttribute("role", "button");
  b.setAttribute("aria-label", `Sloppycat: ${STATUS_TEXT[v.status]}`);
  b.title = STATUS_TEXT[v.status];
  b.addEventListener("mouseenter", () => onOpen(b));
  b.addEventListener("focus", () => onOpen(b));
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onOpen(b);
  });
  b.addEventListener("mouseleave", onClose);
  return b;
}
