// Catch the store's limits before an upload does. Run as part of packaging.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const problems = [];

// Chrome Web Store limits, which are stricter than the manifest schema's own.
const LIMITS = { name: 75, description: 132, short_name: 12 };
for (const [field, max] of Object.entries(LIMITS)) {
  const value = manifest[field];
  if (typeof value === "string" && value.length > max) {
    problems.push(`${field} is ${value.length} characters, over the ${max} limit:\n    ${value}`);
  }
}

if (!manifest.icons?.["128"]) problems.push("no 128px icon declared, which the store requires");
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) problems.push(`version "${manifest.version}" is not in the format the store accepts`);

const privacy = resolve(root, "docs/privacy.html");
if (!existsSync(privacy)) problems.push("docs/privacy.html is missing, and the listing needs a privacy policy URL");

if (problems.length) {
  console.error("Store checks failed:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`Store checks passed: "${manifest.name}" ${manifest.version}, description ${manifest.description.length}/132 characters.`);
