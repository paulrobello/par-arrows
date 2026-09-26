import { describe, expect, test } from "bun:test";
import { detectInstallContext, installSteps } from "../src/pwa";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/129.0 Mobile/15E148 Safari/605.1.15",
  ipadDesktopUa:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36",
  androidEdge:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 EdgA/129.0",
  androidFirefox:
    "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0",
};

const detect = (userAgent: string, maxTouchPoints = 5, standalone = false) =>
  detectInstallContext({ userAgent, maxTouchPoints, standalone });

describe("install context detection", () => {
  test.each([
    ["iphoneSafari", "ios-safari"],
    ["iphoneChrome", "ios-other"],
    ["iphoneFirefox", "ios-other"],
    ["iphoneEdge", "ios-other"],
    ["androidChrome", "android-chrome"],
    ["androidSamsung", "samsung"],
    ["androidEdge", "android-other"],
    ["androidFirefox", "firefox-android"],
  ] as const)("%s is a mobile %s browser", (key, browser) => {
    const context = detect(UA[key]);
    expect(context.mobile).toBe(true);
    expect(context.browser).toBe(browser);
  });

  test("an iPad reporting a desktop Mac UA counts as iOS Safari", () => {
    const context = detect(UA.ipadDesktopUa, 5);
    expect(context.mobile).toBe(true);
    expect(context.browser).toBe("ios-safari");
  });

  test.each([
    ["macChrome", 0],
    ["windowsEdge", 10],
    ["ipadDesktopUa", 0],
  ] as const)("%s with %i touch points is desktop", (key, touch) => {
    expect(detect(UA[key], touch).mobile).toBe(false);
  });

  test("standalone is reported, which suppresses the prompt", () => {
    const context = detect(UA.iphoneSafari, 5, true);
    expect(context.standalone).toBe(true);
    expect(context.shouldPrompt).toBe(false);
    expect(detect(UA.iphoneSafari).shouldPrompt).toBe(true);
    expect(detect(UA.macChrome, 0).shouldPrompt).toBe(false);
  });

  test("every browser has non-empty steps and they differ where the flow differs", () => {
    const browsers = [
      "ios-safari",
      "ios-other",
      "android-chrome",
      "samsung",
      "firefox-android",
      "android-other",
      "desktop",
    ] as const;
    for (const browser of browsers) {
      expect(installSteps(browser).length).toBeGreaterThan(0);
    }
    expect(installSteps("ios-safari")).not.toEqual(
      installSteps("android-chrome"),
    );
    expect(installSteps("samsung")).not.toEqual(installSteps("android-chrome"));
  });
});
