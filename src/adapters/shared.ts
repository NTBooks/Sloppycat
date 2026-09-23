// Helpers shared by adapters and extractors.

/** Patterns that identify a Sloppycat list URL inside free text (a bio, an about section). */
const LIST_URL_PATTERNS = [
  /https?:\/\/gist\.githubusercontent\.com\/[^\s"'<>)]+/gi,
  /https?:\/\/raw\.githubusercontent\.com\/[^\s"'<>)]+/gi,
  /https?:\/\/gist\.github\.com\/[^\s"'<>)]+/gi,
  /https?:\/\/github\.com\/[^\s"'<>)]+\/sloppycat\.md/gi,
  /https?:\/\/[^\s"'<>)]+\/sloppycat\.md/gi,
];

/** Short form a creator can paste when the platform mangles long URLs: sloppycat:<gist id>. */
const SHORT_FORM = /sloppycat:([0-9a-f]{20,40})/i;

export function findListUrl(text: string): string | null {
  if (!text) return null;
  for (const re of LIST_URL_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) return normalizeListUrl(m[0]);
  }
  const s = SHORT_FORM.exec(text);
  if (s) return `https://gist.githubusercontent.com/raw/${s[1]}`;
  return null;
}

/** Turn GitHub/Gist page URLs into raw-content URLs. */
export function normalizeListUrl(url: string): string {
  let u = url.trim().replace(/[.,;:)]+$/, "");
  // https://gist.github.com/user/<id> -> https://gist.githubusercontent.com/user/<id>/raw
  let m = /^https?:\/\/gist\.github\.com\/([^/]+)\/([0-9a-f]+)\/?$/i.exec(u);
  if (m) return `https://gist.githubusercontent.com/${m[1]}/${m[2]}/raw`;
  // https://github.com/user/repo/blob/branch/path -> raw
  m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i.exec(u);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  return u;
}

export async function fetchText(url: string, init?: RequestInit): Promise<{ status: number; text: string; etag?: string }> {
  const res = await fetch(url, { credentials: "include", redirect: "follow", ...init });
  const text = res.status === 304 ? "" : await res.text();
  return { status: res.status, text, etag: res.headers.get("etag") ?? undefined };
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

export function yearOf(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const m = /^(\d{4})/.exec(date);
  return m ? m[1] : undefined;
}

export function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Amazon serves a captcha interstitial to traffic it doesn't like. */
// The title is matched loosely because the background window prefixes it to say whose window it
// is, and losing challenge detection to that would turn a captcha into a silent empty catalogue.
export function looksLikeAmazonChallenge(html: string): boolean {
  return (
    /api-services-support@amazon\.com/i.test(html) ||
    /Type the characters you see in this image/i.test(html) ||
    /<title>[^<]*Robot Check[^<]*<\/title>/i.test(html) ||
    /captchacharacters/i.test(html)
  );
}
