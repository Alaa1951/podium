import Link from "next/link";

import { PlainHeader } from "@/components/app/plain-header";
import { SignPanel } from "@/components/waivers/sign-panel";
import { WaiverDocumentView } from "@/components/waivers/waiver-document";
import { getTranslator } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { formatQatarDateTime } from "@/lib/qatar-time";
import { requireUser } from "@/lib/session";
import { parseEditionContent, SIGNING_TEXT } from "@/lib/waivers/document";
import { myWaivers, type MyWaiver } from "@/lib/waivers/my-waivers";

export const dynamic = "force-dynamic";

/**
 * WAIVER DECLARATIONS — the athlete's own page, for every competition they
 * hold a seat in that asks for one: the document in English or Arabic, where
 * they stand, the signing controls under the document, and a receipt for
 * everything they have signed.
 *
 * Open to any signed-in account with a seat — an organiser who also
 * competes signs their own too. Nobody else's waiver can be reached from here.
 */
export default async function WaiversScreen(searchParams: Promise<Record<string, string | string[] | undefined>>) {
  const user = await requireUser();
  const { t, locale } = await getTranslator();
  const params = await searchParams;
  const all = await myWaivers(user.id);
  const wanted = typeof params.series === "string" ? params.series : undefined;
  const needs = (one: MyWaiver) => one.state === "pending" || one.state === "resign";
  const chosen = all.find((one) => one.series.id === wanted) ?? all.find(needs) ?? all[0];
  const language = params.lang === "ar" || params.lang === "en" ? params.lang : locale === "ar" ? "ar" : "en";

  const shell = (body: React.ReactNode) => (
    <>
      <PlainHeader roleLabel={t("Waiver Declarations")} homeHref="/me" />
      <div className="screen waiver-screen">
        <div className="screen-head">
          <h1>{t("Waiver Declarations")}</h1>
        </div>
        {body}
      </div>
    </>
  );

  if (!chosen) {
    return shell(<div className="notice" data-testid="waiver-none">{t("None of your competitions asks for a waiver right now.")}</div>);
  }

  const editionRef = chosen.release.editions.find((one) => one.language === language) ?? chosen.release.editions[0];
  const edition = await prisma.waiverEdition.findUniqueOrThrow({ where: { id: editionRef.id }, select: { content: true, language: true } });
  const doc = parseEditionContent(edition.content);
  const dir = edition.language === "ar" ? "rtl" : "ltr";
  const ack = doc.blocks.find((block) => block.t === "ack");
  const current = chosen.signed.find((one) => one.current);
  const href = (series: string, lang: string) => `/waivers?series=${encodeURIComponent(series)}&lang=${lang}`;
  const canSign = !user.viewAs && chosen.series.status !== "final" && (chosen.state === "pending" || chosen.state === "resign");
  // Just signed: the confirmation stays on the page, with its receipt.
  const justSigned = typeof params.signed === "string" ? chosen.signed.find((one) => one.id === params.signed) : undefined;

  const status = {
    signed: { tone: "badge-ok", label: t("Signed") },
    pending: { tone: "badge-warn", label: t("Pending signature") },
    resign: { tone: "badge-warn", label: t("Requires re-signing") },
    not_required: { tone: "badge-neutral", label: t("Not required") },
    no_account: { tone: "badge-warn", label: t("Pending signature") },
  }[chosen.state];

  return shell(
    <>
      {all.length > 1 ? (
        <nav className="waiver-competitions" aria-label={t("Competitions")}>
          {all.map((one) => (
            <Link key={one.series.id} href={href(one.series.id, language)} className="chip" data-active={one.series.id === chosen.series.id || undefined}>
              {one.series.name} {needs(one) ? "•" : ""}
            </Link>
          ))}
        </nav>
      ) : null}

      {justSigned ? (
        <div className="card waiver-signed" role="status" data-testid="waiver-signed">
          <strong>{t("Signed. Your waiver is saved.")}</strong>
          <Link href={`/waivers/receipt/${justSigned.id}`} className="btn btn-secondary">{t("View receipt")}</Link>
        </div>
      ) : null}

      <section className="card waiver-summary" data-testid="waiver-summary">
        <div className="waiver-summary-head">
          <strong>{chosen.series.name}</strong>
          <span className={`badge ${status.tone}`} data-testid="waiver-status" data-state={chosen.state}>{status.label}</span>
        </div>
        <dl className="waiver-summary-facts">
          <div><dt>{t("Event")}</dt><dd>{doc.event.name}</dd></div>
          <div><dt>{t("Date")}</dt><dd>{doc.event.date}</dd></div>
          <div><dt>{t("Venue")}</dt><dd>{doc.event.venue}</dd></div>
          <div><dt>{t("Waiver version")}</dt><dd className="pd-num">{chosen.release.version}</dd></div>
          <div><dt>{t("Your team")}</dt><dd>#{chosen.team.number} {chosen.team.name} · {t(chosen.team.category)} {t(chosen.team.division)}</dd></div>
        </dl>
        {chosen.state === "signed" && current ? (
          <p className="waiver-state-note">
            {t("You signed version {version} on {date} ({language}).", { version: current.version, date: formatQatarDateTime(current.acceptedAt), language: current.language === "ar" ? "العربية" : "English" })}{" "}
            <Link href={`/waivers/receipt/${current.id}`} data-testid="waiver-receipt-link">{t("View receipt")}</Link>
          </p>
        ) : chosen.state === "resign" ? (
          <p className="waiver-state-note">{t("You signed an earlier version. Read the current version below and sign it — your earlier signature is kept.")}</p>
        ) : (
          <p className="waiver-state-note">{t("Every athlete signs for themselves. Read the whole waiver below, then sign it under the document.")}</p>
        )}
      </section>

      <div className="waiver-language" role="group" aria-label={t("Language")}>
        <Link href={href(chosen.series.id, "en")} className="chip" aria-current={edition.language === "en" ? "true" : undefined} data-active={edition.language === "en" || undefined}>English</Link>
        <Link href={href(chosen.series.id, "ar")} className="chip" aria-current={edition.language === "ar" ? "true" : undefined} data-active={edition.language === "ar" || undefined}>العربية</Link>
      </div>

      <WaiverDocumentView blocks={doc.blocks} language={edition.language} dir={dir} />

      {canSign ? (
        <SignPanel
          seriesId={chosen.series.id}
          releaseId={chosen.release.id}
          language={edition.language}
          dir={dir}
          text={SIGNING_TEXT[edition.language]}
          ack={ack && ack.t === "ack" ? { title: ack.title, paragraphs: ack.paragraphs } : null}
        />
      ) : null}

      {chosen.signed.length ? (
        <section className="card waiver-history">
          <strong>{t("Your signed waivers")}</strong>
          <ul>
            {chosen.signed.map((one) => (
              <li key={one.id}>
                <Link href={`/waivers/receipt/${one.id}`}>{t("Version {version}", { version: one.version })} · {formatQatarDateTime(one.acceptedAt)} · {one.language === "ar" ? "العربية" : "English"}</Link>
                {one.current ? null : <span className="badge badge-neutral">{t("Earlier version")}</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
