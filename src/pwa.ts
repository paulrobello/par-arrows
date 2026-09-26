export type InstallBrowser =
  | "ios-safari"
  | "ios-other"
  | "android-chrome"
  | "samsung"
  | "firefox-android"
  | "android-other"
  | "desktop";

export interface InstallContext {
  readonly mobile: boolean;
  readonly standalone: boolean;
  readonly browser: InstallBrowser;
  /** Mobile browser tab, not an installed app. */
  readonly shouldPrompt: boolean;
}

/**
 * Classify the running browser from its user agent. iPadOS reports a desktop
 * Mac user agent, so a Mac UA with a touch screen counts as iOS; Samsung
 * Internet and Edge both carry a Chrome token, so they are matched first.
 */
export function detectInstallContext(input: {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
  readonly standalone: boolean;
}): InstallContext {
  const ua = input.userAgent;
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && input.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  let browser: InstallBrowser = "desktop";
  if (ios) {
    browser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios-other" : "ios-safari";
  } else if (android) {
    if (/SamsungBrowser/.test(ua)) browser = "samsung";
    else if (/Firefox/.test(ua)) browser = "firefox-android";
    else if (/EdgA|OPR|YaBrowser/.test(ua)) browser = "android-other";
    else if (/Chrome/.test(ua)) browser = "android-chrome";
    else browser = "android-other";
  }
  const mobile = ios || android;
  return {
    mobile,
    standalone: input.standalone,
    browser,
    shouldPrompt: mobile && !input.standalone,
  };
}

/** Human steps for adding the game to the home screen in each browser. */
export function installSteps(browser: InstallBrowser): readonly string[] {
  switch (browser) {
    case "ios-safari":
      return [
        "Tap the Share button in Safari's toolbar.",
        "Choose Add to Home Screen.",
        "Tap Add, then open Par Arrows from your home screen.",
      ];
    case "ios-other":
      return [
        "Open this page in Safari; only Safari can reliably add it on iPhone and iPad.",
        "Tap the Share button, then choose Add to Home Screen.",
        "Tap Add, then open Par Arrows from your home screen.",
      ];
    case "android-chrome":
      return [
        "Tap the ⋮ menu in Chrome.",
        "Choose Install app (or Add to Home screen).",
        "Confirm, then open Par Arrows from your home screen.",
      ];
    case "samsung":
      return [
        "Tap the ☰ menu in Samsung Internet.",
        "Choose Add page to, then Home screen.",
        "Confirm, then open Par Arrows from your home screen.",
      ];
    case "firefox-android":
      return [
        "Tap the ⋮ menu in Firefox.",
        "Choose Add to Home screen (or Install).",
        "Confirm, then open Par Arrows from your home screen.",
      ];
    case "android-other":
      return [
        "Open your browser's menu.",
        "Choose Install app or Add to Home screen.",
        "Open Par Arrows from your home screen.",
      ];
    case "desktop":
      return [
        "In Chrome or Edge, use the install icon in the address bar, or the browser menu's Install option.",
        "On a phone, open this page and add it to your home screen for full-screen play.",
      ];
  }
}

/** True when the page is already running as an installed app. */
export function runningStandalone(): boolean {
  const modes = ["standalone", "fullscreen", "minimal-ui"];
  return (
    modes.some(
      (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches,
    ) || (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export class PwaInstallPrompt {
  private deferred: InstallPromptEvent | undefined;

  constructor(private readonly update: (available: boolean) => void) {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.deferred = event as InstallPromptEvent;
      this.update(true);
    });
    this.update(false);
  }

  async prompt(): Promise<void> {
    if (!this.deferred) {
      return;
    }
    await this.deferred.prompt();
    await this.deferred.userChoice;
    this.deferred = undefined;
    this.update(false);
  }
}
