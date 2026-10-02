"use client";

import { SearchBox } from "@/components/app/search-box";
import { useServerSearch } from "@/components/app/use-server-search";
import { useT } from "@/components/i18n/locale-provider";

export function PartnerSearch({ query, shown, total }: { query: string; shown: number; total: number }) {
  const t = useT();
  const { text, setText, pending } = useServerSearch(query);
  return <div className="mobile-search-toolbar">
    <SearchBox value={text} onChange={setText} pending={pending} shown={shown} total={total}
      placeholder={t("Search by name…")} label={t("Search")} maxLength={80} />
  </div>;
}
