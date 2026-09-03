/**
 * Renders public-src/icon.svg to the PNG sizes a PWA install actually needs.
 *
 * Uses headless Chrome rather than a raster library: no image dependency to install, and it
 * renders the same SVG the browser would. Opaque background on purpose -- a maskable icon is
 * cropped by the launcher, and transparency there shows as a hole.
 *
 * NOT part of the build. It depends on a Chrome at a macOS path, which the CI runner does not
 * have -- wiring it into prebuild broke the deploy. The PNGs in icons/ are committed artifacts;
 * run `npm run icons` by hand when icon.svg changes, and commit the result.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = join(root, "icons");
mkdirSync(out, { recursive: true });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Inlined, not referenced as file://: headless Chrome refuses to load a local file from a
// local page, and the only symptom is a broken-image marker on an otherwise plausible icon.
const svg = readFileSync(join(here, "icon.svg"), "utf8");

// 192 and 512 are the manifest minimum; 180 is Apple's touch icon; 1024 is spare headroom.
for (const size of [180, 192, 256, 384, 512, 1024]) {
  const page = join(here, `.render-${size}.html`);
  writeFileSync(page, `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#0E1116;overflow:hidden}
svg{display:block;width:${size}px;height:${size}px}</style>
${svg}`);
  const result = spawnSync(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    `--screenshot=${join(out, `icon-${size}.png`)}`,
    `--window-size=${size},${size}`, "--default-background-color=0E1116FF",
    page,
  ], { stdio: "ignore" });
  rmSync(page, { force: true });
  if (result.status !== 0) throw new Error(`Chrome failed rendering ${size}px`);
  console.log(`icons/icon-${size}.png`);
}
