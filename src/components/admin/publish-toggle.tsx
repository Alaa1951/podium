"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { setSeriesPublished } from "@/lib/actions/series";

/**
 * THE PUBLIC SWITCH.
 *
 * One question, answered on the results screen where it is asked: is this
 * finished competition open to everyone at /results, or only to the people
 * who competed in it? Saving is immediate — publishing is a decision, not a
 * form field — and when it is open, the link out is right here.
 */
export function PublishToggle({
  seriesId,
  published,
  publicUrl,
}: {
  seriesId: string;
  /** Whether the results are on the public site right now. */
  published: boolean;
  /** Where the public leaderboard lives, for the link out. */
  publicUrl: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function toggle() {
    setMessage("");
    startTransition(async () => {
      const result = await setSeriesPublished({ seriesId, published: !published });
      if (result.ok) {
        setMessage(result.message ?? "");
        router.refresh();
      } else {
        setMessage(t("Something went wrong. Try again."));
      }
    });
  }

  return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={published}
          disabled={pending}
          onChange={toggle}
          style={{ width: 18, height: 18, accentColor: "var(--bft-cyan)", cursor: "pointer" }}
        />
        <span>
          <strong>{t("Published to the public results")}</strong>
          <span className="reg-sub" style={{ display: "block", marginTop: 2 }}>
            {published
              ? t("Anyone can open these results at /results — no sign-in.")
              : t("Off — the results stay private to BFT MENA and the competitors, even though the event is finished.")}
          </span>
        </span>
      </label>

      {message ? (
        <span className="reg-sub" style={{ maxWidth: 260 }}>
          {message}
        </span>
      ) : null}

      {published ? (
        <Link
          href={publicUrl}
          className="btn btn-cyan-outline push"
          target="_blank"
          style={{ textDecoration: "none" }}
        >
          {t("Open the public page")}
        </Link>
      ) : null}
    </div>
  );
}
