// Content script injected into hidden tabs (and into the creator's own tab for "Snapshot this profile").
// Waits for the page to settle, expands paginated grids, runs the platform extractor, replies with the result.
import { extractors } from "./extractors";
import type { Platform } from "../../types";

declare global {
  interface Window {
    __sloppycatExtractInstalled?: boolean;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Always reply within this, whatever the page is doing. Below the worker's own deadline. */
const RESPOND_BY_MS = 75_000;

function settle(timeoutMs: number): Promise<void> {
  // Resolve when the DOM stops mutating for 800ms, or after timeoutMs.
  return new Promise((resolve) => {
    let timer: number | undefined;
    const done = () => {
      obs.disconnect();
      resolve();
    };
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(done, 800);
    };
    const obs = new MutationObserver(bump);
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    bump();
    window.setTimeout(done, timeoutMs);
  });
}

/**
 * Amazon's allbooks grid loads 16 at a time behind a "Show more" button.
 *
 * Bounded by the clock as well as by clicks. Thirty clicks waiting five seconds each is two and a
 * half minutes of pressing a button, and an author with eighteen hundred titles will happily accept
 * all of them: the check then sat there long enough for the message channel to close under it and
 * came back with nothing at all. Stopping early returns a short catalogue, which the next check can
 * add to; stopping never returns nothing.
 */
const EXPAND_BUDGET_MS = 45_000;

async function expandAmazon(): Promise<void> {
  const deadline = Date.now() + EXPAND_BUDGET_MS;
  const count = () => document.querySelectorAll('a[class*="ProductGridItem__overlay"]').length;
  for (let i = 0; i < 30 && Date.now() < deadline; i++) {
    const btn = [...document.querySelectorAll<HTMLButtonElement>("button.ShowMore, button")].find(
      (b) => /show more/i.test(b.textContent ?? "") && !b.disabled && b.offsetParent !== null,
    );
    if (!btn) return;
    const before = count();
    btn.click();
    while (Date.now() < deadline && count() === before) await sleep(250);
    if (count() === before) return;
  }
}

if (!window.__sloppycatExtractInstalled) {
  window.__sloppycatExtractInstalled = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "extract:run") return;
    const { platform, profileId } = msg as { platform: Platform; profileId: string };
    // Answering is not optional. Returning true promises a reply, and a promise not kept leaves the
    // caller holding a channel until Chrome closes it, which is how a check hung for four minutes
    // and then reported a message-channel error instead of a catalogue.
    let answered = false;
    const answer = (r: { ok: true; result: unknown } | { ok: false; error: string }) => {
      if (answered) return;
      answered = true;
      sendResponse(r);
    };
    // On the deadline, hand back whatever the page has rather than an error: a short catalogue is
    // worth something and the next check can add to it, where a failure is worth nothing.
    const giveUp = window.setTimeout(() => {
      try {
        const ex = extractors[platform];
        if (!ex) throw new Error(`No extractor for ${platform}`);
        answer({ ok: true, result: ex(document, location.href, profileId, new Date().toISOString()) });
      } catch (e) {
        answer({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }, RESPOND_BY_MS);
    (async () => {
      const ex = extractors[platform];
      if (!ex) throw new Error(`No extractor for ${platform}`);
      await settle(6000);
      if (platform === "amazon" && /\/allbooks/.test(location.pathname)) await expandAmazon();
      answer({ ok: true, result: ex(document, location.href, profileId, new Date().toISOString()) });
    })()
      .catch((e: unknown) => answer({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => window.clearTimeout(giveUp));
    return true; // async response
  });
}
