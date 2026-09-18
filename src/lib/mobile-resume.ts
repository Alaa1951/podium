export const NATIVE_RESUME_REFRESH_MS = 30_000;

/** Capacitor's background signal differs by platform: iOS pause means
 * didEnterBackground; Android inactive means onStop. Inactive iOS apps and
 * paused Android activities may still be visible behind temporary system UI. */
export function createNativeResumeRefresh(
  platform: string,
  now: () => number = () => performance.now(),
  wallNow: () => number = () => Date.now(),
) {
  let backgroundAt: { monotonic: number; wall: number } | undefined;
  const background = () => { backgroundAt ??= { monotonic: now(), wall: wallNow() }; };

  return {
    pause() {
      if (platform === "ios") background();
    },
    stateChange(isActive: boolean, canRefresh: boolean): boolean {
      if (!isActive) {
        if (platform === "android") background();
        return false;
      }
      const startedAt = backgroundAt;
      // Consume even when offline or editing. A duplicate active event must
      // never clear a draft or discard a cache warmed since the actual resume.
      backgroundAt = undefined;
      if (startedAt === undefined || !canRefresh) return false;
      // WebKit can stop its monotonic clock while the phone sleeps. Wall time
      // covers that gap; monotonic time protects against a backward clock edit.
      // A forward clock edit may cause one harmless refresh on this resume.
      const elapsed = Math.max(0, now() - startedAt.monotonic, wallNow() - startedAt.wall);
      return elapsed >= NATIVE_RESUME_REFRESH_MS;
    },
  };
}
