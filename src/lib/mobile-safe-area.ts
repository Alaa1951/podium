/** Old iOS shells can temporarily report a zero env inset after navigation.
 * Keep a conservative clock/notch clearance only while that measurement is
 * missing; the actual system inset wins as soon as it becomes available.
 */
export function iosTopFallback({ nativeIOS, measuredTop, portrait, tablet }: {
  nativeIOS: boolean; measuredTop: number; portrait: boolean; tablet: boolean;
}): number {
  if (!nativeIOS || measuredTop > 0 || !portrait) return 0;
  return tablet ? 24 : 64;
}
