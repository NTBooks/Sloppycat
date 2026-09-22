import type { ExtractResult, Platform, SnapshotItem } from "../types";

export interface FetchContext {
  now: string;
  /** Render a URL in a hidden tab and run the in-page extractor there. */
  render(url: string, platform: Platform, profileId: string): Promise<ExtractResult>;
  /** Parse server-rendered HTML with the same extractor, in an offscreen document. */
  parseHtml(html: string, url: string, platform: Platform, profileId: string): Promise<ExtractResult>;
}

export interface Adapter {
  id: Platform;
  label: string;
  /** How this adapter gets data. Informational; shown in the UI. */
  strategy: "json" | "ssr" | "render";
  /** Can the extractor read a bio/about text that a creator controls? Needed for claim verification. */
  supportsBio: boolean;
  parseProfileUrl(url: string): { profileId: string; url: string } | null;
  /** Extract an item id from an item URL (album/book page). Used by consumer overlays. */
  parseItemUrl(url: string): string | null;
  profileUrl(profileId: string): string;
  itemUrl(itemId: string): string;
  /** withBio: also read the creator-editable bio (costs an extra page load on some platforms). */
  fetchSnapshot(profileId: string, ctx: FetchContext, opts?: { withBio?: boolean }): Promise<ExtractResult>;
  /** Search the platform for titles that might be clones. */
  searchLookalikes?(query: string, ctx: FetchContext): Promise<SnapshotItem[]>;
  /** Fill in expensive fields (label, etc.) for a single item. Called only for newly seen items. */
  enrich?(item: SnapshotItem, ctx: FetchContext): Promise<SnapshotItem>;
}

export class ChallengeError extends Error {
  constructor(public url: string) {
    super(`Bot challenge at ${url}`);
  }
}
