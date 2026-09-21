import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { listOpenSignupSeries } from "@/lib/queries";
import { getCurrentUser, homeForUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * SIGN UP — as an athlete, or as an organiser (organiser, judge, volunteer,
 * coach, or a Gym/Studio). The account waits for approval by the studio named
 * or BFT MENA; until then it sees the general pages only.
 */
export default async function SignupPage(props: PageProps<"/signup">) {
  const user = await getCurrentUser();
  if (user) redirect(await homeForUser(user));

  const { t, locale } = await getTranslator();
  const query = await props.searchParams;
  const type = query.type === "athlete" || query.type === "organiser" ? query.type : undefined;
  const email = typeof query.email === "string" ? query.email.slice(0, 200) : undefined;

  // Studio names are public already — they are on every published result.
  // A competition's name and date are what BFT MENA advertises, and only the
  // ones deliberately opened for sign-up appear (listOpenSignupSeries).
  const [studios, series] = await Promise.all([
    prisma.studio.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    listOpenSignupSeries(),
  ]);

  const day = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Qatar",
  });
  // Whether registration has closed is decided on the SERVER clock — a device
  // with the wrong date must not be told it is still in time.
  const now = new Date();
  const competitions = series.map((one) => ({
    id: one.id,
    label: `${one.name} · ${day.format(one.competitionDate)}`,
    closed: Boolean(one.registrationClosesAt && now >= one.registrationClosesAt),
  }));

  return (
    <AuthShell title={t("Sign up")} blurb={t("Join PODIUM as an athlete, or as part of the team that runs it.")}>
      <SignupForm
        studios={studios}
        competitions={competitions}
        initialType={type}
        initialEmail={email}
      />
    </AuthShell>
  );
}
