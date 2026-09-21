import Link from "next/link";

import { ApprovalBanner } from "@/components/app/approval-banner";
import { PlainHeader } from "@/components/app/plain-header";
import { AthleteProfile, type AthleteProfileDTO } from "@/components/me/athlete-profile";
import { PortraitUpload } from "@/components/me/portrait-upload";
import { TeamEditor } from "@/components/me/team-editor";
import { can } from "@/lib/access";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { getMyTeam, getSeriesZones, rankBracket, getSeriesTeams } from "@/lib/queries";
import { fmt } from "@/lib/scoring";
import { requireRole } from "@/lib/session";
import { isCompeting, teamStatus, teamStatusLabel, teamStatusTone } from "@/lib/team-status";
import { eventPhase, teamEditOpen } from "@/lib/visibility";
import { summariseWaves } from "@/lib/waves";
import { getSeriesWaves } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * AN ATHLETE'S OWN PAGE.
 *
 * The competitor sign-in has always pushed here; until now there was nothing at
 * the other end of it. One person, one entry: who they are paired with, when
 * they are on the floor, and — once the scores are in — what they did.
 *
 * Deliberately the whole of what a competitor account can reach. They see their
 * own team and nothing else, which is what `teamScope` already says.
 */
export default async function MyPage(editMode = false) {
  const user = await requireRole("competitor");
  const { t, locale } = await getTranslator();

  // The profile an athlete filled in at sign-up: level, category, partner.
  const profileRow = await prisma.athleteProfile.findUnique({
    where: { userId: user.id },
    select: {
      division: true,
      category: true,
      lookingForPartner: true,
      partnerName: true,
      partnerEmail: true,
      partnerPhone: true,
      partnerUserId: true,
    },
  });
  const profile: AthleteProfileDTO | null = profileRow
    ? {
        division: profileRow.division,
        category: profileRow.category,
        lookingForPartner: profileRow.lookingForPartner,
        partnerName: profileRow.partnerName,
        partnerEmail: profileRow.partnerEmail,
        partnerPhone: profileRow.partnerPhone,
        partnerLinked: Boolean(profileRow.partnerUserId),
      }
    : null;
  // Somebody has to be told they were asked, and there is no per-account
  // notification row in this system — so the count is read here, on every
  // render of the page they already open, rather than polled for.
  const waitingRequests =
    profile && !profile.partnerLinked
      ? await prisma.partnerRequest.count({
          where: {
            toUserId: user.id,
            status: "pending",
            from: { archivedAt: null, status: { not: "disabled" } },
          },
        })
      : 0;

  const profileCard = profile ? (
    <>
      {waitingRequests > 0 ? (
        <div className="notice" style={{ marginTop: 16 }} role="status">
          {waitingRequests === 1
            ? t("An athlete wants to partner with you.")
            : t("{n} athletes want to partner with you.", { n: waitingRequests })}{" "}
          <Link href="/me/partner/requests" style={{ color: "var(--bft-cyan-text)" }}>
            {t("Open your requests")}
          </Link>
        </div>
      ) : null}
      <AthleteProfile profile={profile} canEdit={!user.viewAs && can(user, "partner.edit")} />
      {profile.lookingForPartner && !profile.partnerLinked && can(user, "partner.browse") ? (
        <Link href="/me/partner" className="btn btn-primary" style={{ marginTop: 12 }}>
          {t("Find a partner")}
        </Link>
      ) : null}
    </>
  ) : null;

  // The competition they are in: the most recent one with an entry of theirs.
  const entry = await prisma.team.findFirst({
    where: { competitors: { some: { userId: user.id } } },
    orderBy: { series: { competitionDate: "desc" } },
    select: { series: { select: { id: true, slug: true, name: true, competitionDate: true, teamEditCloseHours: true, status: true, venue: true, boardOpensAt: true, resultsPublicAt: true } } },
  });

  if (!entry) {
    return (
      <div className="screen">
        <PlainHeader roleLabel={user.name ?? t("Athlete")} />
        <div className="screen-head">
          <h1>{t("Your PODIUM")}</h1>
        </div>
        <ApprovalBanner userId={user.id} />
        {profileCard}
        <div className="notice">
          <strong>{t("No entry found for you yet.")}</strong>{" "}
          {t("Your studio registers your pair. It appears here as soon as they do.")}
        </div>
      </div>
    );
  }

  const series = entry.series;
  const waveGrant = await prisma.zoneStaff.findFirst({
    where: { userId: user.id, series: { status: "live" } },
    select: { id: true },
  });
  const [team, zones, everyone, waves] = await Promise.all([
    getMyTeam(series.id, user),
    getSeriesZones(series.id),
    getSeriesTeams(series.id),
    getSeriesWaves(series.id),
  ]);

  const summary = summariseWaves(waves);
  const phase = eventPhase({
    status: series.status,
    teamCount: everyone.length,
    wavesTotal: summary.total,
    wavesComplete: summary.complete,
    wavesRunning: summary.running,
    boardOpensAt: series.boardOpensAt,
    resultsPublicAt: series.resultsPublicAt,
    now: new Date(),
  });

  const date = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Qatar",
  }).format(series.competitionDate);

  if (!team) {
    return (
      <div className="screen">
        <PlainHeader roleLabel={user.name ?? t("Athlete")} />
        <ApprovalBanner userId={user.id} />
        {profileCard}
        <div className="notice">{t("Your entry could not be found. Ask your studio to check it.")}</div>
      </div>
    );
  }

  const wave = waves.find((one) => one.number === team.wave) ?? null;
  const status = teamStatus(team);

  // Correcting who stands on the team — open until the series' own cutoff,
  // closed from then on. The clock is the server's, not theirs.
  const canEditTeam = teamEditOpen({
    competitionDate: series.competitionDate,
    teamEditCloseHours: series.teamEditCloseHours,
    now: new Date(),
  }).open;

  // A placing is only shown once the scores are in. Before that a rank against
  // a half-scored field is a number that will change, which is worse than none.
  const ranked =
    phase === "results" || phase === "public"
      ? rankBracket(
          everyone.filter(isCompeting),
          team.category,
          team.division
        )
      : [];
  const mine = ranked.find((one) => one.id === team.id) ?? null;

  if (editMode) return <div className="screen"><PlainHeader roleLabel={t("Edit team")} /><TeamEditor members={team.competitors.map(person => ({position:person.position,fullName:person.fullName,email:person.email}))} open={canEditTeam} editMode /></div>;

  return (
    <div className="screen">
      <PlainHeader roleLabel={user.name ?? t("Athlete")} />
      <ApprovalBanner userId={user.id} />

      <div className="screen-head">
        <div>
          <h1>{team.name}</h1>
          <p>
            {series.name} · {date}
            {series.venue ? ` · ${series.venue}` : ""}
          </p>
        </div>
        <div className="screen-head-actions">
          <span className={`badge ${teamStatusTone(status)}`}>{t(teamStatusLabel(status))}</span>
        </div>
      </div>

      {/* The member's whole world, in one strip: the wall screen, what the
          public sees, and this page — their own team, their own roster. */}
      <div className="me-links">
        <Link href={`/series/${series.slug}/board`} className="btn btn-secondary">
          {t("Live board")}
        </Link>
        <Link href="/results" className="btn btn-secondary">
          {t("Public results")}
        </Link>
        <Link href="/me" className="btn btn-secondary">
          {t("My team")}
        </Link>
      </div>

      {/* The waiting list, said in words rather than left to a badge.
          Somebody who has paid needs to be told plainly that the money did not
          buy a place, because the opposite is what everybody assumes. */}
      {team.waitlistedAt ? (
        <div className="notice" style={{ marginBottom: 18 }} role="status">
          <strong>{t("You are on the waiting list.")}</strong>{" "}
          {/* Deliberately does not say WHY. Most people here signed up after
              the deadline — but staff can move an entry onto the list too, and
              telling somebody they "entered after registration closed" when
              they did not is a small lie they would have to argue with. What
              they need is their position and what happens next. */}
          {t(
            "You do not have a place in this competition yet. You keep your place in the queue, and we will email you if one comes free."
          )}{" "}
          {team.paidAt
            ? t("Your payment is recorded and will not be lost — but it does not hold a place.")
            : null}
        </div>
      ) : null}

      {/* While the event is on the floor, the live board is one press away —
          the same screen hanging on the gym wall, from their pocket. */}
      {phase === "live" ? (
        <div className="notice" style={{ marginBottom: 18 }}>
          <strong>{t("The competition is running now.")}</strong>{" "}
          <Link href={`/series/${series.slug}/board`} className="linkish">
            {t("Watch the live board")} →
          </Link>
        </div>
      ) : null}

      {/* A granted wave scorer sees the door to their own sheet here. */}
      {waveGrant ? (
        <div className="notice" style={{ marginBottom: 18 }}>
          <strong>{t("You have a score sheet.")}</strong>{" "}
          <Link href="/my-wave" className="linkish">
            {t("Open your score sheet")} →
          </Link>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">{t("Team")}</span>
          <span className="stat-value">{team.number}</span>
          <span className="stat-note">
            {t(team.category)} · {t(team.division)}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t("Wave")}</span>
          <span className="stat-value">{wave ? wave.number : "—"}</span>
          <span className="stat-note">
            {wave ? `${wave.startTime} · ${t("estimated")}` : t("not yet assigned")}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t("Total")}</span>
          <span className="stat-value pd-num">{team.submitted ? fmt(team.total, 2) : "—"}</span>
          <span className="stat-note">{team.submitted ? t("submitted") : t("not scored yet")}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t("Placing")}</span>
          <span className="stat-value pd-num">{mine ? mine.rank : "—"}</span>
          <span className="stat-note">
            {mine ? `${t("of")} ${ranked.length}` : t("after the results")}
          </span>
        </div>
      </div>

      <div className="console-group-title" style={{ marginTop: 26 }}>
        {t("Your pair")}
      </div>
      <div className="table-scroll" style={{ marginTop: 8 }}>
        <table className="table">
          <tbody>
            {team.competitors.map((person) => (
              <tr key={person.id}>
                <td>
                  <strong>{person.fullName}</strong>
                </td>
                <td>{person.studioName ?? t("Non-member")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {profileCard}

      {/* The portraits for the screens over the rigs. Renders nothing at all
          when the feature is switched off — the API it asks says 404. */}
      <PortraitUpload />

      {/* Correcting who stands on the team — the clock decided above. */}
      <TeamEditor
        members={team.competitors.map((person) => ({
          position: person.position,
          fullName: person.fullName,
          email: person.email,
        }))}
        open={canEditTeam}
      />

      {team.submitted ? (
        <>
          <div className="console-group-title" style={{ marginTop: 26 }}>
            {t("What you did")}
          </div>
          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Zone")}</th>
                  <th>{t("Recorded")}</th>
                  <th style={{ width: 120, textAlign: "end" }}>{t("Points")}</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((zone) => (
                  <tr key={zone.id}>
                    <td>
                      {zone.number}. {t(zone.name)}
                    </td>
                    <td className="pd-num">
                      {zone.inputs
                        .map((input) => `${t(input.label)} ${team.values[input.id] ?? "—"}`)
                        .join("  ·  ")}
                    </td>
                    <td className="pd-num" style={{ textAlign: "end" }}>
                      {fmt(team.zones.find((one) => one.number === zone.number)?.points ?? 0, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {phase === "public" ? (
        <p style={{ marginTop: 22 }}>
          <Link
            href={`/results/${series.slug}/${team.category}/${team.division}`}
            className="linkish"
          >
            {t("See the full results")} →
          </Link>
        </p>
      ) : null}
    </div>
  );
}
