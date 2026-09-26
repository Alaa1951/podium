import Link from "next/link";
import { PlainHeader } from "@/components/app/plain-header";
import { AthleteIdentity, JoinSeries } from "@/components/me/participation-controls";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { competitionChoices, completedCompetitions } from "@/lib/competition-choice";
import { formatQatarDayKey } from "@/lib/qatar-time";
import { meHref } from "@/lib/participation";

export default async function MyCompetitions() {
  const user = await requireRole("competitor");
  const { t } = await getTranslator();
  const [mine, open, identity] = await Promise.all([
    prisma.series.findMany({ where: { archivedAt: null, OR: [
      { participants: { some: { userId: user.id, archivedAt: null } } },
      { teams: { some: { archivedAt: null, competitors: { some: { userId: user.id } } } } },
    ] }, orderBy: { competitionDate: "desc" } }),
    prisma.series.findMany({ where: { archivedAt: null, isActive: true, signupOpen: true, isTraining: false, status: { in: ["scheduled", "live"] } }, orderBy: { competitionDate: "asc" } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { name: true, phone: true } }),
  ]);
  return <div className="screen"><PlainHeader roleLabel={identity?.name ?? t("Athlete")} />
    <div className="screen-head"><h1>{t("My competitions")}</h1></div>
    <p className="reg-sub">{t("One account. A separate team and result in each competition.")}</p>
    <div style={{ display: "grid", gap: 16 }}>
      {competitionChoices(mine).map(series => <article className="card" key={series.id}>
        <h2>{series.name} {series.isTraining && <span className="tag">{t("Training")}</span>}</h2>
        <p>{t(series.status)} · {formatQatarDayKey(series.competitionDate)}</p>
        <Link className="btn btn-primary" href={meHref(series.id)}>{t("Open competition")}</Link>
      </article>)}
      {!mine.length && <p className="notice">{t("No entry found for you yet.")}</p>}
    </div>
    {!user.viewAs && competitionChoices(open).filter(series => !mine.some(entry => entry.id === series.id)).map(series => <article className="card" key={series.id} style={{ marginTop: 16 }}>
      <h2>{series.name}</h2><p>{formatQatarDayKey(series.competitionDate)}</p><JoinSeries seriesId={series.id} />
    </article>)}
    {completedCompetitions(mine).length > 0 && <section className="card" style={{ marginTop: 16 }}><h2>{t("Already completed")}</h2>{completedCompetitions(mine).map(s => <p key={s.id}>{s.name} · {formatQatarDayKey(s.competitionDate)} — {t("Already completed")}</p>)}</section>}
    {!user.viewAs && <AthleteIdentity name={identity?.name ?? ""} phone={identity?.phone ?? ""} />}
  </div>;
}
