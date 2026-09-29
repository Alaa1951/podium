/**
 * What a sign-in record says about the device. iPhone user agents contain
 * "like Mac OS X", so the order of the checks decides whether a phone is
 * logged as a phone — every iPhone used to be logged as a Mac.
 */
import { describe, expect, it } from "vitest";

import { parseBrowser, parseOs } from "@/lib/device-client";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 Edg/125.0";

describe("parseOs", () => {
  it("tells an iPhone or iPad from a Mac", () => {
    expect(parseOs(IPHONE_SAFARI)).toBe("iOS");
    expect(parseOs(IPAD)).toBe("iOS");
    expect(parseOs(MAC)).toBe("macOS");
  });

  it("keeps the other answers", () => {
    expect(parseOs(ANDROID)).toBe("Android");
    expect(parseOs(WINDOWS)).toBe("Windows");
    expect(parseOs("curl/8.0")).toBe("Unknown");
  });
});

describe("parseBrowser", () => {
  it("names the common browsers", () => {
    expect(parseBrowser(IPHONE_SAFARI)).toBe("Safari");
    expect(parseBrowser(ANDROID)).toBe("Chrome");
    expect(parseBrowser(WINDOWS)).toBe("Edge");
  });
});
