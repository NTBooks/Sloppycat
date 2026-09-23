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
 * Put Amazon's author grid in publication order before reading it.
 *
 * It defaults to Popularity, which is the worst possible order for this: the window a partial read
 * gets is then an arbitrary slice that shifts between checks, so nothing in it can be compared with
 * anything. Newest first turns the same partial read into the top of the catalogue, which is stable
 * and is where a new release lands.
 *
 * There is no URL for it. The grid is drawn by the page's own script, so the control only exists
 * once that has run, and it is driven the way a person would drive it. Best effort by nature: it
 * reports whether it worked, and a read that could not be sorted is treated as unsortable rather
 * than pretended over.
 */
const DATE_CHOICE = /publication date|release date|newest|most recent|date.*new|new.*first/i;

function firstItemHref(): string {
  return document.querySelector('a[class*="ProductGridItem__overlay"]')?.getAttribute("href") ?? "";
}

async function gridChanged(before: string, ms = 8000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await sleep(200);
    if (firstItemHref() !== before) return true;
  }
  return false;
}

async function sortAmazonByDate(): Promise<boolean> {
  const before = firstItemHref();

  // A real select is the easy shape.
  for (const sel of Array.from(document.querySelectorAll("select"))) {
    const opt = Array.from(sel.options).find((o) => DATE_CHOICE.test(o.textContent ?? ""));
    if (!opt) continue;
    if (sel.value === opt.value) return true; // already in publication order
    sel.value = opt.value;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return await gridChanged(before);
  }

  // Otherwise a button that opens a menu.
  const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
  const trigger = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], [role="combobox"]')).find(
    (b) => visible(b) && /sort/i.test(`${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""}`),
  );
  if (!trigger) return false;
  trigger.click();
  await sleep(500);
  const choice = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"], [role="menuitem"], [role="menuitemradio"], li a, li button, li'),
  ).find((el) => visible(el) && DATE_CHOICE.test(el.textContent ?? ""));
  if (!choice) {
    trigger.click(); // put the menu back
    return false;
  }
  choice.click();
  return await gridChanged(before);
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

/** @returns true when the grid ran out of "Show more", false when the clock did. */
async function expandAmazon(): Promise<boolean> {
  const deadline = Date.now() + EXPAND_BUDGET_MS;
  const count = () => document.querySelectorAll('a[class*="ProductGridItem__overlay"]').length;
  for (let i = 0; i < 30 && Date.now() < deadline; i++) {
    const btn = [...document.querySelectorAll<HTMLButtonElement>("button.ShowMore, button")].find(
      (b) => /show more/i.test(b.textContent ?? "") && !b.disabled && b.offsetParent !== null,
    );
    if (!btn) return true;
    const before = count();
    btn.click();
    while (Date.now() < deadline && count() === before) await sleep(250);
    if (count() === before) return true;
  }
  return false;
}

if (!window.__sloppycatExtractInstalled) {
  window.__sloppycatExtractInstalled = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "extract:run") return;
    const { platform, profileId, driveThePage } = msg as { platform: Platform; profileId: string; driveThePage?: boolean };
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
        // Cut short by definition, so it says so.
        answer({ ok: true, result: { ...ex(document, location.href, profileId, new Date().toISOString()), partial: true } });
      } catch (e) {
        answer({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }, RESPOND_BY_MS);
    (async () => {
      const ex = extractors[platform];
      if (!ex) throw new Error(`No extractor for ${platform}`);
      await settle(6000);
      // Whether the whole grid was reached decides whether the snapshot can be trusted as a
      // complete list, which decides whether anything new in it is really new.
      let whole = true;
      let newestFirst = false;
      if (platform === "amazon" && /\/allbooks/.test(location.pathname)) {
        // Only in a tab of our own. Reordering a page the reader is looking at is not ours to do.
        if (driveThePage) newestFirst = await sortAmazonByDate();
        whole = await expandAmazon();
      }
      const result = ex(document, location.href, profileId, new Date().toISOString());
      if (!whole) result.partial = true;
      if (newestFirst) result.newestFirst = true;
      answer({ ok: true, result });
    })()
      .catch((e: unknown) => answer({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => window.clearTimeout(giveUp));
    return true; // async response
  });
}
