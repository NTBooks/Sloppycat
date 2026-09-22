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
