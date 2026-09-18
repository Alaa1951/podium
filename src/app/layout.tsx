import type { Metadata, Viewport } from "next";

import { PwaRegister } from "@/components/app/pwa-register";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { AuthProvider } from "@/components/auth/auth-provider";
import { fontVariables } from "@/lib/fonts";
import { dirFor, LOCALE_META } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { themeAttribute } from "@/lib/theme";
import { getTheme } from "@/lib/theme-server";

import "./globals.css";

export const metadata: Metadata = {
  title: "PODIUM — BFT MENA",
  description: "Live leaderboard, score entry and results for the PODIUM series.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PODIUM",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#07073d",
  width: "device-width",
  initialScale: 1,
  // Edge to edge in the mobile app shell — the safe-area insets below keep
  // the interface clear of the notch and the clock.
  viewportFit: "cover",
  // The board is read on phones in a gym; pinch-zoom must keep working.
  maximumScale: 5,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const theme = await getTheme();

  return (
    <html
      lang={LOCALE_META[locale].htmlLang}
      dir={dirFor(locale)}
      className={fontVariables}
      /* Absent for "system", so the media query decides and keeps deciding. */
      data-theme={themeAttribute(theme)}
      suppressHydrationWarning
    >
      <body>
        <PwaRegister />
        <AuthProvider>
          <LocaleProvider locale={locale}>{children}</LocaleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
