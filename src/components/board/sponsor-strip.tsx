"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";

/**
 * THE SPONSOR STRIP — the last band on the wall screen, drawn straight from the
 * approved reference: an "official partners" label, a rail of ten marks where
 * one is spotlighted at a time, and the program mark closing the row.
 *
 * The slots are always drawn, empty as dashed placeholders, so the wall shows
 * sponsors where they will live before anybody has uploaded anything — a logo
 * only needs handing to this component to appear in the rotation.
 */

/** Seconds one sponsor holds the spotlight. Short enough that the rail always
 *  looks alive; the transition itself is a 0.7s slide. */
const SPOTLIGHT_SECONDS = 6;

export function SponsorStrip({
  enabled,
  logos = [],
}: {
  /** The event-level switch. Off: no rail at all — brand-only screens. */
  enabled: boolean;
  /** Uploaded sponsor marks, shown in order; the rest stay placeholders. */
  logos?: { src: string; alt: string }[];
}) {
  const t = useT();
  const count = Math.max(logos.length, 10);
  const [spot, setSpot] = useState(0);

  useEffect(() => {
    if (count <= 1) return;
    const id = setInterval(() => setSpot((x) => (x + 1) % count), SPOTLIGHT_SECONDS * 1000);
    return () => clearInterval(id);
  }, [count]);

  if (!enabled) return null;

  return (
    <div className="sponsor-bar">
      <div className="sponsor-bar-label">{t("Official partners")}</div>

      <div className="sponsor-track">
        <div
          className="sponsor-rail"
          style={{ transform: `translateX(${-(spot * 188 + 85)}px)` }}
        >
          {Array.from({ length: count }, (_, i) => {
            const logo = logos[i];
            return (
              <div key={i} className="sponsor-slot" data-on={i === spot || undefined}>
                {logo ? (
                  <Image
                    src={logo.src}
                    alt={logo.alt}
                    width={170}
                    height={56}
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                ) : (
                  <span className="sponsor-placeholder">
                    {t("Sponsor")} {i + 1}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sponsor-bar-label" style={{ letterSpacing: "0.3em", opacity: 0.8 }}>
        {t("Powered by BFT MENA")}
      </div>
    </div>
  );
}
