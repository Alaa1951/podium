import { clockLabel, type ScheduleConflict } from "@/lib/category-schedule";

// Every conflict the planner can report, said the way a person resolves it:
// what is affected, what it needs, and what it has. English keys, translated
// at the call site's translator like every other phrase.

type T = (key: string, vars?: Record<string, string | number>) => string;

/** "2 h 15 min", "45 min". */
export function durationLabel(minutes: number, t: T): string {
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  if (!hours) return t("{minutes} min", { minutes: rest });
  return rest ? t("{hours} h {minutes} min", { hours, minutes: rest }) : t("{hours} h", { hours });
}

const teamList = (numbers: number[]) => numbers.map((number) => `#${number}`).join(", ");

export function conflictMessage(conflict: ScheduleConflict, t: T): string {
  switch (conflict.kind) {
    case "NO_ZONES":
      return t("This competition has no zones yet, so a wave's length cannot be worked out. Add zones in Settings → Scoring.");
    case "TOO_MANY_WAVES":
      return t("The schedule needs {waves} waves; at most 99 are possible. Raise the teams per wave.", { waves: conflict.waves });
    case "OVERRUN": {
      const main = t(
        "{category} finishes about {finish}. With its {break} break, {next} can start at {earliest} at the earliest — it is set to {start}, {short} too early.",
        {
          category: t(conflict.category), finish: clockLabel(conflict.finishMinutes), break: durationLabel(conflict.breakMinutes, t),
          next: t(conflict.nextCategory), earliest: clockLabel(conflict.earliestNextMinutes), start: clockLabel(conflict.nextStartMinutes),
          short: durationLabel(conflict.shortByMinutes, t),
        }
      );
      const need = t("Required: {required} from the {category} start (competition and break). Available: {available}. Places in time: {fit} for {teams} teams.", {
        required: durationLabel(conflict.requiredMinutes, t), category: t(conflict.category), available: durationLabel(conflict.availableMinutes, t),
        fit: conflict.placesInTime, teams: conflict.teamsToPlace,
      });
      const held = conflict.protectedWaves.length
        ? ` ${t("Waves holding teams running manually that finish too late on their own: {waves}.", { waves: conflict.protectedWaves.join(", ") })}`
        : "";
      return `${main} ${need}${held}`;
    }
    case "PAST_MIDNIGHT":
      return t("{category} would finish at {finish}, after midnight. The competition day ends at 24:00.", {
        category: t(conflict.category), finish: clockLabel(conflict.finishMinutes),
      });
    case "PROTECTED_BEFORE_BLOCK":
      return t("Wave {wave} ({time}) holds teams running manually ({teams}) but starts before the {category} block ({blockStart}).", {
        wave: conflict.waveNumber, time: conflict.startTime, teams: teamList(conflict.teams), category: t(conflict.category), blockStart: conflict.blockStart,
      });
    case "PROTECTED_OUTSIDE_SCHEDULE":
      return t("Wave {wave} ({time}) holds teams running manually ({teams}) before the first category starts.", {
        wave: conflict.waveNumber, time: conflict.startTime, teams: teamList(conflict.teams),
      });
    case "PROTECTED_BEYOND_CAPACITY":
      return t("Wave {wave} holds teams running manually on stations past {capacity} per wave ({teams}).", {
        wave: conflict.waveNumber, capacity: conflict.capacity, teams: teamList(conflict.teams),
      });
  }
}

/** What to do about a refusal that names teams running manually. */
export const PROTECTED_HINT =
  "Resolve these teams first: move them to a slot that fits, or return them to Auto Assign on the Waves screen. Nothing was changed.";
