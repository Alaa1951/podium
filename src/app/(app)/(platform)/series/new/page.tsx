import Link from "next/link";
import { DraftGuard } from "@/components/app/draft-guard";

import { getTranslator } from "@/lib/i18n/server";
import { createSeries } from "@/lib/actions/series";
import { formatQatarDayKey } from "@/lib/qatar-time";
import { requireAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Creating a competition.
 *
 * Deliberately short: a name, a date, and how the floor runs. It is given the
 * Series 1 scoring table to start from — a competition with no zones cannot be
 * scored, and starting from a blank scoring sheet is nobody's intention. Both
 * that and everything else are editable in its own Settings afterwards.
 */
export default async function NewCompetitionPage() {
  await requireAccess("competitions.create");
  const { t } = await getTranslator();

  // Today on the competition's clock (Qatar), not the server's.
  const suggested = `${formatQatarDayKey(new Date())}T09:00`;

  return (
    <div className="screen" style={{ maxWidth: 720 }}>
      <div className="screen-head">
        <div>
          <Link href="/series" className="linkish">
            ← {t("Competitions")}
          </Link>
          <h1 style={{ marginTop: 6 }}>{t("New competition")}</h1>
          <p>
            {t(
              "Next you will choose which studios take part, and then registrations can arrive."
            )}
          </p>
        </div>
      </div>

      <DraftGuard><form action={createSeries}>
        <section className="form-block">
          <div className="form-row">
            <label style={{ flex: "2 1 240px" }}>
              <span className="field-label">{t("Name")}</span>
              <input
                className="input"
                name="name"
                required
                minLength={2}
                maxLength={120}
                placeholder="PODIUM Series 4"
              />
            </label>
            <label style={{ flex: "1 1 200px" }}>
              <span className="field-label">{t("Date and time")}</span>
              <input
                className="input pd-num"
                name="competitionDate"
                type="datetime-local"
                defaultValue={suggested}
                required
              />
            </label>
          </div>

          <div className="form-row">
            <label style={{ flex: "2 1 240px" }}>
              <span className="field-label">{t("Venue")}</span>
              <input className="input" name="venue" defaultValue="All studios" maxLength={120} />
            </label>
            <label style={{ flex: "1 1 130px" }}>
              <span className="field-label">{t("First wave at")}</span>
              <input className="input pd-num" name="firstWaveTime" type="time" defaultValue="09:00" />
            </label>
          </div>

          <div className="form-row">
            <label style={{ flex: "1 1 160px" }}>
              <span className="field-label">{t("Wave length (minutes)")}</span>
              <input
                className="input pd-num"
                name="waveMinutes"
                type="number"
                min={1}
                max={180}
                defaultValue={20}
              />
            </label>
            <label style={{ flex: "1 1 160px" }}>
              <span className="field-label">{t("Teams per wave")}</span>
              <input
                className="input pd-num"
                name="waveCapacity"
                type="number"
                min={1}
                max={99}
                defaultValue={9}
              />
            </label>
          </div>
        </section>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-primary">
            {t("Create and choose studios")}
          </button>
          <Link href="/series" className="btn btn-ghost">
            {t("Cancel")}
          </Link>
        </div>
      </form></DraftGuard>
    </div>
  );
}
