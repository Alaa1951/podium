"use client";

import { useLinkStatus } from "next/link";

/** Feedback before a cold route's loading boundary arrives; no optimistic data. */
export function NavigationProgress() {
  const { pending } = useLinkStatus();
  return <i className="navigation-progress" data-navigation-pending={pending || undefined} aria-hidden="true" />;
}
