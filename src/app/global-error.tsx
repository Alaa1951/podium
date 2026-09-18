"use client";

import { useEffect, useSyncExternalStore } from "react";
import { safeAppPath } from "@/lib/mobile-navigation";
import { safeAreaPadding } from "@/lib/mobile-safe-area";
import { useNativeSafeArea } from "@/components/app/use-native-safe-area";

const subscribe = () => () => {};
const readArabic = () => /(?:^|;\s*)podium_locale=ar(?:;|$)/.test(document.cookie);

/**
 * The last resort: this replaces the root layout, so it carries its own <html>
 * and cannot rely on the stylesheet, the fonts or the locale provider. Every
 * value here is therefore inline and literal.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useNativeSafeArea();
  const arabic = useSyncExternalStore(subscribe, readArabic, () => false);
  useEffect(() => {
    console.error("[GlobalErrorBoundary]", error);
  }, [error]);

  return (
    <html lang={arabic ? "ar" : "en"} dir={arabic ? "rtl" : "ltr"}>
      <head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,viewport-fit=cover" /></head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#07073d",
          color: "#f2f2f3",
          fontFamily: "system-ui, sans-serif",
          padding: safeAreaPadding,
        }}
      >
        <div style={{ maxWidth: 460, minWidth: 0, overflowWrap: "anywhere", textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: "#9a9aff" }}>
            PODIUM
          </div>
          <h1 style={{ fontSize: "clamp(28px,7vw,40px)", margin: "10px 0" }}>
            {arabic ? "تعذر فتح هذه الصفحة" : "Unable to open this page"}
          </h1>
          <p style={{ fontSize: 14, color: "rgba(242,242,243,0.8)" }}>
            {arabic ? "أعد المحاولة. إذا استمرت المشكلة، أرسل رقم المرجع إلى إدارة المسابقة." : "Try again. If the problem continues, share the reference with the competition administrator."}
          </p>
          {error.digest ? (
            <p style={{ fontSize: 12, color: "#9a9aff", letterSpacing: "0.1em" }}>
              {arabic ? "المرجع" : "Reference"}: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              let path = "/login";
              try { const saved = safeAppPath(sessionStorage.getItem("podium:lastPath")); if (saved && saved.split("?")[0] !== location.pathname) path = saved; } catch { /* Recover through login. */ }
              if (path === location.pathname) retry(); else location.assign(path);
            }}
            style={{
              marginTop: 18,
              padding: "10px 22px",
              minHeight: 48,
              minWidth: 48,
              fontSize: 16,
              cursor: "pointer",
              border: "2px solid #00b5cc",
              background: "#00b5cc",
              color: "#07073d",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {arabic ? "حاول مرة أخرى" : "Try again"}
          </button>
        </div>
      </body>
    </html>
  );
}
