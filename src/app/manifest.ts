import type { MetadataRoute } from "next";

/**
 * THE INSTALLED APP — Add to Home Screen / Install, no app store.
 *
 * Viewers install PODIUM to watch results and the live board from their
 * pocket, so the app opens on the public results — the one screen a stranger
 * can use without an account. Staff navigate to the console by URL or from
 * their session as usual; the installed window is the same app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // Stable identity across updates: changing start_url must not orphan
    // every existing installation by registering a "different" app.
    id: "/",
    name: "PODIUM — BFT MENA",
    short_name: "PODIUM",
    description:
      "Live leaderboard, score entry and results for the PODIUM series — BFT MENA.",
    start_url: "/results",
    scope: "/",
    display: "standalone",
    // Matches the board's own ground, so the splash hands over to the page
    // it precedes instead of flashing between two worlds.
    background_color: "#07070d",
    // The event brand, painting the OS chrome around the app.
    theme_color: "#07073d",
    categories: ["sports", "fitness"],
    // Four real rasters. The "any" pair keeps the transparent plate; the
    // maskable pair are separate opaque rasters with the mark inside the
    // launcher safe zone, so a circle crop never cuts it or shows voids.
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
