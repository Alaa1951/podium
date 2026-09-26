/** Shared translation keys for server action errors. */
export function waveScheduleErrorMessage(error?: string) {
  switch (error) {
    case "SCHEDULE_EXCEEDS_DAY": return "The schedule passes midnight. Choose an earlier start or a shorter interval.";
    case "TOO_MANY_WAVES": return "The schedule supports up to 99 waves. Increase teams per wave.";
    case "WAVE_STARTED": case "SERIES_FINISHED": return "Waves that have started cannot be rescheduled.";
    case "WAVE_FULL": return "That wave is full. Choose another wave.";
    case "NO_SUCH_WAVE": return "That wave does not exist yet. Waves are added by whoever builds the running order.";
    case "SCHEDULE_CHANGED": return "The schedule or request changed. Refresh and try again.";
    case "REQUEST_PENDING": return "Your team already has a pending time change request.";
    case "FORBIDDEN": return "You do not have permission to do this.";
    case "NOT_FOUND": return "This team or wave is no longer available.";
    case "NOT_ELIGIBLE": return "Time changes are available for teams assigned to a wave that has not started.";
    case "INVALID_INPUT": return "Check the form — a required value is missing or out of range.";
    default: return "Something went wrong. Try again.";
  }
}
