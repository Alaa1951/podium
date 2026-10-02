import { notFound } from "next/navigation";

import { CountdownGate } from "@/components/board/countdown-gate";
import { FloorBoard } from "@/components/board/floor-board";
import { Leaderboard } from "@/components/board/leaderboard";
import { RunningBoard } from "@/components/board/running-board";
import { WallShell } from "@/components/board/wall-shell";
import { buildBoardPayload, formatBoardOpensAt, remainingMs } from "@/lib/board";
import { getTranslator } from "@/lib/i18n/server";
import { getSeriesState } from "@/lib/series-state";
import { wallView } from "@/lib/visibility";

export const dynamic = "force-dynamic";

export const metadata = { title: "PODIUM — Live board" };

/**
 * THE VENUE WALL — /live/[series], the link the room's projector screens open.
 *
 * The signed-in board (/series/[series]/board) is for people with accounts;
 * this is its public twin, built for a screen that hangs on a wall all day:
 * no session, no menu, no way back — the board is the whole page, and
 * wall-shell.tsx takes it edge to edge and keeps it there.
 *
 * What it shows follows wallView (visibility.ts): the countdown before the
 * event, the board while it runs, a "results soon" hold between the last wave
 * and publication, the published leaderboard after. The phase status poll in
 * the shell carries a screen through those changes untouched.
 *
 * TWO DASHBOARDS, ONE LINK EACH. Every competition has two public wall links:
 *
 *   /live/<slug>            live board 1 — the main board, the one the
 *                           signed-in board shows while the event runs.
 *   /live/<slug>?board=2    live board 2 — nothing but the wave(s) on the
 *                           floor this instant, turning between them every
 *                           ten seconds.
 *
 * The venue hangs one display on each and the room reads them side by side.
 * Outside the live phase both show the same thing — countdown, hold, or the
 * published leaderboard — because that is all there is to show.
 */
export default async function LiveWallPage(props: PageProps<"/live/[series]">) {
  const { locale, t } = await getTranslator();

  const { series: slug } = await props.params;
  const searchParams = await props.searchParams;
  const board = searchParams.board === "2" ? "2" : "1";

  const state = await getSeriesState(slug);
  if (!state) notFound();

  const view = wallView(state.phase);
  const opensAt = state.series.boardOpensAt ?? state.series.competitionDate;
  // The wall polls the public API, which gates by phase — never the signed-in
  // board's, which would 401 an anonymous screen.
  const pollHref = `/api/live/${state.series.id}/board`;

  let content: React.ReactNode;
  if (view === "countdown") {
    content = (
      <CountdownGate
        remainingMs={remainingMs(opensAt) ?? 0}
        opensAtLabel={formatBoardOpensAt(opensAt, locale)}
        seriesName={state.series.name}
      />
    );
  } else if (view === "results-hold") {
    content = (
      <ResultsHold
        heading={t("Results soon")}
        detail={t("The final ranking appears here the moment results are published.")}
        seriesName={state.series.name}
      />
    );
  } else {
    const payload = await buildBoardPayload(state.series.id);
    if (!payload) notFound();

    // Live: board 1 is the main board, board 2 is the floor on its own — a
    // different screen for the room, turning between running waves every ten
    // seconds. Published: the leaderboard, either way.
    if (state.phase === "live") {
      content =
        board === "2" ? (
          <FloorBoard
            initial={payload}
            display={payload.display}
            seriesLabel={state.series.name}
            pollHref={pollHref}
          />
        ) : (
          <RunningBoard
            initial={payload}
            display={payload.display}
            seriesLabel={state.series.name}
            pollHref={pollHref}
          />
        );
    } else {
      content = (
        <Leaderboard
          initial={payload}
          display={payload.display}
          studios={payload.studios}
          scope="all"
          ownStudioName={null}
          seriesLabel={state.series.name}
          pollHref={pollHref}
        />
      );
    }
  }

  return (
    <WallShell seriesId={state.series.id} phase={state.phase}>
      {content}
    </WallShell>
  );
}

/**
 * The hold between the last wave and publication. The room has watched the
 * event all day; this screen keeps the board's language and says the one
 * thing left to say. The shell's status poll brings the leaderboard the
 * moment results go public.
 */
function ResultsHold({
  heading,
  detail,
  seriesName,
}: {
  heading: string;
  detail: string;
  seriesName: string;
}) {
  return (
    <div
      className="board"
      style={{
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "clamp(32px,7vw,72px) clamp(16px,4vw,32px)",
        gap: 6,
      }}
    >
      <div
        className="pulse"
        style={{
          fontFamily: "var(--font-heading), sans-serif",
          fontWeight: 700,
          fontSize: "clamp(10px,1.4vw,13px)",
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          color: "var(--board-text-muted)",
        }}
      >
        {seriesName}
      </div>

      <h1
        className="display"
        style={{
          fontSize: "clamp(52px,11vw,130px)",
          lineHeight: 0.9,
          margin: "14px 0 0",
          color: "var(--board-text)",
        }}
      >
        {heading}
      </h1>

      <p
        style={{
          fontSize: "clamp(13px,1.5vw,15px)",
          color: "var(--board-text-muted)",
          marginTop: "clamp(22px,4vw,32px)",
          maxWidth: "46ch",
        }}
      >
        {detail}
      </p>
    </div>
  );
}
