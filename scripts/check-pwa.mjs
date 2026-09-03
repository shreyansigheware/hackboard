/**
 * Checks the PWA claims against a real browser instead of asserting them in a README:
 * the service worker registers and activates, Chrome parses the manifest and reports no
 * errors, and a reload with the network switched off still renders the list from cache.
 *
 * Usage: node scripts/check-pwa.mjs http://localhost:8731/hackboard/
 */
const BASE = process.argv[2] ?? "http://localhost:8731/hackboard/";
const PORT = 9334;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const { spawn } = await import("node:child_process");
const { mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");

const profile = mkdtempSync(join(tmpdir(), "hackboard-pwa-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, "--window-size=390,844", "--no-first-run", BASE,
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function socketUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("no debugging target");
}

const socket = new WebSocket(await socketUrl());
await new Promise((r) => socket.addEventListener("open", r, { once: true }));
let id = 1;
const pending = new Map();
socket.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const n = id++; pending.set(n, resolve);
  socket.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await sleep(4000);

const report = {};

// 1. Service worker
report.serviceWorker = await evaluate(`(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { registered: false };
  await navigator.serviceWorker.ready;
  return { registered: true, scope: reg.scope, active: !!reg.active, state: reg.active?.state };
})()`);

// 2. Manifest, as Chrome itself parses it
const manifest = await send("Page.getAppManifest");
report.manifest = {
  url: manifest.result?.url,
  errors: (manifest.result?.errors ?? []).map((e) => `${e.critical ? "CRITICAL " : ""}${e.message}`),
  name: manifest.result?.parsed?.name ?? null,
  display: /"display"\s*:\s*"([^"]+)"/.exec(manifest.result?.data ?? "")?.[1] ?? null,
  icons: (manifest.result?.data?.match(/"purpose"/g) ?? []).length,
};

// 3. Let the worker cache the shell and the data, then pull the plug.
await evaluate(`(async () => { await fetch("data/hackathons.json"); return true; })()`);
await sleep(1500);
await send("Network.emulateNetworkConditions", {
  offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
});
await send("Page.reload", { ignoreCache: false });
await sleep(5000);

report.offline = await evaluate(`(() => ({
  navigatorOnLine: navigator.onLine,
  cards: document.querySelectorAll(".card").length,
  count: document.querySelector(".count")?.textContent?.trim() ?? null,
  offlineBadge: !!document.querySelector(".offline"),
  stamp: document.querySelector(".stamp")?.textContent?.trim().slice(0, 90) ?? null,
}))()`);

socket.close();
chrome.kill();
console.log(JSON.stringify(report, null, 2));
