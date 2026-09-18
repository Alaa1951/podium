import { RecoveryLink } from "@/components/app/recovery-link";
import { getTranslator } from "@/lib/i18n/server";
import { getCurrentUser, homeForUser } from "@/lib/session";

export default async function NotFound() {
  const {t}=await getTranslator();
  const user=await getCurrentUser();
  const home=user ? await homeForUser(user) : "/login";
  return (
    <div
      data-route-error="true"
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        background: "var(--color-accent-900)",
        color: "var(--on-navy)",
      }}
    >
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "var(--color-accent-300)",
          }}
        >
          PODIUM
        </div>
        <h1
          className="pd-num"
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 600,
            fontSize: "clamp(64px,14vw,160px)",
            lineHeight: 0.9,
            margin: "6px 0 4px",
          }}
        >
          404
        </h1>
        <p style={{ fontSize: 14, color: "var(--on-navy-secondary)" }}>
          {t("This screen is unavailable or this account does not have access to it.")}
        </p>
        <RecoveryLink fallback={home} className="btn btn-cyan">{t("Back to the start")}</RecoveryLink>
      </div>
    </div>
  );
}
