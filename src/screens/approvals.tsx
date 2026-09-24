import { ApprovalsSection } from "@/components/approvals/approvals-section";
import { getTranslator } from "@/lib/i18n/server";
import { requireAccess } from "@/lib/session";
import Link from "next/link";
import { can, isBft } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { countPendingWaveChanges, listWaveChangeRequests } from "@/lib/wave-change-requests";
import { WaveChangeList } from "@/components/approvals/wave-change-list";

export const dynamic = "force-dynamic";

/**
 * SIGN-UPS WAITING FOR APPROVAL.
 *
 * Everyone who signed up and proved their email, oldest first. Requests that
 * named a studio also show on that studio's People screen; whoever acts first
 * decides. Only BFT MENA decides a request to become a Gym/Studio.
 */
export default async function ApprovalsPage(search: Record<string, string | string[] | undefined> = {}) {
  const user = await requireAccess("approvals.view");
  const { t } = await getTranslator();
  const waveTab = isBft(user) && search.tab === "waves";
  const seriesId = typeof search.series === "string" && search.series !== "all" ? search.series : undefined;
  const status = search.status === "approved" || search.status === "rejected" || search.status === "all" ? search.status : "pending";
  const [waiting, competitions, requests] = await Promise.all([
    countPendingWaveChanges(user),
    waveTab ? prisma.series.findMany({ where: { archivedAt: null }, orderBy: { competitionDate: "desc" }, select: { id: true, name: true } }) : [],
    waveTab ? listWaveChangeRequests(user, seriesId, status) : [],
  ]);
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>{t("Approvals")}</h1>
          <p>
            {t(
              waveTab ? "Review preferred times and move approved teams to an available wave." : "People who signed up and are waiting to be let in. Until they are approved they see the general pages only."
            )}
          </p>
        </div>
      </div>
      {isBft(user) && <nav className="approval-tabs" aria-label={t("Approvals")}>
        <Link className="chip" data-active={!waveTab || undefined} aria-current={!waveTab ? "page" : undefined} href="/approvals">{t("Sign-up requests")}</Link>
        <Link className="chip" data-active={waveTab || undefined} aria-current={waveTab ? "page" : undefined} href="/approvals?tab=waves">{t("Wave change requests")} ({waiting})</Link>
      </nav>}
      {waveTab ? <>
        <form action="/approvals" className="wave-request-filters">
          <input type="hidden" name="tab" value="waves" />
          <label><span className="field-label">{t("Competition")}</span><select className="input" name="series" defaultValue={seriesId ?? "all"}>
            <option value="all">{t("All competitions")}</option>
            {competitions.map(series => <option key={series.id} value={series.id}>{series.name}</option>)}
          </select></label>
          <label><span className="field-label">{t("Status")}</span><select className="input" name="status" defaultValue={status}>
            <option value="pending">{t("Pending")}</option><option value="approved">{t("Approved")}</option>
            <option value="rejected">{t("Rejected")}</option><option value="all">{t("All")}</option>
          </select></label>
          <button type="submit" className="btn btn-secondary">{t("Filter")}</button>
        </form>
        <WaveChangeList rows={requests} canDecide={!user.viewAs && can(user, "approvals.decide") && can(user, "waves.placeTeams")} />
      </> : <ApprovalsSection user={user} />}
    </div>
  );
}
