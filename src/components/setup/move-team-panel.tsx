"use client";

import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import type { SetupTeam } from "@/components/setup/wave-board-parts";
import type { Category } from "@/generated/prisma/enums";
import { moveTeam } from "@/lib/actions/team-slot";
import { clockLabel, clockMinutes, lateForAwards, outsideItsBlock, privacyReview, type AwardsWindow } from "@/lib/category-schedule";
import { waveScheduleErrorMessage } from "@/lib/wave-schedule-messages";

// ─────────────────────────────────────────────────────────────────────────────
// MOVING A TEAM BY HAND.
//
// The panel says what the move means before it is confirmed: the slot it
// leaves and the one it takes; that the team will then RUN MANUALLY — Auto
// Assign keeps it exactly there; whether that slot is outside its own
// category's block (a scheduling exception: it still competes, is ranked and
// awarded in its own category); and whether it finishes after its
// category's awards period begins. The last two need an explicit tick.
//
// A taken station can be chosen too: the two teams EXCHANGE slots, which is
// how a team gets into a full wave. The other team then runs manually as
// well, and its own exception or awards warning needs its own tick.
//
// Whenever Confirm cannot be pressed, the panel says why. The server checks
// all of it again (slot-move.ts); when it finds the page out of date the
// board is refreshed, so the next try starts from what is really there.
// ─────────────────────────────────────────────────────────────────────────────

/** A team in the field standing on a station of a wave. */
export type MoveOccupant = { teamId: string; station: number; number: number; name: string; category: Category; scored: boolean };

export type MoveWave = {
  id: string;
  number: number;
  startTime: string;
  durationMinutes: number;
  capacity: number;
  blockCategory: Category | null;
  /** Teams in it other than the one moving — with or without a station. */
  count: number;
  /** The teams on its stations, other than the one moving. */
  occupants: MoveOccupant[];
};

const ERRORS: Record<string, string> = {
  SAME_SLOT: "The team already stands there.",
  WAVE_FULL: "That wave is now full. Choose another wave, or one of its stations to exchange places with the team on it.",
  WAVE_STARTED: "That wave has started since this page opened. Choose another wave.",
  SCHEDULE_CHANGED: "This part of the schedule changed a moment ago. The board was refreshed: check the slots and confirm again.",
  STATION_TAKEN: "That station was just taken. The board was refreshed: choose another.",
  STATION_PROTECTED: "A team running manually stands on that station.",
  TEAM_ALREADY_SCORED: "This team has a recorded score, so it cannot move.",
  ON_THE_WAITING_LIST: "This team is on the waiting list and holds no place.",
  BEYOND_CAPACITY: "That wave does not have that station.",
  EXCEPTION_UNCONFIRMED: "Confirm the scheduling exception to move the team there.",
  AWARDS_UNCONFIRMED: "Confirm the awards warning to move the team there.",
};
/** The page was out of date: refresh the board so the next try is against what is there. */
const STALE = new Set(["SCHEDULE_CHANGED", "STATION_TAKEN", "WAVE_FULL", "WAVE_STARTED", "TEAM_WAVE_STARTED", "TEAM_ALREADY_SCORED", "SWAP_TEAM_SCORED",
  "EXCEPTION_UNCONFIRMED", "AWARDS_UNCONFIRMED", "SWAP_EXCEPTION_UNCONFIRMED", "SWAP_AWARDS_UNCONFIRMED", "NOT_FOUND"]);

type T = (key: string, vars?: Record<string, string | number>) => string;
const blockName = (block: Category | null, t: T) => (block ? t("{category} block", { category: t(block) }) : t("no category block"));
const waveEnd = (wave: MoveWave) => clockMinutes(wave.startTime) + wave.durationMinutes;

function Tick({ id, checked, disabled, onChange, warn, title, note }: { id: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void; warn?: boolean; title: string; note: string }) {
  return (
    <label className={`move-panel-confirm${warn ? " move-panel-warn" : ""}`} data-testid={id}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{title}</strong>
        <span className="field-note" style={{ display: "block", margin: "2px 0 0" }}>{note}</span>
      </span>
    </label>
  );
}

export function MoveTeamPanel({ team, waves, scheduled, awards, onClose, onDone, onStale }: {
  team: SetupTeam;
  /** Waves that have not started — the only possible destinations. */
  waves: MoveWave[];
  scheduled: boolean;
  awards: AwardsWindow[];
  onClose: () => void;
  onDone: (message: string) => void;
  /** Re-read the board: the server found the page out of date. */
  onStale: () => void;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [waveId, setWaveId] = useState("");
  const [station, setStation] = useState("");
  const [ticks, setTicks] = useState({ exception: false, awards: false, swapException: false, swapAwards: false });
  const [error, setError] = useState("");
  const tick = (key: keyof typeof ticks) => (value: boolean) => setTicks((current) => ({ ...current, [key]: value }));

  const category = team.category as Category;
  const current = waves.find((wave) => wave.id === team.waveId) ?? null;
  const target = waves.find((wave) => wave.id === waveId) ?? null;
  const stations = target ? Array.from({ length: target.capacity }, (_, index) => index + 1) : [];
  const occupantAt = (n: number) => target?.occupants.find((one) => one.station === n) ?? null;
  // A wave counting as many teams as it has places has no free station, even
  // while one of them waits for its station.
  const free = target && target.count < target.capacity ? stations.filter((n) => !occupantAt(n)) : [];
  // Exchanging needs a slot to give: a wave that has not started, and a station in it.
  const canSwap = Boolean(current) && team.station !== null;
  const partner = station ? occupantAt(Number(station)) : null;
  const chosen = station ? Number(station) : free[0] ?? null;

  const exception = target ? outsideItsBlock(category, target.blockCategory, scheduled) : false;
  const late = target ? lateForAwards(category, waveEnd(target), awards) : null;
  // The partner takes the mover's slot; it only changes wave when the two differ.
  const partnerMoves = Boolean(partner && current && target && current.id !== target.id);
  const partnerException = partnerMoves ? outsideItsBlock(partner!.category, current!.blockCategory, scheduled) : false;
  const partnerLate = partnerMoves ? lateForAwards(partner!.category, waveEnd(current!), awards) : null;

  const blocker = !target ? t("Choose a wave.")
    : chosen === null ? t("Wave {wave} is full: choose one of its stations to exchange places with the team on it.", { wave: target.number })
    : partner && !canSwap ? t("This team has no station yet, so it cannot exchange places. Choose a free station.")
    : partner?.scored ? t("#{number} has a recorded score and cannot move. Choose another station.", { number: partner.number })
    : target.id === team.waveId && chosen === team.station ? t("The team already stands there.")
    : exception && !ticks.exception ? t("Tick the scheduling exception to confirm.")
    : late && !ticks.awards ? t("Tick the awards warning to confirm.")
    : partnerException && !ticks.swapException ? t("Tick the scheduling exception for #{number} to confirm.", { number: partner!.number })
    : partnerLate && !ticks.swapAwards ? t("Tick the awards warning for #{number} to confirm.", { number: partner!.number })
    : null;

  function confirm() {
    if (!target || blocker) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await moveTeam({
          teamId: team.id, waveId: target.id, station: station ? Number(station) : null,
          expectedWaveId: team.waveId, expectedStation: team.station,
          confirmException: ticks.exception, confirmAwards: ticks.awards,
          swapTeamId: partner?.teamId ?? null, confirmSwapException: ticks.swapException, confirmSwapAwards: ticks.swapAwards,
        });
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? waveScheduleErrorMessage(result.error)));
          if (STALE.has(result.error)) onStale();
          return;
        }
        onDone(partner
          ? t("#{number} {name} and #{other} {otherName} exchanged places; both now run manually.", { number: team.number, name: team.name, other: partner.number, otherName: partner.name })
          : t("#{number} {name} now runs manually in wave {wave}.", { number: team.number, name: team.name, wave: target.number }));
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  return (
    <div className="card move-panel" data-testid="move-panel">
      <strong>{t("Move #{number} {name}", { number: team.number, name: team.name })}</strong>
      <p className="reg-sub" style={{ margin: 0 }}>
        {t("Now")}: {current ? `${t("Wave")} ${current.number} · ${current.startTime} · ${blockName(current.blockCategory, t)} · ${t("Station {station}", { station: team.station ?? "—" })}` : t("not in a wave")}
      </p>

      <div className="move-panel-fields">
        <label>
          <span className="field-label">{t("To wave")}</span>
          <select className="input" value={waveId} disabled={pending} aria-label={t("To wave")}
            onChange={(event) => { setWaveId(event.target.value); setStation(""); setTicks({ exception: false, awards: false, swapException: false, swapAwards: false }); setError(""); }}>
            <option value="">{t("Choose a wave")}</option>
            {waves.map((wave) => {
              const full = wave.count >= wave.capacity;
              return (
                <option key={wave.id} value={wave.id} disabled={full && !canSwap}>
                  {t("Wave")} {wave.number} · {wave.startTime} · {blockName(wave.blockCategory, t)} · {wave.count}/{wave.capacity}{full ? ` · ${t(canSwap ? "full — exchange only" : "full")}` : ""}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          <span className="field-label">{t("Station")}</span>
          <select className="input pd-num" value={station} disabled={pending || !target} aria-label={t("Station")}
            onChange={(event) => { setStation(event.target.value); setTicks((current) => ({ ...current, swapException: false, swapAwards: false })); }}>
            <option value="">{free.length ? t("Lowest free ({station})", { station: free[0] }) : t("Choose a station")}</option>
            {stations.map((n) => {
              const occupant = occupantAt(n);
              return occupant ? (
                <option key={n} value={n} disabled={!canSwap || occupant.scored}>
                  {n} · {t("exchange with #{number} {name}", { number: occupant.number, name: occupant.name })}{occupant.scored ? ` · ${t("has a score")}` : ""}
                </option>
              ) : (
                <option key={n} value={n}>{n} · {t("free")}</option>
              );
            })}
          </select>
        </label>
      </div>

      {target ? (
        <ul className="move-panel-notes">
          <li>{partner
            ? t("#{number} {name} takes this team's slot. Both teams will run manually: Auto Assign keeps each exactly where it is until it is returned to Auto Assign.", { number: partner.number, name: partner.name })
            : t("The team will run manually: Auto Assign keeps it in exactly this slot until it is returned to Auto Assign.")}</li>
          <li>{t("Its category, level, results, ranking and awards stay {category} {division}; its check-in and warm-up status are kept.", { category: t(team.category), division: t(team.division) })}</li>
        </ul>
      ) : null}

      {exception ? (
        <Tick id="confirm-exception" checked={ticks.exception} disabled={pending} onChange={tick("exception")}
          title={t("Scheduling exception: this {category} team would run in the {block}.", { category: t(team.category), block: blockName(target!.blockCategory, t) })}
          note={t("Tick to confirm. It is shown as running outside its category's block.")} />
      ) : null}
      {target && privacyReview(category, target.blockCategory) ? (
        <p className="field-note" data-testid="move-privacy" style={{ margin: 0 }}>
          {t("Privacy review: the women's competition is never photographed or recorded (waiver §8), while the men's and mixed portions may be filmed (§9). This slot changes no category and gives no media consent — BFT MENA checks it before the wave.")}
        </p>
      ) : null}
      {late ? (
        <Tick id="confirm-awards" warn checked={ticks.awards} disabled={pending} onChange={tick("awards")}
          title={t("This wave finishes at {finish}, after the {category} awards period begins ({from}–{to}).", {
            finish: clockLabel(waveEnd(target!)), category: t(team.category), from: clockLabel(late.fromMinutes), to: clockLabel(late.toMinutes),
          })}
          note={t("{category} results will not be complete at its awards. Tick to confirm you have planned for that.", { category: t(team.category) })} />
      ) : null}
      {partnerException ? (
        <Tick id="confirm-swap-exception" checked={ticks.swapException} disabled={pending} onChange={tick("swapException")}
          title={t("Scheduling exception: #{number}, a {category} team, would run in the {block}.", { number: partner!.number, category: t(partner!.category), block: blockName(current!.blockCategory, t) })}
          note={t("Tick to confirm. It is shown as running outside its category's block.")} />
      ) : null}
      {partnerLate ? (
        <Tick id="confirm-swap-awards" warn checked={ticks.swapAwards} disabled={pending} onChange={tick("swapAwards")}
          title={t("#{number}'s new wave finishes at {finish}, after the {category} awards period begins ({from}–{to}).", {
            number: partner!.number, finish: clockLabel(waveEnd(current!)), category: t(partner!.category), from: clockLabel(partnerLate.fromMinutes), to: clockLabel(partnerLate.toMinutes),
          })}
          note={t("{category} results will not be complete at its awards. Tick to confirm you have planned for that.", { category: t(partner!.category) })} />
      ) : null}

      {error ? <div className="notice-error" role="alert">{error}</div> : null}
      {blocker && !error ? <p className="field-note" data-testid="move-blocker" style={{ margin: 0 }}>{blocker}</p> : null}

      <div className="move-panel-buttons">
        <button type="button" className="btn btn-primary" disabled={pending || Boolean(blocker)} onClick={confirm}>
          {pending ? <span className="spinner" /> : null}
          {t("Confirm move")}
        </button>
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>{t("Cancel")}</button>
      </div>
    </div>
  );
}
