// Build the extension into dist/ with esbuild.
// Entry points: background service worker, content scripts, and each UI page.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const watch = process.argv.includes("--watch");
const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const moduleEntries = {
  "background": "src/background.ts",
  "ui/onboard/index": "src/ui/onboard/index.tsx",
  "ui/popup/index": "src/ui/popup/index.tsx",
  "ui/options/index": "src/ui/options/index.tsx",
  "ui/alert/index": "src/ui/alert/index.tsx",
  "offscreen/index": "src/offscreen/index.ts",
};
// Content scripts are classic scripts, not modules.
const scriptEntries = {
  "content/extract": "src/content/extract/index.ts",
  "content/overlay": "src/content/overlay/index.ts",
  "content/spotify-capture": "src/content/spotify-capture.ts",
  // Dev-only demo used by docs/promo screenshots; not in the manifest.
  "content/demo-card": "src/content/demo-card.ts",
};

const common = {
  outdir: dist,
  bundle: true,
  target: "chrome120",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  jsx: "automatic",
  jsxImportSource: "preact",
  logLevel: "info",
  define: { "process.env.NODE_ENV": watch ? '"development"' : '"production"' },
};
const ctxs = [
  await esbuild.context({ ...common, entryPoints: moduleEntries, format: "esm" }),
  await esbuild.context({ ...common, entryPoints: scriptEntries, format: "iife" }),
];

function copyStatic() {
  cpSync(resolve(root, "manifest.json"), resolve(dist, "manifest.json"));
  for (const page of ["onboard", "popup", "options", "alert"]) {
    cpSync(resolve(root, `src/ui/${page}/index.html`), resolve(dist, `ui/${page}/index.html`));
  }
  cpSync(resolve(root, "src/offscreen/index.html"), resolve(dist, "offscreen/index.html"));
  cpSync(resolve(root, "src/ui/shared/base.css"), resolve(dist, "ui/base.css"));
  cpSync(resolve(root, "src/content/overlay/overlay.css"), resolve(dist, "content/overlay.css"));
  if (existsSync(resolve(root, "assets/icons/png"))) {
    cpSync(resolve(root, "assets/icons/png"), resolve(dist, "icons"), { recursive: true });
  }
  cpSync(resolve(root, "lists"), resolve(dist, "lists"), { recursive: true });
}

if (watch) {
  copyStatic();
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("watching…");
} else {
  await Promise.all(ctxs.map((c) => c.rebuild()));
  await Promise.all(ctxs.map((c) => c.dispose()));
  copyStatic();
  console.log("built to dist/");
}
