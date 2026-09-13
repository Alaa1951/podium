"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { archiveSeries, restoreSeries } from "@/lib/actions/series";

/**
 * The two ends of a competition's removal:
 *
 *  - ArchiveSeriesButton sits in a scheduled event's settings: archive a
 *    mistake, and it drops off the series list while staying restorable.
 *  - ArchivedSeriesStrip sits at the bottom of the series list, listing what
 *    has been archived with a restore for each.
 *
 * A live event is locked and a finished one is the record — the server refuses
 * both, whatever this button says.
 */
export function ArchiveSeriesButton({ seriesId }: { seriesId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");

  function archive() {
    setMessage("");
    startTransition(async () => {
      const result = await archiveSeries({ seriesId });
      if (!result.ok) {
        setMessage(
          result.error === "EVENT_RUNNING"
            ? t("The event is running — nothing can be removed from it right now.")
            : result.error === "EVENT_FINISHED"
              ? t("A finished competition is part of the record and cannot be removed.")
              : t("Something went wrong. Try again.")
        );
        return;
      }
      router.push("/series");
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <div>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending}
          onClick={() => setConfirming(true)}
          style={{ color: "var(--status-danger-text)" }}
        >
          {t("Archive this competition")}
        </button>
        {message ? <div className="reg-sub" style={{ marginTop: 6 }}>{message}</div> : null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span className="reg-sub">{t("Archive it? It leaves the list but stays restorable.")}</span>
      <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={archive}>
        {pending ? <span className="spinner" /> : null}
        {t("Archive")}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        {t("Keep it")}
      </button>
    </div>
  );
}

export function ArchivedSeriesStrip({
  archived,
}: {
  archived: { id: string; name: string; slug: string; archivedAt: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function restore(seriesId: string) {
    startTransition(async () => {
      await restoreSeries({ seriesId });
      router.refresh();
    });
  }

  if (archived.length === 0) return null;

  return (
    <div style={{ marginTop: 30 }}>
      <button
        type="button"
        className="linkish"
        style={{ fontSize: 13 }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? t("Hide archived") : t("Archived competitions ({n})", { n: archived.length })}
      </button>

      {open ? (
        <div className="table-scroll" style={{ marginTop: 10 }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("Name")}</th>
                <th>{t("Archived")}</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {archived.map((one) => (
                <tr key={one.id}>
                  <td>{one.name}</td>
                  <td className="pd-num">{one.archivedAt}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      disabled={pending}
                      onClick={() => restore(one.id)}
                    >
                      {t("Restore")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
