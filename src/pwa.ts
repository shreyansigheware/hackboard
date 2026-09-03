/** Service-worker registration and the two very different install stories. */

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // Registered from BASE_URL, not "/": on a project page the app lives under /hackboard/, and
  // a worker registered at the origin root would be out of scope and silently control nothing.
  const url = `${import.meta.env.BASE_URL}sw.js`;
  addEventListener("load", () => {
    navigator.serviceWorker.register(url, { scope: import.meta.env.BASE_URL }).catch(() => {
      // A failed registration must never break the page. The app works without offline.
    });
  });
}

/** iOS Safari: no beforeinstallprompt, no install button, only the share-sheet route. */
export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return iOS && webkit;
}

export function isInstalled(): boolean {
  return matchMedia("(display-mode: standalone)").matches ||
    // Safari's own, non-standard, flag for a home-screen launch.
    (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export interface InstallPrompt {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Captures Android/Chrome's install prompt so it can be offered at a sensible moment rather
 * than fired at first paint, which is the fastest way to get it dismissed for good.
 */
export function captureInstallPrompt(onReady: (prompt: InstallPrompt | null) => void) {
  const onBeforeInstall = (event: Event) => {
    event.preventDefault();
    onReady(event as unknown as InstallPrompt);
  };
  addEventListener("beforeinstallprompt", onBeforeInstall);
  addEventListener("appinstalled", () => onReady(null));
  return () => removeEventListener("beforeinstallprompt", onBeforeInstall);
}

const DISMISSED = "hackboard:install-dismissed";
export const wasDismissed = () => {
  try { return localStorage.getItem(DISMISSED) === "1"; } catch { return false; }
};
export const rememberDismissed = () => {
  try { localStorage.setItem(DISMISSED, "1"); } catch { /* private mode; just show it again */ }
};
