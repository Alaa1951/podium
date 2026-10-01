"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { WaiverAcknowledgement } from "@/components/waivers/waiver-document";
import { signMyWaiver } from "@/lib/actions/waivers";
import type { Inline } from "@/lib/waivers/document";

// ─────────────────────────────────────────────────────────────────────────────
// "AGREE & SIGN" — below the document, in the language of the edition being
// signed: the document's own mandatory acknowledgement, a box that starts
// unticked, and the athlete's full name typed by them (never filled in). The
// server checks all of it again, for the signed-in account only, and this
// says "signed" only once it has been saved.
// ─────────────────────────────────────────────────────────────────────────────

const ERRORS: Record<string, string> = {
  ACKNOWLEDGEMENT_REQUIRED: "Tick the box to confirm you have read and agree to the waiver.",
  NAME_REQUIRED: "Type your full name to sign.",
  NAME_TOO_LONG: "That name is too long.",
  STALE_VERSION: "A newer version of this waiver was published. Review the current version, then sign it.",
  NOT_REGISTERED: "You are not registered in this competition.",
  AMBIGUOUS_REGISTRATION: "You hold more than one place in this competition. Ask BFT MENA to correct it before signing.",
  NO_WAIVER: "This competition no longer asks for a waiver.",
  FORBIDDEN: "Only the athlete can sign their own waiver.",
  UNAUTHENTICATED: "You are signed out. Sign in and try again.",
};

export function SignPanel({ seriesId, releaseId, language, dir, text, ack }: {
  seriesId: string;
  releaseId: string;
  language: "en" | "ar";
  dir: "ltr" | "rtl";
  /** The edition's own words for the controls. */
  text: { acknowledgement: string; nameLabel: string; helper: string; button: string };
  ack: { title: string; paragraphs: Inline[] } | null;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);

  function sign() {
    setError("");
    startTransition(async () => {
      try {
        const result = await signMyWaiver({ seriesId, releaseId, language, typedName: name, agreed });
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
          if (result.error === "STALE_VERSION") router.refresh();
          return;
        }
        setReceipt(result.acceptanceId);
        // The page itself says "signed" from here on, with the receipt — this
        // panel is gone once the athlete no longer needs to sign.
        router.replace(`/waivers?series=${encodeURIComponent(seriesId)}&lang=${language}&signed=${encodeURIComponent(result.acceptanceId)}`);
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  if (receipt) {
    return (
      <div className="card waiver-signed" role="status" data-testid="waiver-signed">
        <strong>{t("Signed. Your waiver is saved.")}</strong>
        <Link href={`/waivers/receipt/${receipt}`} className="btn btn-secondary">{t("View receipt")}</Link>
      </div>
    );
  }

  return (
    <section className="card waiver-sign" lang={language} dir={dir} data-testid="waiver-sign">
      {ack ? <WaiverAcknowledgement title={ack.title} paragraphs={ack.paragraphs} /> : null}
      <label className="waiver-check">
        <input type="checkbox" checked={agreed} disabled={pending} onChange={(event) => setAgreed(event.target.checked)} data-testid="waiver-agree" />
        <span>{text.acknowledgement}</span>
      </label>
      <label className="waiver-name">
        <span className="field-label">{text.nameLabel}</span>
        <input
          className="input waiver-signature"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          dir="auto"
          data-testid="waiver-name"
        />
      </label>
      <p className="field-note" style={{ margin: 0 }}>{text.helper}</p>
      {error ? <div className="notice-error" role="alert" data-testid="waiver-error">{error}</div> : null}
      <button type="button" className="btn btn-primary" disabled={pending || !agreed || !name.trim()} onClick={sign} data-testid="waiver-submit">
        {pending ? <span className="spinner" /> : null}
        {text.button}
      </button>
    </section>
  );
}
