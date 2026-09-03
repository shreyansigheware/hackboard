/**
 * Measures the performance bar from the issue, against the 1,000-row stress fixture, by
 * driving a real headless Chrome over the DevTools Protocol.
 *
 * Not --virtual-time-budget: that fast-forwards timers, so performance.now() advances with
 * virtual time and every duration comes back as 0.0ms. Real wall clock or the numbers are
 * worthless.
 *
 * Usage: node scripts/measure.mjs http://localhost:8731/hackboard/
 */
const BASE = process.argv[2] ?? "http://localhost:8731/hackboard/";
const PORT = 9333;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const { spawn } = await import("node:child_process");
const { mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");

const profile = mkdtempSync(join(tmpdir(), "hackboard-measure-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, "--window-size=1360,900", "--no-first-run",
  BASE.includes("?") ? `${BASE}&stress=1` : `${BASE}?stress=1`,
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* chrome not up yet */ }
    await sleep(250);
  }
  throw new Error("Chrome did not expose a debugging target");
}

const socket = new WebSocket(await target());
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });

async function evaluate(expression) {
  const reply = await send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (reply.result?.exceptionDetails) {
    throw new Error(reply.result.exceptionDetails.exception?.description ?? "evaluate failed");
  }
  return reply.result.result.value;
}

await send("Page.enable");
await send("Runtime.enable");
await sleep(3500);

const probe = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const out = {};
  const count = () => document.querySelector(".count").textContent.trim();
  out.dataset = count();
  out.cardsInDom = document.querySelectorAll(".card").length;
  out.totalNodes = document.getElementsByTagName("*").length;

  const input = document.querySelector(".search");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const settle = (term) => new Promise(resolve => {
    const el = document.querySelector(".count");
    const before = el.textContent;
    const t0 = performance.now();
    setter.call(input, term);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const tick = () => {
      if (el.textContent !== before) return resolve(performance.now() - t0);
      if (performance.now() - t0 > 4000) return resolve(null);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const times = [];
  for (const term of ["sprint", "jam", "challenge", "datathon", "build", "hack", "summit"]) {
    times.push(await settle(term));
    await wait(350);
  }
  setter.call(input, ""); input.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(500);
  const clean = times.filter(t => typeof t === "number").sort((a, b) => a - b);
  out.filterMsMedian = clean[Math.floor(clean.length / 2)];
  out.filterMsMax = clean[clean.length - 1];
  out.filterSamples = clean.map(t => +t.toFixed(1));

  // Scroll through the whole list, sampling frame intervals. Windowing is meant to keep the
  // node count flat; if it does not, this is where it shows.
  const scroller = document.querySelector(".scroll");
  const frames = [];
  let last = performance.now();
  let running = true;
  const onFrame = () => {
    const now = performance.now();
    frames.push(now - last);
    last = now;
    if (running) requestAnimationFrame(onFrame);
  };
  requestAnimationFrame(onFrame);
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * (i / steps);
    await wait(60);
  }
  running = false;
  await wait(120);

  const sane = frames.filter(f => f > 0 && f < 500);
  sane.sort((a, b) => a - b);
  out.frameMsMedian = +sane[Math.floor(sane.length / 2)].toFixed(2);
  out.frameMsP95 = +sane[Math.floor(sane.length * 0.95)].toFixed(2);
  out.droppedOver16_7 = sane.filter(f => f > 16.7).length;
  out.frameSamples = sane.length;
  out.cardsAfterScroll = document.querySelectorAll(".card").length;
  out.nodesAfterScroll = document.getElementsByTagName("*").length;
  return out;
})()`;

let result;
try {
  result = await evaluate(probe);
} finally {
  socket.close();
  chrome.kill();
}

console.log(JSON.stringify(result, null, 2));
