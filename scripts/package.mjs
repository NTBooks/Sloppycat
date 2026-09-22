// Zip dist/ for the Chrome Web Store, with the manifest at the root of the archive.
// Uses PowerShell's Compress-Archive on Windows and `zip` elsewhere, so there's no dependency to install.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const outDir = resolve(root, "build");

if (!existsSync(resolve(dist, "manifest.json"))) {
  console.error("No dist/manifest.json. Run `npm run build` first.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(resolve(dist, "manifest.json"), "utf8"));
mkdirSync(outDir, { recursive: true });
const zip = resolve(outDir, `sloppycat-${manifest.version}.zip`);
rmSync(zip, { force: true });

if (process.platform === "win32") {
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Compress-Archive -Path '${dist}\\*' -DestinationPath '${zip}' -Force`],
    { stdio: "inherit" },
  );
} else {
  execFileSync("zip", ["-r", "-q", zip, "."], { cwd: dist, stdio: "inherit" });
}

console.log(`packaged ${manifest.name} ${manifest.version} -> ${zip}`);
console.log("Upload this at https://chrome.google.com/webstore/devconsole");
