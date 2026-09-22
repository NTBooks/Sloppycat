// GitHub device flow (no client secret, no server) and Gist upsert. Set GITHUB_CLIENT_ID to enable.
// Register an OAuth app at https://github.com/settings/developers with "Device Flow" enabled.
export const GITHUB_CLIENT_ID = "";

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function startDeviceFlow(): Promise<DeviceCode> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: "gist" }),
  });
  if (!res.ok) throw new Error(`GitHub device flow failed: HTTP ${res.status}`);
  return (await res.json()) as DeviceCode;
}

export async function pollDeviceFlow(d: DeviceCode): Promise<string> {
  const deadline = Date.now() + d.expires_in * 1000;
  let interval = Math.max(5, d.interval) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, device_code: d.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
    });
    const j = (await res.json()) as { access_token?: string; error?: string };
    if (j.access_token) return j.access_token;
    if (j.error === "slow_down") interval += 5000;
    else if (j.error && j.error !== "authorization_pending") throw new Error(`GitHub: ${j.error}`);
  }
  throw new Error("GitHub sign-in timed out");
}

export async function upsertGist(token: string, gistId: string | undefined, content: string): Promise<{ id: string; rawUrl: string }> {
  const body = JSON.stringify({ description: "Sloppycat verified catalog", public: true, files: { "sloppycat.md": { content } } });
  const res = await fetch(gistId ? `https://api.github.com/gists/${gistId}` : "https://api.github.com/gists", {
    method: gistId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`GitHub gist ${gistId ? "update" : "create"} failed: HTTP ${res.status}`);
  const j = (await res.json()) as { id: string; owner: { login: string } };
  // The stable raw URL (no commit hash) always serves the latest revision.
  return { id: j.id, rawUrl: `https://gist.githubusercontent.com/${j.owner.login}/${j.id}/raw/sloppycat.md` };
}

/** GitHub honors filename/value query params on the new-file page. */
export function githubNewFileUrl(repo: string, content: string, filename = "sloppycat.md", branch = "main"): string {
  const r = repo.replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
  return `https://github.com/${r}/new/${branch}?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(content)}`;
}
