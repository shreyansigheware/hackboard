// Everything Vite should serve verbatim is assembled into public/ here rather than being
// checked in there: the data is committed at the repo root by the daily Action, the icons are
// generated, and the service worker needs a build stamp injected.
import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");

mkdirSync(join(pub, "data"), { recursive: true });
for (const name of ["hackathons.json", "archive.json", "stress-test.json"]) {
  const from = join(root, "data", name);
  if (existsSync(from)) copyFileSync(from, join(pub, "data", name));
}

mkdirSync(join(pub, "icons"), { recursive: true });
for (const name of readdirSync(join(root, "icons"))) {
  copyFileSync(join(root, "icons", name), join(pub, "icons", name));
}

copyFileSync(join(root, "static", "manifest.webmanifest"), join(pub, "manifest.webmanifest"));

// The stamp is what makes cache versioning work: a new build means a new cache name, and the
// worker's activate step deletes every older one. Without it a returning visitor keeps being
// served the bundle they first installed.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const sw = readFileSync(join(root, "static", "sw.js"), "utf8").replace("__BUILD__", stamp);
writeFileSync(join(pub, "sw.js"), sw);

console.log(`public/ assembled (service worker build ${stamp})`);
