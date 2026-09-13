import localFont from "next/font/local";

/**
 * BFT's own typefaces, supplied by BFT MENA and self-hosted by `next/font/local`
 * — no external request, no CDN, and nothing for the CSP to allow.
 *
 *   DIN Condensed Bold  the big uppercase display: board titles, ranks, totals
 *   D-DIN               interface headings, labels, buttons
 *   Futura Extra Bold   reserved for the heaviest brand moments
 *   Roboto              body copy and tables
 *
 * These are licensed fonts. They live in src/fonts/ and must not be published
 * anywhere outside this application.
 */

export const dinCondensed = localFont({
  src: [{ path: "../fonts/DINCondensed-Bold.ttf", weight: "700", style: "normal" }],
  variable: "--font-display",
  display: "swap",
  // A condensed fallback keeps the layout from jumping while the face loads.
  fallback: ["Arial Narrow", "Haettenschweiler", "Impact", "sans-serif"],
  adjustFontFallback: false,
});

export const dDin = localFont({
  src: [
    { path: "../fonts/D-DIN-Regular.otf", weight: "400", style: "normal" },
    { path: "../fonts/D-DIN-Bold.otf", weight: "700", style: "normal" },
  ],
  variable: "--font-heading",
  display: "swap",
  fallback: ["Roboto", "Helvetica Neue", "Arial", "sans-serif"],
  adjustFontFallback: false,
});

export const futura = localFont({
  src: [{ path: "../fonts/Futura-ExtraBold.otf", weight: "800", style: "normal" }],
  variable: "--font-brand",
  display: "swap",
  fallback: ["Futura", "Trebuchet MS", "Arial", "sans-serif"],
  adjustFontFallback: false,
});

export const roboto = localFont({
  src: [
    { path: "../fonts/Roboto-Regular.ttf", weight: "400", style: "normal" },
    { path: "../fonts/Roboto-Medium.ttf", weight: "500", style: "normal" },
    { path: "../fonts/Roboto-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-body",
  display: "swap",
  fallback: ["Helvetica Neue", "Arial", "sans-serif"],
  adjustFontFallback: false,
});

/** Every font variable, for the <html> class. */
export const fontVariables = [
  dinCondensed.variable,
  dDin.variable,
  futura.variable,
  roboto.variable,
].join(" ");
