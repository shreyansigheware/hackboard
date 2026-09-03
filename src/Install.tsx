import { useEffect, useState } from "react";
import {
  captureInstallPrompt, isInstalled, isIosSafari, rememberDismissed, wasDismissed,
  type InstallPrompt,
} from "./pwa";

/**
 * Two install paths, because the platforms are genuinely different:
 *
 * Android/Chrome fires `beforeinstallprompt`, which we hold and offer on a real button.
 * iOS Safari fires nothing and has no install API at all — the only route is Share → Add to
 * Home Screen, so it needs instructions. Most PWAs skip this and are simply never installed
 * on iPhone.
 *
 * Neither is shown until the visitor has had a moment with the page, and a dismissal sticks.
 */
export default function Install() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [gone, setGone] = useState(() => isInstalled() || wasDismissed());

  useEffect(() => captureInstallPrompt(setPrompt), []);

  useEffect(() => {
    if (gone || !isIosSafari()) return;
    // Not on first paint: an install ask before anyone has seen a hackathon is just noise.
    const timer = setTimeout(() => setShowIos(true), 12_000);
    return () => clearTimeout(timer);
  }, [gone]);

  const dismiss = () => {
    rememberDismissed();
    setGone(true);
    setShowIos(false);
    setPrompt(null);
  };

  if (gone) return null;

  if (prompt) {
    return (
      <div className="install" role="dialog" aria-label="Install hackboard">
        <div>
          <strong>Install hackboard</strong>
          <p>Opens full screen and works offline.</p>
        </div>
        <button className="install-go" onClick={async () => {
          await prompt.prompt();
          const { outcome } = await prompt.userChoice;
          if (outcome === "accepted") setGone(true);
          setPrompt(null);
        }}>Install</button>
        <button className="install-x" onClick={dismiss} aria-label="Not now">×</button>
      </div>
    );
  }

  if (showIos) {
    return (
      <div className="install" role="dialog" aria-label="Add hackboard to your home screen">
        <div>
          <strong>Add to Home Screen</strong>
          <p>
            Tap <span className="ios-share" aria-hidden="true">􀈂</span> <b>Share</b>, then{" "}
            <b>Add to Home Screen</b>. It then opens full screen and works offline.
          </p>
        </div>
        <button className="install-x" onClick={dismiss} aria-label="Dismiss">×</button>
      </div>
    );
  }

  return null;
}
