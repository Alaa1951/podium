/** Shared translation keys for server action errors. */
export function waveScheduleErrorMessage(error?: string) {
  switch (error) {
    case "SCHEDULE_EXCEEDS_DAY": return "The schedule passes midnight. Choose an earlier start or a shorter interval.";
    case "TOO_MANY_WAVES": return "The schedule supports up to 99 waves. Increase teams per wave.";
    case "WAVE_STARTED": return "Waves that have started cannot be rescheduled.";
    case "SERIES_FINISHED": return "This competition is finished: its running order can no longer change.";
    case "TEAM_WAVE_STARTED": return "This team's wave has started, so the team stays in it. To move it, reset that wave on Wave control first — possible only before any of its zones is submitted.";
    case "WAVE_FULL": return "That wave is full. Choose another wave.";
    case "SWAP_NEEDS_SLOT": return "This team has no station yet, so it cannot exchange places. Choose a free station.";
    case "SWAP_TEAM_SCORED": return "The team on that station has a recorded score, so it cannot move. Choose another station.";
    case "SWAP_EXCEPTION_UNCONFIRMED": return "Confirm the scheduling exception for the team you exchange places with.";
    case "SWAP_AWARDS_UNCONFIRMED": return "Confirm the awards warning for the team you exchange places with.";
    case "NO_SUCH_WAVE": return "That wave does not exist yet. Waves are added by whoever builds the running order.";
    case "SCHEDULE_CHANGED": return "The schedule or request changed. Refresh and try again.";
    case "REQUEST_PENDING": return "Your team already has a pending time change request.";
    case "FORBIDDEN": return "You do not have permission to do this.";
    case "NOT_FOUND": return "This team or wave is no longer available.";
    case "NOT_ELIGIBLE": return "Time changes are available for teams assigned to a wave that has not started.";
    case "INVALID_INPUT": return "Check the form — a required value is missing or out of range.";
    case "CATEGORY_SCHEDULE_MISSING": return "Set every category's start time and break in Settings → Category schedule first. The current waves were kept.";
    case "AUTO_ASSIGN_OFF": return "Auto Assign is switched off for this competition. Turn it on in Settings → Category schedule.";
    case "CATEGORY_SCHEDULE_ACTIVE": return "This competition has a category schedule: Auto Assign lays out the times of each block.";
    case "RESULTS_RECORDED": return "Scores have been recorded, so the running order cannot be rebuilt.";
    case "TEAM_ALREADY_SCORED": return "This team has a recorded score, so it cannot move.";
    case "STATION_TAKEN": return "That station was just taken. Choose another.";
    case "STATION_PROTECTED": return "A team running manually stands on that station.";
    case "BEYOND_CAPACITY": return "That wave does not have that station.";
    case "SAME_SLOT": return "The team already stands there.";
    case "ON_THE_WAITING_LIST": return "This team is on the waiting list and holds no place.";
    case "EXCEPTION_UNCONFIRMED": return "Confirm the scheduling exception to move the team there.";
    case "AWARDS_UNCONFIRMED": return "Confirm the awards warning to move the team there.";
    case "PROTECTED_WAVE": return "This wave holds teams running manually. Confirm to change it.";
    case "PROTECTED_CONFLICT": return "Teams running manually are in the way. Move them or return them to Auto Assign first. Nothing was changed.";
    case "UNAUTHENTICATED": return "You are signed out. Sign in and try again.";
    default: return "Something went wrong. Try again.";
  }
}
