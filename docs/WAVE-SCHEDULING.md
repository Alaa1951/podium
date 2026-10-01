# Wave scheduling and time changes

Competition overview counts teams in the field (not withdrawn or waitlisted), regardless of payment. Category and level totals link to matching registration filters.

## Category schedule

Each competition's Settings has a **Category schedule** section: Men, Mixed and Women each run in their own block of the day, in a configurable order (Men → Mixed → Women by default). Every category needs a start time (`HH:mm`, Qatar time on the competition's date) and a minimum break after it (0–720 minutes, for awards and preparation). Nothing is invented: the times start empty and Auto Assign stays disabled until all three are set.

A block's start is fixed. Its break begins when its **last wave finishes** (start + every zone's work + the changeovers between them), not when that wave starts. Inside a block, waves start one spacing apart: the competition's interval between starts, or the time Zone 1 is busy with a wave, whichever is longer. As the times are typed, the preview shows each category's order, start, teams and waves, estimated finish, break, the earliest the next category may start, and every conflict with the time it needs against the time it has. The planner lives in `src/lib/category-schedule.ts` and `category-schedule-plan.ts`; the preview, the Waves screen and the server all use it.

The schedule is never bent to fit: no start moves, no break shortens, no category spills into another block. A day that does not fit is reported and saved as configured; Auto Assign then refuses and changes nothing until a person resolves it (later starts, shorter breaks, larger waves or a shorter interval).

## Auto Assign

Auto Assign places each category only in its own block, Rookie, Open, Pro within it, team number within each group, each wave filled before the next. It never fills a block with another category's teams. It validates the whole day before writing anything and runs in one transaction that locks the competition's waves (`scheduleTransaction`), so it cannot overwrite a concurrent move. It refuses once a wave has started or a score exists.

**Running manually.** A team moved by hand (the Move… panel on the Waves screen, or an approved wave change request) is marked `Team.slotManualAt` and shows a **Running Manually** badge. Auto Assign keeps it on its exact wave, start time and station, counts that station as taken before placing anybody else, and reassigns only teams not running manually. Its wave may be renumbered so the running order stays chronological. **Return to Auto Assign** (with confirmation) clears the mark; the team stays where it is until the next Auto Assign run.

A protected team may run in another category's block. That is a **scheduling exception**: the move needs an explicit tick; the team keeps its registration category, level, results, ranking and awards; the Waves screen, the summary and Warm-up check-in show it as running outside its block. A move into a wave that finishes after the team's category's awards period begins needs a second tick, and the team is flagged as late for its awards.

Settings changes, wave deletions and time changes that would conflict with a team running manually are refused with the conflict named (move the team or return it to Auto Assign first). Changing a protected wave's number or time needs a confirmation. With a category schedule set, **Arrange time** is not offered: block starts govern the times.

## Moving a team by hand

Staff with `waves.placeTeams` (not a judge, not an athlete) choose a destination wave that has not started and a free station — or a taken one, and the two teams **exchange** slots: how a team gets into a full wave, or swaps stations inside its own. Both teams then run manually, no wave ever holds more teams than before, and the other team's own exception or awards warning needs its own tick. A wave counts only the teams in the field: a withdrawn team keeps its wave on record but gives its place back, and a team on the waiting list holds none. A team whose own wave has started, or that has a submitted zone, shows why on its row instead of a Move button (resetting a wave on Wave control, possible only before any zone is submitted, lets its teams move again). Whenever Confirm cannot be pressed the panel says why, and when the server finds the page out of date the board is refreshed. The server checks the competition is not finished, the team is not on the waiting list and has no score, the wave has not started, the station exists and is free, and that the team is still where the screen showed it (otherwise `SCHEDULE_CHANGED`). Entrance check-in is kept; warm-up readiness is not: it counted only for the old wave, so a moved (or exchanged) team warms up again, and the cleared readiness is recorded in the attendance history. The same happens when a member joins or leaves a team. A gym's account may place only its own teams (server-side). Every move and release is audited with the actor, competition, team, previous and new slot, and any exception or awards warning confirmed (`team.slot_moved`, `team.slot_released`); schedule changes are audited as `event.category_schedule_changed`.

## Times and requests

Competition Settings stores the first start and the interval between starts (20 minutes by default). This interval is independent of the full wave duration, which still follows zone work and changeover times. Saving settings does not overwrite existing start times. Without a category schedule, Arrange time explicitly recalculates them in wave-number order. Times must remain on the same competition day. Individual pending waves can be edited independently; actual starts remain under Wave control.

Either athlete can request a morning, midday or evening start for their team, with an optional note. Only one request may be pending per team. A request never moves the team until approved. Both athletes see the current assignment and the decision history under My team and My wave.

BFT accounts with `approvals.view` see the Wave change requests tab under Approvals. Decisions additionally require `approvals.decide` and `waves.placeTeams`. Approve & move requires a different pending wave in the same competition with an available station; a wave outside the team's block or after its awards needs the same confirmations as a manual move, and the approved team then runs manually. The move and decision commit together, and the team warms up again for its new wave. A stale request, assignment, start time or occupancy must be refreshed before approval. Rejection requires a reason. Preview mode is read-only.

## Migrations

`20260924150000_wave_schedule_requests` adds the interval and request history without rewriting existing scheduled times. `20260930130000_category_schedule` is additive: the `CategorySchedule` table, `Wave.blockCategory` and `Team.slotManualAt`, all empty or null. Existing waves and assignments are untouched; an existing competition keeps its running order and needs a category schedule before its next Auto Assign. `20261001090000_waivers_attendance` (waivers and attendance history, `Team.warmupWaveId`) is described in [WAIVERS.md](WAIVERS.md). Deploy each migration (`prisma migrate deploy`, after a backup) before serving the updated application.

## Starting a wave

Start Wave needs every athlete of every team in the wave to have signed the current waiver (where the competition requires one), to be checked in at the entrance, and the team to be ready in warm-up for this wave. It is checked inside the same locked transaction as every move, so a move or check-out cannot slip between the check and the start. See [WAIVERS.md](WAIVERS.md).

## Validation

`npm test`, `npm run type-check`, `npm run lint`, `npm run build`. Real-database suites (`INTEGRATION_DB=1`): `schedule-auto.integration.test.ts` and `schedule-move.integration.test.ts` cover the category schedule, Auto Assign, protection, moves, permissions and audit against a throwaway schema. The local-only browser specs `e2e/category-schedule.spec.ts` and `e2e/wave-schedule.spec.ts` create isolated temporary fixtures and walk the settings preview, Auto Assign, moves with their confirmations, Return to Auto Assign, the warm-up exception, a volunteer's read-only view, a judge's refusal, category filters, partner requests and concurrent approvals, in English/Arabic and desktop/tablet/phone layouts.
