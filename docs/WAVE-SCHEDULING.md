# Wave scheduling and time changes

Competition overview counts teams in the field (not withdrawn or waitlisted), regardless of payment. Category and level totals link to matching registration filters.

Auto-assign replaces the entire pre-event assignment in this order: Men, Mixed, Women; Rookie, Open, Pro within each category; team number within each group. Each wave fills before the next one starts, including across group boundaries. The last wave may be incomplete. Rebuilding also replaces manual and approved moves, after confirmation. Decision history remains available.

Competition Settings stores the first start and the interval between starts (20 minutes by default). This interval is independent of the full wave duration, which still follows zone work and changeover times. Saving settings does not overwrite existing start times. Arrange time explicitly recalculates them in wave-number order, including manual overrides. Times must remain on the same competition day. Individual pending waves can be edited independently; actual starts remain under Wave control.

Either athlete can request a morning, midday or evening start for their team, with an optional note. Only one request may be pending per team. A request never moves the team until approved. Both athletes see the current assignment and the decision history under My team and My wave.

BFT accounts with `approvals.view` see the Wave change requests tab under Approvals. Decisions additionally require `approvals.decide` and `waves.placeTeams`. Approve & move requires a different pending wave in the same competition with an available station. The move and decision commit together. A stale request, assignment, start time or occupancy must be refreshed before approval. Rejection requires a reason. Preview mode is read-only.

The additive migration `20260924150000_wave_schedule_requests` adds the interval and request history without rewriting existing scheduled times. Deploy the migration before serving the updated application. The default interval for existing competitions is 20 minutes; operators deliberately apply Arrange time when ready.

Validation: `npm test -- --maxWorkers=4`, `npm run type-check`, `npm run lint`, `npm run build -- --webpack`. The local-only `e2e/wave-schedule.spec.ts` creates isolated temporary fixtures and checks category filters, assignment, manual time editing, arranging, simultaneous partner submissions, concurrent approvals and rejection in English/Arabic and desktop/mobile layouts. Browser validation uses the `chromium-390-en-dark`, `chromium-390-ar-dark` and `chromium-1024-en-dark` projects.
