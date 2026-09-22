// Offscreen document: parses server-rendered HTML with DOMParser (unavailable in service workers)
// and runs the same extractors the content script uses.
import { extractors } from "../content/extract/extractors";
import type { Platform } from "../types";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "offscreen:parse") return;
  const { html, url, platform, profileId } = msg as { html: string; url: string; platform: Platform; profileId: string };
  try {
    const ex = extractors[platform];
    if (!ex) throw new Error(`No extractor for ${platform}`);
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Make relative URLs resolvable.
    const base = doc.createElement("base");
    base.href = url;
    doc.head.prepend(base);
    sendResponse({ ok: true, result: ex(doc, url, profileId, new Date().toISOString()) });
  } catch (e) {
    sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
  return false;
});
