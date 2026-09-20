import Link from "next/link";

import { PlainHeader } from "@/components/app/plain-header";
import { PartnerCandidates } from "@/components/me/partner-candidates";
import { PartnerRequests, type PartnerRequestRow } from "@/components/me/partner-requests";
import { can } from "@/lib/access";
import { getTranslator } from "@/lib/i18n/server";
import {
  CANDIDATES_PER_PAGE,
  listPartnerCandidates,
  type PartnerCandidate,
} from "@/lib/partner-directory";
import { prisma } from "@/lib/prisma";
import { requireAccess, requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * FINDING A PARTNER.
 *
 * Two tabs on one screen: who else is looking at this athlete's own level and
 * category, and the asks going each way.
 *
 * Level and category are not choices here. A pair competes in one bracket, so
 * offering anybody else would be offering a team that could not be entered.
 */
export default async function PartnerFinderScreen(
  tab: "browse" | "requests",
  searchParams?: Promise<Record<string, string | string[] | undefined>>
) {
  const user = await requireRole("competitor");
  await requireAccess("partner.browse");
  const { t } = await getTranslator();

  const params = (await searchParams) ?? {};
  const query = typeof params.q === "string" ? params.q : "";
  const page = Math.max(0, Number(typeof params.page === "string" ? params.page : 0) || 0);

  const profile = await prisma.athleteProfile.findUnique({
    where: { userId: user.id },
    select: { division: true, category: true, partnerUserId: true, partnerName: true },
  });

  const shell = (body: React.ReactNode) => (
    <>
      <PlainHeader roleLabel={t("Find a partner")} homeHref="/me" backHref="/me" />
      <div className="screen">
        <div className="screen-head">
          <h1>{tab === "requests" ? t("Partner requests") : t("Find a partner")}</h1>
        </div>
        {body}
      </div>
    </>
  );

  // Somebody who has not said what they compete at cannot be matched with
  // anyone, and an empty list would not explain why.
  if (!profile?.division || !profile.category) {
    return shell(
      <>
        <p className="reg-sub">
          {t("Set your level and category first — that is what you are matched on.")}
        </p>
        <Link href="/me" className="btn btn-primary" style={{ marginTop: 14 }}>
          {t("Open my profile")}
        </Link>
      </>
    );
  }

  if (profile.partnerUserId) {
    return shell(
      <>
        <p className="reg-sub">
          {t("You already have a partner: {name}.", { name: profile.partnerName ?? "" })}
        </p>
        <Link href="/me" className="btn btn-secondary" style={{ marginTop: 14 }}>
          {t("Back to my team")}
        </Link>
      </>
    );
  }

  const me = { id: user.id, division: profile.division, category: profile.category };

  if (tab === "requests") {
    const rows = await prisma.partnerRequest.findMany({
      where: {
        status: "pending",
        OR: [{ fromUserId: user.id }, { toUserId: user.id }],
        // A request from or to an account that has since been closed is not
        // something anybody should be asked to answer.
        from: { archivedAt: null, status: { not: "disabled" } },
        to: { archivedAt: null, status: { not: "disabled" } },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fromUserId: true,
        division: true,
        category: true,
        toDivision: true,
        toCategory: true,
        from: { select: { name: true, studio: { select: { name: true } } } },
        to: { select: { name: true, studio: { select: { name: true } } } },
      },
    });

    const shape = (row: (typeof rows)[number], incoming: boolean): PartnerRequestRow => {
      const them = incoming ? row.from : row.to;
      const asked = incoming
        ? { division: row.division, category: row.category }
        : { division: row.toDivision, category: row.toCategory };
      return {
        id: row.id,
        name: them.name ?? "",
        division: asked.division,
        category: asked.category,
        studioName: them.studio?.name ?? null,
        // The snapshot is here so a level change shows as a level change
        // rather than silently re-bracketing somebody's ask.
        changed:
          asked.division && asked.division !== profile.division
            ? t("They were {level} when this was sent.", { level: t(asked.division) })
            : null,
      };
    };

    return shell(
      <>
        <PartnerRequests
          incoming={rows.filter((row) => row.fromUserId !== user.id).map((row) => shape(row, true))}
          outgoing={rows.filter((row) => row.fromUserId === user.id).map((row) => shape(row, false))}
        />
      </>
    );
  }

  const { rows, total } = await listPartnerCandidates({ me, query, page });
  const shown = page * CANDIDATES_PER_PAGE + rows.length;

  return shell(
    <>
      <p className="reg-sub">
        {t("Athletes at your level and category who are looking for a partner.")}{" "}
        <strong>
          {t(profile.division)} · {t(profile.category)}
        </strong>
      </p>

      <form method="get" style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <input
          className="input"
          name="q"
          defaultValue={query}
          placeholder={t("Search by name…")}
          maxLength={80}
          style={{ flex: "1 1 200px" }}
        />
        <button type="submit" className="btn btn-secondary">
          {t("Search")}
        </button>
      </form>

      {total > 0 ? (
        <p className="reg-sub" style={{ marginTop: 10 }}>
          {t("{shown} of {total}", { shown, total })}
        </p>
      ) : null}

      <PartnerCandidates
        rows={rows as PartnerCandidate[]}
        canRequest={!user.viewAs && can(user, "partner.request")}
      />

      {shown < total ? (
        <Link
          href={`/me/partner?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(page + 1) })}`}
          className="btn btn-secondary btn-block"
          style={{ marginTop: 14 }}
        >
          {t("Show more")}
        </Link>
      ) : null}
    </>
  );
}
