import Link from "next/link";

import { EntranceBoard } from "@/components/checkin/entrance-board";
import { canAssistBracketChange, canCheckInEntrance, canSeeEntranceCheckIn, canSeeWarmupCheckIn } from "@/lib/access";
import { loadBracketFacts } from "@/lib/bracket-data";
import { loadCheckIn } from "@/lib/checkin-data";
import { requireDesk, type DeskArea } from "@/lib/desk-screen";
import { getTranslator } from "@/lib/i18n/server";
import type { SeriesScreenProps } from "@/screens/types";

export const dynamic = "force-dynamic";

/**
 * ENTRANCE CHECK-IN — arrival at the venue.
 *
 * Every team holding a place and each of its athletes, with who has arrived:
 * totals for teams and for people (kept apart), the same per category and
 * level, a search, and filters by category, level and check-in status.
 * Checking in is per athlete or for the whole team; a pair that arrives one
 * at a time is shown as partly arrived and the absent partner is not counted.
 *
 * Open to `checkIn.view`, and to whoever holds the check-in itself
 * (`registrations.attendance`): the Organiser, a Volunteer, BFT MENA — every
 * team — and a gym, for its own teams, in its own area. Not the Judge or the
 * Coach role, and never an athlete's account (access.ts).
 *
 * Staff who may change a category or level at the athlete's request
 * (`registrations.bracket`) get that on each team here too — the desk is
 * where an athlete asks. BFT MENA and event staff may until the team has a
 * score; a gym until the competition's cutoff (bracket.ts). It moves the team
 * between brackets and leaves its check-in exactly as it was.
 *
 * Nothing here marks a team ready to compete: that is the warm-up desk.
 */
export default async function CheckInPage(props: SeriesScreenProps, area: DeskArea = "console") {
  const { user, series } = await requireDesk(props.params, area, canSeeEntranceCheckIn);
  const { t } = await getTranslator();

  const { teams } = await loadCheckIn(series.id, user);
  const mayAssist = !user.viewAs && canAssistBracketChange(user);
  const brackets = mayAssist ? await loadBracketFacts(teams.map((team) => team.id), user, "staff") : null;
  const base = area === "studio" ? `/studio/${series.slug}` : `/series/${series.slug}`;

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Entrance check-in")}</h1>
          <p>
            {t(
              "Who has arrived at the venue. Check in each athlete as they arrive, or the whole team at once. A team counts as checked in only when everyone on it is here."
            )}
          </p>
        </div>
        {canSeeWarmupCheckIn(user) ? (
          <div className="screen-head-actions">
            <Link href={`${base}/warm-up`} className="btn btn-secondary">
              {t("Warm-up check-in")} →
            </Link>
          </div>
        ) : null}
      </div>

      {area === "studio" ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          {t("These are your studio's teams only.")}
        </div>
      ) : null}

      <EntranceBoard teams={teams} canCheckIn={!user.viewAs && canCheckInEntrance(user)} brackets={brackets} />
    </div>
  );
}
