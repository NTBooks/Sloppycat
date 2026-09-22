// Zip dist/ for the Chrome Web Store, with the manifest at the root of the archive.
// No dependency to install: PowerShell and .NET on Windows, `zip` elsewhere.
//
// Not Compress-Archive. Windows PowerShell 5.1 writes Windows separators into the entry names, and
// the zip spec says forward slashes, so "ui\popup\index.html" is one file with an odd name rather
// than a path. Unpacked on the store's machines that makes every page in the extension a 404. So the
// entries are written by hand with the names we mean.
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

/**
 * Built into dist/ but deliberately not shipped: nothing in the manifest references these, they
 * exist for the preview server and the screenshots, and a store package should be what the
 * extension actually runs.
 */
const NOT_SHIPPED = ["content/demo-card.js"];

const manifest = JSON.parse(readFileSync(resolve(dist, "manifest.json"), "utf8"));
mkdirSync(outDir, { recursive: true });
const zip = resolve(outDir, `sloppycat-${manifest.version}.zip`);
rmSync(zip, { force: true });

if (process.platform === "win32") {
  const ps = [
    // ZipArchive/ZipArchiveMode are in the first assembly, CreateEntryFromFile in the second.
    "Add-Type -AssemblyName System.IO.Compression",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    "$ErrorActionPreference = 'Stop'",
    `$src = '${dist}'`,
    `$skip = @(${NOT_SHIPPED.map((f) => `'${f}'`).join(", ")})`,
    `$stream = [System.IO.File]::Open('${zip}', [System.IO.FileMode]::Create)`,
    "$archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)",
    "try {",
    "  Get-ChildItem -LiteralPath $src -Recurse -File | ForEach-Object {",
    "    $name = $_.FullName.Substring($src.Length + 1).Replace('\\', '/')",
    "    if ($skip -contains $name) { return }",
    "    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $name, [System.IO.Compression.CompressionLevel]::Optimal)",
    "  }",
    "} finally {",
    "  $archive.Dispose()",
    "  $stream.Dispose()",
    "}",
  ].join("\n");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "inherit" });
} else {
  // zip stores "." as bare names, but accept both spellings of the exclusion so this cannot silently miss.
  const excludes = NOT_SHIPPED.flatMap((f) => [f, `./${f}`]);
  execFileSync("zip", ["-r", "-q", zip, ".", "-x", ...excludes], { cwd: dist, stdio: "inherit" });
}

/** Every entry name in the archive, read out of its central directory. */
function entryNames(file) {
  const buf = readFileSync(file);
  // End of central directory: fixed 22 bytes unless there is an archive comment, so scan back for it.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && eocd < 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) eocd = i;
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error(`central directory entry ${i} is malformed`);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    names.push(buf.toString("utf8", at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

// Forward slashes are what the spec says, and a wrong one here only shows up as a broken upload.
const names = entryNames(zip);
const wrongSeparator = names.filter((n) => n.includes("\\"));
if (wrongSeparator.length) {
  console.error(`Windows separators in ${wrongSeparator.length} entry name(s), e.g. "${wrongSeparator[0]}".`);
  console.error("The store would unpack that as files with odd names instead of folders. Not uploading this.");
  rmSync(zip, { force: true });
  process.exit(1);
}
if (!names.includes("manifest.json")) {
  console.error("manifest.json is not at the root of the archive.");
  rmSync(zip, { force: true });
  process.exit(1);
}
const shouldNotBeHere = names.filter((n) => NOT_SHIPPED.includes(n));
if (shouldNotBeHere.length) {
  console.error(`Dev-only file made it into the package: ${shouldNotBeHere.join(", ")}`);
  rmSync(zip, { force: true });
  process.exit(1);
}

console.log(`packaged ${manifest.name} ${manifest.version} -> ${zip}`);
console.log(`${names.length} files. Left out: ${NOT_SHIPPED.join(", ")}`);
console.log("Upload this at https://chrome.google.com/webstore/devconsole");
