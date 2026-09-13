"use client";

export type DevicePayload = {
  deviceFingerprint: string;
  deviceLabel: string;
  browser: string;
  os: string;
  deviceType: string;
};

// A stable-enough identity for "have I seen this browser before", used only to
// decide whether to challenge with a code. The raw value never leaves as-is:
// the server stores an HMAC of it, so the database holds no reusable token.

function parseBrowser(ua: string) {
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Safari/")) return "Safari";
  return "Unknown";
}

function parseOs(ua: string) {
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Mac OS X")) return "macOS";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
  if (ua.includes("Linux")) return "Linux";
  return "Unknown";
}

function parseDeviceType(ua: string) {
  if (/iPad|Tablet/i.test(ua)) return "Tablet";
  if (/Mobi|Android/i.test(ua)) return "Mobile";
  return "Desktop";
}

function getDeviceId() {
  const key = "podium_device_id";
  try {
    let id = window.localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(key, id);
    }
    return id;
  } catch {
    // Private mode or blocked storage: fall back to a per-session value, which
    // simply means this browser is challenged with a code every time.
    return "no-storage";
  }
}

export function getDevicePayload(): DevicePayload {
  if (typeof window === "undefined") {
    return {
      deviceFingerprint: "",
      deviceLabel: "",
      browser: "",
      os: "",
      deviceType: "",
    };
  }

  const ua = navigator.userAgent;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const browser = parseBrowser(ua);
  const os = parseOs(ua);

  return {
    deviceFingerprint: [getDeviceId(), ua, timezone].join("|"),
    deviceLabel: `${os} · ${browser}`,
    browser,
    os,
    deviceType: parseDeviceType(ua),
  };
}
