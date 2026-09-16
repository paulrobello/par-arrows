import { describe, expect, test } from "bun:test";
import { hasNewVersion, VersionWatcher } from "../src/version-watcher";

describe("version watcher", () => {
  test("detects a different deployed build", () => {
    expect(hasNewVersion("abc123", "def456")).toBe(true);
  });

  test("ignores the current build and invalid manifests", () => {
    expect(hasNewVersion("abc123", "abc123")).toBe(false);
    expect(hasNewVersion("abc123", undefined)).toBe(false);
    expect(hasNewVersion("abc123", "")).toBe(false);
  });

  test("does not reload the development server", () => {
    expect(hasNewVersion("dev", "deployed-build")).toBe(false);
  });

  test("announces a new build once", async () => {
    let reloads = 0;
    const watcher = new VersionWatcher(
      () => {
        reloads += 1;
      },
      "abc123",
      async () => "def456",
    );

    await watcher.checkNow();
    await watcher.checkNow();

    expect(reloads).toBe(1);
  });

  test("fails open when the manifest cannot be read", async () => {
    let reloads = 0;
    const watcher = new VersionWatcher(
      () => {
        reloads += 1;
      },
      "abc123",
      async () => undefined,
    );

    await watcher.checkNow();

    expect(reloads).toBe(0);
  });
});
