/** Event-day administrative override. An exact event ID is required; unset means normal checks. */
export function isEventReadinessOverridden(series: { id: string }): boolean {
  const configured = process.env.EVENT_READINESS_OVERRIDE_SERIES_ID?.trim();
  return Boolean(configured) && configured === series.id;
}
