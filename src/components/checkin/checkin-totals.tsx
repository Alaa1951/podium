"use client";

import { useT } from "@/components/i18n/locale-provider";
import type { BracketTotals, CheckInTotals } from "@/lib/checkin";

// The figures at the top of the entrance desk. TEAMS and ATHLETES are two
// labelled groups and never one number: "how many teams are in" and "how many
// people are in the building" are asked by different people. Below them, the
// same figures per category and level — press one to see just that bracket.

function Figure({ label, value, note, tone }: { label: string; value: number; note?: string; tone?: "ok" | "warn" }) {
  return (
    <div className="stat-card" data-tone={tone}>
      <span className="stat-label">{label}</span>
      <span className="stat-value pd-num">{value}</span>
      {note ? <span className="stat-note">{note}</span> : null}
    </div>
  );
}

export function CheckInTotalsPanel({
  totals,
  brackets,
  selected,
  onSelect,
}: {
  totals: CheckInTotals;
  brackets: BracketTotals[];
  /** The bracket the list is filtered to ("" = not filtered). */
  selected: { category: string; division: string };
  onSelect: (category: string, division: string) => void;
}) {
  const t = useT();
  return (
    <>
      <div className="checkin-totals">
        <section aria-label={t("Teams")}>
          <h2 className="section-title">{t("Teams")}</h2>
          <div className="checkin-figures">
            <Figure label={t("Registered teams")} value={totals.teams.registered} />
            <Figure label={t("Checked-in teams")} value={totals.teams.checkedIn} tone="ok" note={t("everyone on the team is here")} />
            <Figure
              label={t("Teams not yet checked in")}
              value={totals.teams.notCheckedIn}
              tone={totals.teams.notCheckedIn ? "warn" : undefined}
              note={totals.teams.partial ? t("{count} partly arrived", { count: totals.teams.partial }) : undefined}
            />
          </div>
        </section>
        <section aria-label={t("Athletes")}>
          <h2 className="section-title">{t("Athletes")}</h2>
          <div className="checkin-figures">
            <Figure label={t("Registered athletes")} value={totals.athletes.registered} />
            <Figure label={t("Checked-in athletes")} value={totals.athletes.checkedIn} tone="ok" note={t("people at the venue")} />
            <Figure
              label={t("Athletes not yet checked in")}
              value={totals.athletes.notCheckedIn}
              tone={totals.athletes.notCheckedIn ? "warn" : undefined}
            />
          </div>
        </section>
      </div>

      {brackets.length ? (
        <>
          <h2 className="section-title">{t("By category and level")}</h2>
          <div className="checkin-brackets">
            {brackets.map((row) => {
              const active = selected.category === row.category && selected.division === row.division;
              return (
                <button
                  key={`${row.category}-${row.division}`}
                  type="button"
                  className="checkin-bracket-card"
                  data-active={active || undefined}
                  aria-pressed={active}
                  onClick={() => (active ? onSelect("", "") : onSelect(row.category, row.division))}
                >
                  <strong>
                    {t(row.category)} · {t(row.division)}
                  </strong>
                  <span className="pd-num">
                    {t("Teams: {in} of {total} checked in", { in: row.teams.checkedIn, total: row.teams.registered })}
                  </span>
                  <span className="pd-num">
                    {t("Athletes: {in} of {total} checked in", { in: row.athletes.checkedIn, total: row.athletes.registered })}
                  </span>
                  {row.teams.partial ? (
                    <span className="reg-sub">{t("{count} partly arrived", { count: row.teams.partial })}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </>
  );
}
