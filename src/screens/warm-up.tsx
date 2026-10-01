import Link from "next/link";

import { WarmupBoard } from "@/components/checkin/warmup-board";
import { canMarkWarmupReady, canSeeEntranceCheckIn, canSeeWarmupCheckIn } from "@/lib/access";
import { loadCheckIn } from "@/lib/checkin-data";
import { requireDesk, type DeskArea } from "@/lib/desk-screen";
import { getTranslator } from "@/lib/i18n/server";
import type { SeriesScreenProps } from "@/screens/types";

export const dynamic = "force-dynamic";

/**
 * WARM-UP CHECK-IN — ready to compete.
 *
 * A checklist for each wave (the competition's own grouping), in running
 * order and by station. Staff mark a team ready once its preparation is
 * complete; the list shows ready and pending teams with their counts, the
 * entrance desk's arrival status beside each (read-only here), a search, and
 * filters by category, level, wave and readiness.
 *
 * A separate fact from arrival, stored separately (`Team.warmupReadyAt`):
 * checking in at the entrance never marks a team ready, and marking it ready
 * never changes its entrance check-in.
 *
 * Open to `checkIn.view`, and to whoever holds `checkIn.warmup`: the
 * Organiser, a Volunteer, BFT MENA — every team — and a gym, for its own
 * teams, in its own area. Not the Judge or the Coach role, and never an
 * athlete's account (access.ts).
 */
export default async function WarmupPage(props: SeriesScreenProps, area: DeskArea = "console") {
  const { user, series } = await requireDesk(props.params, area, canSeeWarmupCheckIn);
  const { t } = await getTranslator();

  const { teams, waves, waiverRequired } = await loadCheckIn(series.id, user);
  const base = area === "studio" ? `/studio/${series.slug}` : `/series/${series.slug}`;

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Warm-up check-in")}</h1>
          <p>
            {t(
              "Which teams are ready to compete, wave by wave. Mark a team ready once its warm-up and preparation are complete. Arriving at the venue is recorded at the entrance and is shown here for reference only."
            )}
          </p>
        </div>
        {canSeeEntranceCheckIn(user) ? (
          <div className="screen-head-actions">
            <Link href={`${base}/check-in`} className="btn btn-secondary">
              ← {t("Entrance check-in")}
            </Link>
          </div>
        ) : null}
      </div>

      {series.status === "final" ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          {t("This competition is finished.")}
        </div>
      ) : null}
      {area === "studio" ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          {t("These are your studio's teams only.")}
        </div>
      ) : null}

      <WarmupBoard teams={teams} waves={waves} canMark={!user.viewAs && series.status !== "final" && canMarkWarmupReady(user)} waiverRequired={waiverRequired} />
    </div>
  );
}
