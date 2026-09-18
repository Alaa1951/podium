"use client";

export const NOTIFICATIONS_CHANGED = "podium:notifications-changed";

/** Dispatch only after the server confirms a send/read, never optimistically. */
export function notifyNotificationsChanged() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}
