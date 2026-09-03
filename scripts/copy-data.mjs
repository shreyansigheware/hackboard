// The daily Action commits data/*.json. The app fetches those files at runtime rather than
// bundling them, so a data-only commit republishes without a rebuild. Vite serves public/
// verbatim, so the data is copied there before dev and build.
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "data");
mkdirSync(out, { recursive: true });

for (const name of ["hackathons.json", "archive.json", "stress-test.json"]) {
  const from = join(root, "data", name);
  if (existsSync(from)) {
    copyFileSync(from, join(out, name));
    console.log(`copied data/${name} -> public/data/${name}`);
  }
}
