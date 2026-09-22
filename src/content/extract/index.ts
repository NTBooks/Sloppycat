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

/** Amazon's allbooks grid loads 16 at a time behind a "Show more" button. */
async function expandAmazon(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const btn = [...document.querySelectorAll<HTMLButtonElement>("button.ShowMore, button")].find(
      (b) => /show more/i.test(b.textContent ?? "") && !b.disabled && b.offsetParent !== null,
    );
    if (!btn) return;
    const before = document.querySelectorAll('a[class*="ProductGridItem__overlay"]').length;
    btn.click();
    for (let w = 0; w < 20; w++) {
      await sleep(250);
      if (document.querySelectorAll('a[class*="ProductGridItem__overlay"]').length > before) break;
    }
    if (document.querySelectorAll('a[class*="ProductGridItem__overlay"]').length === before) return;
  }
}

if (!window.__sloppycatExtractInstalled) {
  window.__sloppycatExtractInstalled = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "extract:run") return;
    const { platform, profileId } = msg as { platform: Platform; profileId: string };
    (async () => {
      const ex = extractors[platform];
      if (!ex) throw new Error(`No extractor for ${platform}`);
      await settle(6000);
      if (platform === "amazon" && /\/allbooks/.test(location.pathname)) await expandAmazon();
      sendResponse({ ok: true, result: ex(document, location.href, profileId, new Date().toISOString()) });
    })().catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true; // async response
  });
}
