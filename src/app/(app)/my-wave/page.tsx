import Link from "next/link";

import { ScoreGrid } from "@/components/scores/score-grid";
import type { GridTeam } from "@/components/scores/score-grid-types";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { getSeriesZones } from "@/lib/queries";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * A WAVE SCORER'S SHEET.
 *
 * The whole world of an account holding a wave-access grant: the score sheet
 * of exactly their wave — every team on the floor for it, from every studio —
 * with the same one-sheet entry BFT MENA uses. No console, no other waves, no
 * other events. If their grant is for a live event, the sheet is live; once
 * the event is finished it freezes into a record.
 */
export default async function MyWavePage() {
  const user = await requireUser();
  const { t } = await getTranslator();

  const grants = await prisma.waveAccess.findMany({
    where: { userId: user.id },
    orderBy: { wave: { number: "asc" } },
    select: {
      id: true,
      wave: {
        select: {
          number: true,
          startTime: true,
          series: { select: { id: true, slug: true, name: true, status: true } },
        },
      },
    },
  });

  if (grants.length === 0) {
    return (
      <div className="screen">
        <div className="screen-head">
          <div>
            <h1>{t("Your score sheet")}</h1>
          </div>
        </div>
        <div className="notice">
          <strong>{t("No wave access on your account.")}</strong>{" "}
          {t("Ask BFT MENA to grant you a wave, then sign in again.")}
        </div>
        <p style={{ marginTop: 16 }}>
          <Link href="/login" className="linkish">
            {t("Back to sign in")}
          </Link>
        </p>
      </div>
    );
  }

  const sheets = await Promise.all(
    grants.map(async (grant) => {
      const zones = await getSeriesZones(grant.wave.series.id);
      const teams = await prisma.team.findMany({
        where: {
          seriesId: grant.wave.series.id,
          wave: grant.wave.number,
          paymentStatus: "paid",
          archivedAt: null,
        },
        orderBy: { number: "asc" },
        select: {
          id: true,
          number: true,
          name: true,
          category: true,
          division: true,
          wave: true,
          paymentStatus: true,
          scoreEdits: true,
          competitors: { select: { fullName: true } },
          score: {
            select: {
              status: true,
              entries: { select: { inputId: true, value: true } },
            },
          },
        },
      });

      const rows: GridTeam[] = teams.map((team) => ({
        id: team.id,
        number: team.number,
        name: team.name,
        category: team.category,
        division: team.division,
        wave: team.wave,
        competitors: team.competitors.map((person) => person.fullName),
        submitted: team.score?.status === "submitted",
        scoreEdits: team.scoreEdits,
        paymentStatus: team.paymentStatus,
        values: Object.fromEntries(
          (team.score?.entries ?? []).map((entry) => [entry.inputId, entry.value])
        ) as Record<string, number | null>,
        peerTotals: [],
        audit: [],
      }));

      return {
        key: grant.id,
        seriesName: grant.wave.series.name,
        seriesSlug: grant.wave.series.slug,
        frozen: grant.wave.series.status === "final",
        waveNumber: grant.wave.number,
        startTime: grant.wave.startTime,
        zones,
        rows,
      };
    })
  );

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Your score sheet")}</h1>
          <p>{t("Enter what the judges record. Save as you go — every row saves on its own.")}</p>
        </div>
      </div>

      {sheets.map((sheet) => (
        <section key={sheet.key} style={{ marginBottom: 34 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>
            {t("Wave")} {sheet.waveNumber} <span style={{ margin: "0 8px" }}>{"///"}</span>{" "}
            {sheet.seriesName}
            <span className="reg-sub" style={{ marginInlineStart: 12 }}>
              {sheet.startTime} · {t("estimated")}
            </span>
          </h2>

          {sheet.rows.length === 0 ? (
            <div className="notice">
              <strong>{t("No teams in this wave yet.")}</strong>
            </div>
          ) : (
            <ScoreGrid
              teams={sheet.rows}
              zones={sheet.zones}
              editBudget={0}
              isAdmin={false}
              frozen={sheet.frozen}
              frozenReason={
                sheet.frozen ? t("The event has finished — the sheet is a record now.") : undefined
              }
            />
          )}
        </section>
      ))}
    </div>
  );
}
