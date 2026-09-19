import { notFound } from "next/navigation";

import { BoardFrame } from "@/components/board/board-frame";
import { CountdownGate } from "@/components/board/countdown-gate";
import { Leaderboard } from "@/components/board/leaderboard";
import { RunningBoard } from "@/components/board/running-board";
import { buildBoardPayload, remainingMs } from "@/lib/board";
import { getTranslator } from "@/lib/i18n/server";
import { requireSeries, seriesHref } from "@/lib/require-series";
import { can, getCurrentUser } from "@/lib/session";
import { boardAccess } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/**
 * THE BOARD ON THE WALL — three screens, and which one shows is decided by
 * where the competition is, never by which link was clicked:
 *
 *   BEFORE    the countdown to the moment it opens.
 *   RUNNING   the operator board: wave clock, progress, what is on the floor.
 *   FINISHED  the results, the way the published board reads.
 *
 * Who may sit in front of it follows the same model as everything else
 * (visibility.ts): BFT MENA always; a signed-in studio or competitor once the
 * event is live or finished — a live board is exactly what a competitor is
 * promised — and never while it is still being set up.
 */
export default async function BoardPage(props: PageProps<"/series/[series]/board">) {
  const user = await getCurrentUser();
  if (!user) notFound();

  const searchParams = await props.searchParams;
  const { locale } = await getTranslator();

  const { series, phase } = await requireSeries(props.params);
  if (!boardAccess(user.role, phase).canSeeBoard) notFound();

  const payload = await buildBoardPayload(series.id);
  if (!payload) notFound();

  // BFT MENA sees the countdown too — it is literally what will be on the wall
  // and somebody has to check it looks right. What they get instead of a lock
  // is ?preview=1, to rehearse the board behind it.
  const bft = user.role === "admin" || user.role === "staff";
  const previewing = searchParams.preview === "1" && bft;

  // The way back depends on who is watching: BFT MENA goes to the competition's
  // menu; a studio or competitor watching live goes to their own dashboard.
  const back =
    user.role === "studio"
      ? "/studio"
      : user.role === "competitor"
        ? "/me"
        : can(user, "overview.view")
          ? seriesHref(series.slug)
          : "/home";

  if (phase === "before" && !previewing) {
    const opensAt = series.boardOpensAt ?? series.competitionDate;
    return (
      <BoardFrame back={back} name={series.name} seriesSlug={series.slug}>
      <CountdownGate
        remainingMs={remainingMs(opensAt) ?? 0}
        opensAtLabel={formatOpensAt(opensAt, locale)}
        seriesName={series.name}
        previewHref={bft ? `${seriesHref(series.slug, "board")}?preview=1` : undefined}
      />
      </BoardFrame>
    );
  }

  if (phase === "live" || previewing) {
    return (
      <BoardFrame back={back} name={series.name} seriesSlug={series.slug}>
        <RunningBoard initial={payload} display={payload.display} seriesLabel={series.name} />
      </BoardFrame>
    );
  }

  return (
    <BoardFrame back={back} name={series.name} seriesSlug={series.slug}>
    <Leaderboard
      initial={payload}
      display={payload.display}
      studios={payload.studios}
      scope="all"
      ownStudioName={null}
      seriesLabel={series.name}
    />
    </BoardFrame>
  );
}

/** "3 OCTOBER · 9:00 AM QATAR TIME" — the line under COMING SOON. */
function formatOpensAt(date: Date, locale: string) {
  const day = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "Asia/Qatar",
  }).format(date);

  const time = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Qatar",
  }).format(date);

  return `${day} · ${time} Qatar time`.toUpperCase();
}
