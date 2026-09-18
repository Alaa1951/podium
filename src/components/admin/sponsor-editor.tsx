"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { useUnsavedChanges } from "@/components/app/mobile-runtime";
import { useT } from "@/components/i18n/locale-provider";
import { deleteSponsor, moveSponsor, saveSponsor, setSponsorsEnabled } from "@/lib/actions/sponsors";

// ─────────────────────────────────────────────────────────────────────────────
// THE SPONSOR RAIL, EDITED.
//
// Each competition carries its own ordered set of sponsor marks. The wall
// board and the published results draw ten slots; logos fill them in order and
// empty slots stay visible as placeholders, so this screen manages at most ten
// entries per event and the rail always shows where a sponsor will appear.
// ─────────────────────────────────────────────────────────────────────────────

export type SponsorRow = { id: string; alt: string; position: number };

/** The slot count the wall rail draws — placeholders fill whatever is left. */
const SLOTS = 10;
const MAX_BYTES = 1_000_000;

export function SponsorEditor({
  seriesId,
  sponsors,
  enabled,
}: {
  seriesId: string;
  sponsors: SponsorRow[];
  /** The event-level switch: off, the rail never renders anywhere. */
  enabled: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [alt, setAlt] = useState("");
  const [file, setFile] = useState<{ name: string; dataUrl: string } | null>(null);
  useUnsavedChanges(!!alt || !!file);
  const fileInput = useRef<HTMLInputElement>(null);

  function toggleRail() {
    setMessage("");
    startTransition(async () =>
      report(await setSponsorsEnabled({ seriesId, enabled: !enabled }))
    );
  }

  const taken = new Set(sponsors.map((s) => s.position));
  const freeSlots = Array.from({ length: SLOTS }, (_, i) => i).filter((i) => !taken.has(i));

  function report(result: { ok: boolean; error?: string; message?: string }) {
    if (result.ok) {
      setMessage(result.message ?? "");
      setAlt("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
      return;
    }
    setMessage(
      result.error === "POSITION_TAKEN"
        ? t("That rail position is already taken.")
        : result.error === "TOO_LARGE"
          ? t("That file is too large — keep logos under 1 MB.")
          : result.error === "UNSUPPORTED_TYPE"
            ? t("Logos must be PNG, JPG, WebP or SVG.")
            : t("Check the form and try again.")
    );
  }

  function pick(file: File | undefined) {
    setMessage("");
    if (!file) return;
    if (file.size > MAX_BYTES) {
      report({ ok: false, error: "TOO_LARGE" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setFile({ name: file.name, dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  function add() {
    setMessage("");
    if (!file || !alt.trim() || freeSlots.length === 0) return;
    const position = freeSlots[0];
    startTransition(async () =>
      report(await saveSponsor({ seriesId, alt, position, dataUrl: file.dataUrl }))
    );
  }

  function move(sponsorId: string, direction: "up" | "down") {
    setMessage("");
    startTransition(async () => report(await moveSponsor({ seriesId, sponsorId, direction })));
  }

  function remove(sponsorId: string) {
    setMessage("");
    startTransition(async () => report(await deleteSponsor({ seriesId, sponsorId })));
  }

  const ordered = [...sponsors].sort((a, b) => a.position - b.position);

  return (
    <section style={{ marginBottom: 28, opacity: enabled ? 1 : 0.75 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          {t("Sponsors")}
        </h2>
        <span className="reg-sub">
          {sponsors.length} / {SLOTS} · {t("shown on the wall board and the published results")}
        </span>

        {/* The event-level switch. Logos are managed either way — an event can
            close its rail for now and reopen it with everything still there. */}
        <label
          style={{
            marginInlineStart: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={toggleRail}
            style={{ width: 16, height: 16, accentColor: "var(--bft-cyan)", cursor: "pointer" }}
          />
          {enabled ? t("Sponsor rail on") : t("Sponsor rail off")}
        </label>
      </div>

      {!enabled ? (
        <div className="notice" style={{ marginBottom: 12 }}>
          {t(
            "The rail is switched off for this event — the wall board and published results show only the event branding. Logos below are kept."
          )}
        </div>
      ) : null}

      {message ? (
        <div className="notice" style={{ marginBottom: 12 }}>
          {message}
        </div>
      ) : null}

      {ordered.length === 0 ? (
        <p className="reg-sub" style={{ margin: "0 0 12px" }}>
          {t("No sponsor logos yet — the rail shows placeholders until one is added.")}
        </p>
      ) : (
        <div className="table-scroll" style={{ marginBottom: 14 }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("Rail position")}</th>
                <th>{t("Logo")}</th>
                <th>{t("Name")}</th>
                <th style={{ textAlign: "end" }}>{t("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((sponsor) => (
                <tr key={sponsor.id}>
                  <td className="pd-num">{sponsor.position + 1}</td>
                  <td>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/sponsors/${sponsor.id}/logo`}
                      alt={sponsor.alt}
                      style={{ height: 28, width: "auto", maxWidth: 120, objectFit: "contain" }}
                    />
                  </td>
                  <td>{sponsor.alt}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        disabled={pending || sponsor.position === 0}
                        onClick={() => move(sponsor.id, "up")}
                      >
                        {t("Up")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        disabled={pending || sponsor.position >= SLOTS - 1}
                        onClick={() => move(sponsor.id, "down")}
                      >
                        {t("Down")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={pending}
                        onClick={() => remove(sponsor.id)}
                      >
                        {t("Remove")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The add form — disabled entirely once the rail is full. */}
      <div className="card" style={{ opacity: freeSlots.length === 0 ? 0.55 : 1 }}>
        {freeSlots.length === 0 ? (
          <p className="reg-sub" style={{ margin: 0 }}>
            {t("The rail is full — remove a logo to add another.")}
          </p>
        ) : (
          <div className="form-grid">
            <label>
              <span className="field-label">{t("Sponsor name")}</span>
              <input
                className="input"
                value={alt}
                maxLength={80}
                placeholder={t("Rogue Fitness")}
                onChange={(e) => setAlt(e.target.value)}
              />
            </label>

            <label>
              <span className="field-label">
                {t("Logo file")} · PNG, JPG, WebP, SVG — &lt; 1 MB
              </span>
              <input
                ref={fileInput}
                className="input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(e) => pick(e.target.files?.[0])}
              />
            </label>

            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending || !file || !alt.trim()}
                onClick={add}
              >
                {pending ? <span className="spinner" /> : null}
                {t("Add sponsor")}
              </button>
              {file ? (
                <span className="reg-sub" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Image
                    src={file.dataUrl}
                    alt=""
                    width={0}
                    height={0}
                    sizes="120px"
                    style={{ height: 24, width: "auto", maxWidth: 120 }}
                    unoptimized
                  />
                  {file.name}
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
