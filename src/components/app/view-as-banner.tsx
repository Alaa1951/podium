import { getTranslator } from "@/lib/i18n/server";

/**
 * The strip that makes a preview impossible to mistake for real life: who the
 * app is currently being viewed as, and the way out. Rendered once, above
 * every signed-in screen, for as long as the preview cookie lives.
 */
export async function ViewAsBanner({ name, role }: { name: string | null; role: string }) {
  const { t } = await getTranslator();
  const who = name ?? t("an account");
  const roleLabel = t(
    role === "admin"
      ? "Admin"
      : role === "staff"
        ? "BFT MENA"
        : role === "studio"
          ? "Studio"
          : role === "organiser"
            ? "Organiser"
            : "Athlete"
  );

  return (
    <div className="view-as-banner" role="status">
      <span className="view-as-banner-eye" aria-hidden>
        ◉
      </span>
      <span className="view-as-banner-text">
        {t("Viewing the app as {name}", { name: who })} · {roleLabel} ·{" "}
        <strong>{t("Read-only preview")}</strong>
      </span>
      <a href="/api/view-as/exit" className="btn btn-sm view-as-banner-exit">
        {t("Exit preview")}
      </a>
    </div>
  );
}
