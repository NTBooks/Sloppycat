// Rasterize assets/icons/sloppycat.svg into the PNG sizes Chrome needs.
import sharp from "sharp";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const svg = readFileSync(resolve(root, "assets/icons/sloppycat.svg"));
const out = resolve(root, "assets/icons/png");
mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(resolve(out, `icon-${size}.png`));
}
console.log("icons written to assets/icons/png");
