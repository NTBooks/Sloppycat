// Typed-ish message helper for extension pages.
export async function send<T = { ok: boolean; error?: string }>(msg: Record<string, unknown>): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as T;
  return res;
}

export function fmtDate(iso: string | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function download(filename: string, text: string, type = "text/markdown"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Show one of the extension's own pages, reusing the tab it is already in.
 *
 * These are places, not documents: there is only ever one Following page, one Alerts page. Opening
 * a new tab each time buries the browser in duplicates of the same thing, so an existing one is
 * brought forward instead, along with the window it lives in.
 *
 * @param path e.g. "ui/alert/index.html", optionally with a #fragment to jump to.
 */
export async function openPage(path: string): Promise<void> {
  const [file, hash] = path.split("#");
  const url = chrome.runtime.getURL(file!);
  try {
    // Match on the file, not the fragment, so a deep link lands in the page already open.
    const existing = (await chrome.tabs.query({ url })).find((t) => t.id !== undefined);
    if (existing?.id !== undefined) {
      await chrome.tabs.update(existing.id, { active: true, ...(hash ? { url: `${url}#${hash}` } : {}) });
      if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch {
    // tabs.query needs the tabs permission and a valid pattern; falling through opens a new one,
    // which is the old behaviour and never worse.
  }
  await chrome.tabs.create({ url: hash ? `${url}#${hash}` : url });
}
