"use client";

import { useT } from "@/components/i18n/locale-provider";

export function RouteLoading() {
  const t = useT();
  return <div className="screen route-loading" data-route-loading role="status" aria-live="polite" aria-busy="true">
    <p>{t("Loading")}</p>
    <div className="route-loading-lines" aria-hidden="true"><i /><i /><i /></div>
  </div>;
}
