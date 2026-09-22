// Host access for list URLs.
//
// The manifest ships with the GitHub hosts most lists live on, so the install-time prompt stays the
// size it was. A list hosted anywhere else needs one extra grant, which Chrome only asks for at the
// moment the user adds that list. Optional host permissions are not part of the install prompt.

/** Hosts already in the manifest's host_permissions, so a list there needs no grant. */
export const BUILTIN_LIST_HOSTS = [
  "raw.githubusercontent.com",
  "gist.githubusercontent.com",
  "gist.github.com",
  "github.com",
  "api.github.com",
];

/**
 * Origins the manifest requires. getAll() returns these alongside granted optional ones, and asking
 * Chrome to remove a required origin fails, so they are filtered out before the remove call. Read on
 * demand, so this module still imports cleanly outside an extension context.
 */
function manifestOrigins(): Set<string> {
  return new Set((chrome.runtime.getManifest() as chrome.runtime.ManifestV3).host_permissions ?? []);
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url.trim());
  } catch {
    return undefined;
  }
}

export function hostOf(url: string): string | undefined {
  return parse(url)?.host;
}

/**
 * Why this URL can't be a list source, in words the user can act on. Undefined means it is fine.
 * Checked when a URL is pasted, so a bad address fails at the input instead of as a fetch error later.
 */
export function listUrlProblem(url: string): string | undefined {
  const u = parse(url);
  if (!u) return "That is not a URL. Paste the full address, starting with https://";
  if (u.protocol === "http:") return "Lists have to be served over https, so nobody on the network can rewrite one in transit.";
  if (u.protocol !== "https:") return `Sloppycat can only fetch https URLs, and that one is ${u.protocol.replace(":", "")}.`;
  if (!u.host || !u.host.includes(".")) return "That URL has no host name Sloppycat can ask permission for.";
  return undefined;
}

/** The match pattern covering every https URL on this host. Host-wide is the narrowest Chrome grants. */
export function originPatternFor(url: string): string | undefined {
  const u = parse(url);
  if (!u || u.protocol !== "https:" || !u.host) return undefined;
  return `https://${u.host}/*`;
}

export function isBuiltinListHost(url: string): boolean {
  const host = hostOf(url);
  return !!host && BUILTIN_LIST_HOSTS.includes(host);
}

/** Can the extension fetch this URL right now? */
export async function hasListAccess(url: string): Promise<boolean> {
  if (isBuiltinListHost(url)) return true;
  const origins = originPatternFor(url);
  if (!origins) return false;
  try {
    return await chrome.permissions.contains({ origins: [origins] });
  } catch {
    return false;
  }
}

/**
 * Ask for access to this URL's host. Chrome requires a user gesture, so call this from a click or a
 * form submit in an extension page, before anything else that could let the gesture expire. An
 * already-granted host resolves true with no prompt.
 */
export async function requestListAccess(url: string): Promise<boolean> {
  if (isBuiltinListHost(url)) return true;
  const origins = originPatternFor(url);
  if (!origins) return false;
  try {
    return await chrome.permissions.request({ origins: [origins] });
  } catch {
    return false;
  }
}

/**
 * Give back a host nobody needs any more. Called after a source is removed, so removing the one list
 * on a domain also takes back the permission it asked for, rather than leaving it granted forever.
 */
export async function releaseUnusedListAccess(stillUsed: (string | undefined)[]): Promise<void> {
  const keep = new Set(
    stillUsed.filter((u): u is string => !!u).map((u) => originPatternFor(u)).filter((p): p is string => !!p),
  );
  let held: chrome.permissions.Permissions;
  try {
    held = await chrome.permissions.getAll();
  } catch {
    return;
  }
  const builtin = new Set(BUILTIN_LIST_HOSTS.map((h) => `https://${h}/*`));
  const required = manifestOrigins();
  const drop = (held.origins ?? []).filter((o) => !keep.has(o) && !builtin.has(o) && !required.has(o));
  if (drop.length) {
    try {
      await chrome.permissions.remove({ origins: drop });
    } catch {
      // Chrome refuses to remove a required permission; nothing to do about it and nothing broken.
    }
  }
}

/** What to show on a source that cannot be fetched because its host was never granted. */
export function accessErrorFor(url: string): string {
  return `Sloppycat has no permission to read ${hostOf(url) ?? "that host"}. Grant it in Settings under List sources.`;
}
