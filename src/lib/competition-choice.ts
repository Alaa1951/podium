/** Calendar comparisons use the competition's Qatar date, including today's events. */
export type CompetitionChoice = { id: string; name: string; competitionDate: Date | string; status: string; isActive?: boolean; archivedAt?: Date | string | null; isTraining?: boolean };
const day = (date: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qatar", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
export function competitionChoices<T extends CompetitionChoice>(series: T[], now = new Date()): T[] {
  return series.filter(s => !s.archivedAt && s.isActive !== false && (s.status === "live" || (s.status === "scheduled" && day(s.competitionDate) >= day(now))))
    .sort((a, b) => Number(b.status === "live") - Number(a.status === "live") ||
      (a.status === "live" ? Number(Boolean(a.isTraining)) - Number(Boolean(b.isTraining)) : 0) ||
      new Date(a.competitionDate).getTime() - new Date(b.competitionDate).getTime() || a.id.localeCompare(b.id));
}
export function completedCompetitions<T extends CompetitionChoice>(series: T[]): T[] {
  return series.filter(s => !s.archivedAt && s.status === "final").sort((a, b) => new Date(b.competitionDate).getTime() - new Date(a.competitionDate).getTime());
}
