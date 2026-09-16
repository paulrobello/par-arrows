declare const __APP_VERSION__: string;

export const APP_VERSION =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

const POLL_INTERVAL_MS = 60_000;
const RELOADED_VERSION_KEY = "par-arrows:reloaded-version";

export function hasNewVersion(
  currentVersion: string,
  serverVersion: string | undefined,
): boolean {
  return (
    currentVersion !== "dev" &&
    typeof serverVersion === "string" &&
    serverVersion.length > 0 &&
    serverVersion !== currentVersion
  );
}

async function fetchServerVersion(): Promise<string | undefined> {
  try {
    const url = new URL("version.json", document.baseURI);
    url.searchParams.set("t", String(Date.now()));
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { version?: unknown };
    return typeof payload.version === "string" ? payload.version : undefined;
  } catch {
    return undefined;
  }
}

function wasVersionReloaded(version: string): boolean {
  try {
    return window.sessionStorage.getItem(RELOADED_VERSION_KEY) === version;
  } catch {
    return false;
  }
}

export function markVersionReloaded(version: string): void {
  try {
    window.sessionStorage.setItem(RELOADED_VERSION_KEY, version);
  } catch {
    // Reloading still works when session storage is unavailable.
  }
}

export class VersionWatcher {
  private interval: number | undefined;
  private updateFound = false;

  constructor(
    private readonly onNewVersion: (version: string) => void,
    private readonly currentVersion = APP_VERSION,
    private readonly getServerVersion = fetchServerVersion,
  ) {}

  start(): void {
    if (this.currentVersion === "dev" || this.interval !== undefined) return;
    void this.checkNow();
    this.interval = window.setInterval(
      () => void this.checkNow(),
      POLL_INTERVAL_MS,
    );
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  dispose(): void {
    if (this.interval !== undefined) window.clearInterval(this.interval);
    this.interval = undefined;
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
  }

  async checkNow(): Promise<void> {
    if (
      this.updateFound ||
      (typeof document !== "undefined" && document.visibilityState === "hidden")
    )
      return;
    const serverVersion = await this.getServerVersion();
    if (
      typeof serverVersion !== "string" ||
      !hasNewVersion(this.currentVersion, serverVersion) ||
      (typeof window !== "undefined" && wasVersionReloaded(serverVersion))
    )
      return;
    this.updateFound = true;
    this.onNewVersion(serverVersion);
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === "visible") void this.checkNow();
  };
}
