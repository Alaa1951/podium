"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { attachWaiver } from "@/lib/actions/waivers";

// The button of Settings → Waiver (BFT MENA, `waivers.manage`).

const ERRORS: Record<string, string> = {
  ALREADY_ACTIVE: "This version is already the one athletes sign.",
  UNKNOWN_DOCUMENT: "That document is not available.",
  SERIES_FINISHED: "This competition is finished.",
  FORBIDDEN: "You do not have permission to do this.",
};

export function AttachWaiverButton({ seriesId, documentKey, version, label, confirm }: { seriesId: string; documentKey: string; version: number; label: string; confirm: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        data-testid={`attach-${documentKey}-${version}`}
        onClick={() => {
          if (!window.confirm(confirm)) return;
          setError("");
          startTransition(async () => {
            const result = await attachWaiver({ seriesId, documentKey, version });
            if (!result.ok) setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
            router.refresh();
          });
        }}
      >
        {pending ? <span className="spinner" /> : null}
        {label}
      </button>
      {error ? <div className="notice-error" role="alert">{error}</div> : null}
    </div>
  );
}
