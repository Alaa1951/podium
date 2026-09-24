"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";

// ─────────────────────────────────────────────────────────────────────────────
// UPLOADING A PORTRAIT.
//
// Two slots, one per seat — either member of a pair may upload for either of
// them, which is what the server enforces too.
//
// THE DISCLOSURE IS NOT DECORATION. The file picker stays disabled until the
// box is ticked, and the tick is sent with the upload and stored with a
// timestamp. Somebody handing over a photograph of their face is told where it
// goes before they can hand it over, and there is no path that creates a job
// without that. If this line is ever edited away, the server still refuses.
//
// The browser downscales before sending. That is for the bill and the network,
// NOT a check: the server decodes and re-encodes whatever arrives.
// ─────────────────────────────────────────────────────────────────────────────

/** What the server is sent. It re-encodes anyway; this keeps the wire small. */
const MAX_EDGE = 1536;

type Job = { id: string; status: "queued" | "running" | "succeeded" | "failed"; failedReason: string | null };
type Seat = {
  competitorId: string;
  position: number;
  fullName: string;
  photoPath: string | null;
  job: Job | null;
};

const ERRORS: Record<string, string> = {
  CONSENT_REQUIRED: "Tick the box first.",
  NOT_FOUND: "That team member could not be found.",
  NO_IMAGE: "Choose a photo.",
  TOO_LARGE: "That photo is too big. Try another.",
  NOT_AN_IMAGE: "That file is not an image.",
  SEAT_LIMIT: "This person has used all their tries.",
  DAILY_CAP: "Too many portraits today. Try again tomorrow.",
  FORBIDDEN: "You cannot do this.",
};

/** Redraw at a sane size before sending. Returns a JPEG blob. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("no blob"))),
      "image/jpeg",
      0.88
    );
  });
}

export function PortraitUpload({ seriesId }: { seriesId: string }) {
  const t = useT();
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/me/portraits?series=${encodeURIComponent(seriesId)}`, { cache: "no-store" });
      if (!response.ok) {
        setSeats([]);
        return;
      }
      const body = (await response.json()) as { seats: Seat[] };
      setSeats(body.seats);
    } catch {
      // A dropped poll is not worth a message; the next one will do.
    }
  }, [seriesId]);

  // The first read. `load` sets state, so it is deliberately called from the
  // effect's own async tail rather than synchronously in its body — the same
  // shape the polling effect below uses.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Poll only while something is actually being worked on.
  const working = seats?.some((seat) => seat.job?.status === "queued" || seat.job?.status === "running");
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [working, load]);

  async function send(seat: Seat, file: File) {
    setError("");
    setBusy(seat.competitorId);
    try {
      // Decoding happens here, before anything is sent. A file that is not an
      // image fails at this line, and blaming the connection for it — which is
      // what the catch below used to do — sends somebody to check their wifi.
      let shrunk: Blob;
      try {
        shrunk = await shrink(file);
      } catch {
        setError(t(ERRORS.NOT_AN_IMAGE));
        return;
      }

      const body = new FormData();
      body.append("seriesId", seriesId);
      body.append("competitorId", seat.competitorId);
      body.append("consent", "true");
      body.append("photo", shrunk, "photo.jpg");

      const response = await fetch(`/api/me/portraits?series=${encodeURIComponent(seriesId)}`, { method: "POST", body });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(t(ERRORS[payload.error ?? ""] ?? "Something went wrong. Try again."));
        return;
      }
      await load();
    } catch {
      setError(t("Could not upload. Check your connection and try again."));
    } finally {
      setBusy(null);
    }
  }

  // The feature is off, or this account is on no team: render nothing at all.
  if (!seats || seats.length === 0) return null;

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <h2 style={{ margin: 0 }}>{t("Competition portraits")}</h2>
      <p className="reg-sub">
        {t("A portrait of each of you for the screens above the rigs.")}
      </p>

      {/* The disclosure. Before the picker, not after it, and the picker does
          not work until it is acknowledged. */}
      <label className="check" style={{ display: "block", margin: "12px 0" }}>
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />{" "}
        {t(
          "I understand the photo is sent to an external AI service (OpenAI) to generate the portrait, and is deleted from PODIUM once the portrait is made."
        )}
      </label>

      <div className="form-row">
        {seats.map((seat) => {
          const status = seat.job?.status;
          const pending = status === "queued" || status === "running" || busy === seat.competitorId;
          return (
            <div key={seat.competitorId} style={{ flex: "1 1 200px", minWidth: 0 }}>
              <div className="field-label">{seat.fullName}</div>
              {seat.photoPath ? (
                /* eslint-disable-next-line @next/next/no-img-element -- one
                   small preview; the optimiser adds a request path to go
                   wrong for no gain. */
                <img
                  src={seat.photoPath}
                  alt=""
                  style={{ width: "100%", aspectRatio: "4 / 5", objectFit: "cover", borderRadius: 6 }}
                />
              ) : null}

              {pending ? (
                <p className="reg-sub" role="status">
                  {t("Making the portrait — this can take a couple of minutes.")}
                </p>
              ) : null}
              {status === "failed" ? (
                <p className="reg-sub">{t("That did not work. Try another photo.")}</p>
              ) : null}

              <input
                ref={(element) => {
                  inputs.current[seat.competitorId] = element;
                }}
                className="input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={!consent || pending}
                style={{ marginTop: 8 }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void send(seat, file);
                }}
              />
            </div>
          );
        })}
      </div>

      {error ? (
        <div className="notice-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}
    </section>
  );
}
