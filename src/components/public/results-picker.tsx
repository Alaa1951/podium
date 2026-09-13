"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { CATEGORIES, DIVISIONS } from "@/lib/scoring";

/**
 * PICKING A BOARD.
 *
 * Three questions, asked the way the wall board asks them: which competition,
 * who was competing, at what level. Big targets, because half the people
 * reading this are on a phone with one hand.
 */
export function ResultsPicker({
  competitions,
  initialSeries,
}: {
  competitions: { slug: string; name: string; date: string }[];
  initialSeries: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [series, setSeries] = useState(initialSeries);
  const [category, setCategory] = useState<string>("Mens");
  const [division, setDivision] = useState<string>("Open");

  function show() {
    startTransition(() => router.push(`/results/${series}/${category}/${division}`));
  }

  return (
    <div className="picker">
      <label className="picker-field">
        <span className="picker-label">{t("Competition")}</span>
        <select
          className="picker-select"
          value={series}
          onChange={(e) => setSeries(e.target.value)}
        >
          {competitions.map((one) => (
            <option key={one.slug} value={one.slug}>
              {one.name} — {one.date}
            </option>
          ))}
        </select>
      </label>

      <div className="picker-field">
        <span className="picker-label">{t("Category")}</span>
        <div className="picker-choices">
          {CATEGORIES.map((one) => (
            <button
              key={one}
              type="button"
              className="picker-choice"
              data-on={category === one || undefined}
              onClick={() => setCategory(one)}
            >
              {t(one)}
            </button>
          ))}
        </div>
      </div>

      <div className="picker-field">
        <span className="picker-label">{t("Division")}</span>
        <div className="picker-choices">
          {DIVISIONS.map((one) => (
            <button
              key={one}
              type="button"
              className="picker-choice"
              data-on={division === one || undefined}
              onClick={() => setDivision(one)}
            >
              {t(one)}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="picker-go" onClick={show} disabled={pending}>
        {t("Show results")}
      </button>
    </div>
  );
}
