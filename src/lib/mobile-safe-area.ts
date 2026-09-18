/** Old iOS shells can temporarily report a zero env inset after navigation.
 * Keep a conservative clock/notch clearance only while that measurement is
 * missing; the actual system inset wins as soon as it becomes available.
 */
export function iosTopFallback({ nativeIOS, measuredTop, portrait, tablet, nativeMeasurementKnown = false }: {
  nativeIOS: boolean; measuredTop: number; portrait: boolean; tablet: boolean; nativeMeasurementKnown?: boolean;
}): number {
  if (!nativeIOS || measuredTop > 0 || nativeMeasurementKnown || !portrait) return 0;
  return tablet ? 24 : 64;
}

/** iOS reports points (the same units as CSS px at the initial viewport scale).
 * A non-overlaying/hidden status bar needs no web padding. A zero reading for
 * a visible overlay can precede window attachment, so keep the legacy fallback
 * until a measurement is available (landscape already has no such fallback).
 */
export function nativeStatusInset(info: { visible: boolean; overlays: boolean; height: number }): number | undefined {
  if (!Number.isFinite(info.height) || info.height < 0) return undefined;
  if (!info.visible || !info.overlays) return 0;
  return info.height > 0 ? info.height : undefined;
}

// Also used by the root error boundary, where the main stylesheet is absent.
export const safeAreaPadding = "max(24px, var(--safe-area-inset-top, env(safe-area-inset-top, 0px)), var(--native-status-top, 0px), var(--ios-safe-top, 0px)) max(24px, var(--safe-area-inset-right, env(safe-area-inset-right, 0px))) max(24px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))) max(24px, var(--safe-area-inset-left, env(safe-area-inset-left, 0px)))";
