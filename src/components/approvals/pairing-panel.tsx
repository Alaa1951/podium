"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { pairAthletes } from "@/lib/actions/pairing";

// ─────────────────────────────────────────────────────────────────────────────
// PAIR TWO ATHLETES INTO A TEAM.
//
// The studio picks a competition and two of its approved athletes. Athletes
// looking for a partner come first, and once the first is picked the second
// list puts the same level and category on top — the matching is a
// suggestion, never a rule.
// ─────────────────────────────────────────────────────────────────────────────

export type PairableAthlete = {
  entries?: { seriesId: string; division: string | null; category: string | null; lookingForPartner: boolean; partnerId: string | null }[];
  id: string;
  /** Already falls back to the address server-side when there is no name. */
  name: string;
  division: string | null;
  category: string | null;
  sex: string | null;
  lookingForPartner: boolean;
  partnerId: string | null;
};

const ERRORS: Record<string, string> = {
  SAME_ATHLETE: "Pick two different athletes.",
  NOT_FOUND: "That athlete or competition is no longer available.",
  HAS_OTHER_PARTNER: "One of them is already partnered with someone else.",
  ALREADY_ENTERED: "One of them is already entered in this competition.",
  REGISTRATION_CLOSED: "Registration for this competition is closed.",
  MIXED_LEVELS: "These two compete at different levels.",
  LEVEL_MISMATCH: "That level is not the one these two compete at.",
  CATEGORY_MISMATCH: "That category does not match who these two are.",
  FORBIDDEN: "You are not allowed to do that.",
  INVALID_INPUT: "Check the details and try again.",
};

const CATEGORY_FOR = (a?: string | null, b?: string | null) =>
  a && b ? (a === b ? (a === "f" ? "Womens" : "Mens") : "Mixed") : null;

export function PairingPanel({
  athletes: accountAthletes,
  competitions,
}: {
  athletes: PairableAthlete[];
  competitions: { id: string; name: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [seriesId, setSeriesId] = useState(competitions[0]?.id ?? "");
  const [firstId, setFirstId] = useState("");
  const [secondId, setSecondId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [division, setDivision] = useState("");
  const [category, setCategory] = useState("");

  // Narrowing the list of people to choose from. Local rather than in the URL,
  // unlike the roster filters: everything else in this panel is form state,
  // and a router.replace on every keystroke would throw it away.
  const [search, setSearch] = useState("");
  const [onlyLooking, setOnlyLooking] = useState(true);
  const [filterLevel, setFilterLevel] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  const athletes = useMemo(() => accountAthletes.map(a => { const entry = a.entries?.find(p => p.seriesId === seriesId); return entry ? { ...a, ...entry } : a; }), [accountAthletes, seriesId]);

  const first = athletes.find((athlete) => athlete.id === firstId) ?? null;
  const second = athletes.find((athlete) => athlete.id === secondId) ?? null;

  const label = (athlete: PairableAthlete) =>
    `${athlete.name} · ${[athlete.division, athlete.category].filter(Boolean).map((value) => t(value!)).join(" · ") || "—"}${
      athlete.lookingForPartner ? ` · ${t("looking")}` : ""
    }`;

  // A filter, not just a sort. Five hundred names in a dropdown is not a list
  // anybody can use; the default narrows to the people this panel exists for.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return athletes.filter((athlete) => {
      if (onlyLooking && !athlete.lookingForPartner) return false;
      if (filterLevel && athlete.division !== filterLevel) return false;
      if (filterCategory && athlete.category !== filterCategory) return false;
      if (needle && !athlete.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [athletes, onlyLooking, filterLevel, filterCategory, search]);

  const firstList = useMemo(
    () => [...visible].sort((a, b) => Number(b.lookingForPartner) - Number(a.lookingForPartner)),
    [visible]
  );
  const secondList = useMemo(() => {
    if (!first) return firstList;
    const score = (athlete: PairableAthlete) =>
      (athlete.id === first.partnerId ? 8 : 0) +
      (athlete.lookingForPartner ? 4 : 0) +
      (athlete.division === first.division ? 2 : 0) +
      (athlete.category === first.category ? 1 : 0);
    // Whoever is already chosen stays reachable even if the filter would now
    // hide them — the form must never refer to somebody it cannot show.
    const pool = second && !firstList.some((one) => one.id === second.id) ? [...firstList, second] : firstList;
    return pool.filter((athlete) => athlete.id !== first.id).sort((a, b) => score(b) - score(a));
  }, [first, second, firstList]);

  function pickFirst(id: string) {
    setFirstId(id);
    const athlete = athletes.find((one) => one.id === id);
    if (athlete?.division) setDivision(athlete.division);
    if (athlete?.category) setCategory(athlete.category);
    // Once the first is chosen, the list for the second narrows to their own
    // bracket — that is the pair that can actually be entered.
    if (athlete?.division) setFilterLevel(athlete.division);
    if (athlete?.partnerId && athletes.some((one) => one.id === athlete.partnerId)) setSecondId(athlete.partnerId);
  }

  /** Back to every athlete: a filter must never hide a legitimate pairing. */
  function showEveryone() {
    setSearch("");
    setOnlyLooking(false);
    setFilterLevel("");
    setFilterCategory("");
  }

  function pickSecond(id: string) {
    setSecondId(id);
    const other = athletes.find((one) => one.id === id);
    const derived = CATEGORY_FOR(first?.sex, other?.sex);
    if (derived) setCategory(derived);
  }

  function submit() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const result = await pairAthletes({
          seriesId,
          athleteIds: [firstId, secondId],
          teamName: teamName.trim() || undefined,
          division,
          category,
        });
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
          return;
        }
        setMessage(result.message ?? t("Saved."));
        setFirstId("");
        setSecondId("");
        setTeamName("");
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  if (competitions.length === 0) {
    return <p className="reg-sub">{t("No competition of yours is open for registration.")}</p>;
  }
  if (athletes.length < 2) {
    return <p className="reg-sub">{t("You need two approved athletes to make a team.")}</p>;
  }

  return (
    <section className="card">
      <div className="form-row" style={{ alignItems: "flex-end" }}>
        <label style={{ flex: "1 1 200px" }}>
          <span className="field-label">{t("Competition")}</span>
          <select className="input" value={seriesId} disabled={pending} onChange={(e) => { setSeriesId(e.target.value); setFirstId(""); setSecondId(""); setDivision(""); setCategory(""); setTeamName(""); }}>
            {competitions.map((series) => (
              <option key={series.id} value={series.id}>
                {series.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: "1 1 100%" }}>
          <span className="field-label">{t("Narrow the list")}</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Search by name…")}
              maxLength={80}
              style={{ flex: "1 1 180px" }}
            />
            <select
              className="input"
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              style={{ flex: "0 1 140px" }}
            >
              <option value="">{t("Any level")}</option>
              {["Rookie", "Open", "Pro"].map((level) => (
                <option key={level} value={level}>
                  {t(level)}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              style={{ flex: "0 1 140px" }}
            >
              <option value="">{t("Any category")}</option>
              {["Womens", "Mens", "Mixed"].map((one) => (
                <option key={one} value={one}>
                  {t(one)}
                </option>
              ))}
            </select>
            <label className="checkline" style={{ flex: "0 0 auto" }}>
              <input
                type="checkbox"
                checked={onlyLooking}
                onChange={(e) => setOnlyLooking(e.target.checked)}
              />
              <span>{t("Looking only")}</span>
            </label>
            <button type="button" className="btn btn-secondary btn-sm" onClick={showEveryone}>
              {t("Show everyone")}
            </button>
          </div>
          <span className="reg-sub" style={{ display: "block", marginTop: 6 }}>
            {t("{shown} of {total}", { shown: visible.length, total: athletes.length })}
            {athletes.length === 500 ? ` · ${t("first 500")}` : ""}
          </span>
        </label>
        <label style={{ flex: "1 1 200px" }}>
          <span className="field-label">{t("Athlete 1")}</span>
          <select className="input" value={firstId} disabled={pending} onChange={(e) => pickFirst(e.target.value)}>
            <option value="">{t("Choose a person…")}</option>
            {firstList.map((athlete) => (
              <option key={athlete.id} value={athlete.id}>
                {label(athlete)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: "1 1 200px" }}>
          <span className="field-label">{t("Athlete 2")}</span>
          <select className="input" value={secondId} disabled={pending || !firstId} onChange={(e) => pickSecond(e.target.value)}>
            <option value="">{t("Choose a person…")}</option>
            {secondList.map((athlete) => (
              <option key={athlete.id} value={athlete.id}>
                {label(athlete)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row" style={{ alignItems: "flex-end", marginTop: 10 }}>
        <label style={{ flex: "2 1 200px" }}>
          <span className="field-label">{t("Team name (optional)")}</span>
          <input className="input" value={teamName} maxLength={80} disabled={pending} onChange={(e) => setTeamName(e.target.value)} />
        </label>
        <label style={{ flex: "1 1 120px" }}>
          <span className="field-label">{t("Level")}</span>
          <select className="input" value={division} disabled={pending} onChange={(e) => setDivision(e.target.value)}>
            <option value="">—</option>
            {["Rookie", "Open", "Pro"].map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: "1 1 120px" }}>
          <span className="field-label">{t("Category")}</span>
          <select className="input" value={category} disabled={pending} onChange={(e) => setCategory(e.target.value)}>
            <option value="">—</option>
            {["Womens", "Mens", "Mixed"].map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || !seriesId || !firstId || !secondId || !division || !category}
          onClick={submit}
        >
          {t("Enter as a team")}
        </button>
      </div>
      {first && second && first.division && second.division && first.division !== second.division ? (
        <p className="perm-lock" style={{ marginTop: 8 }}>
          {t("These two are at different levels.")}
        </p>
      ) : null}
      {error ? (
        <div className="notice-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}
      {message ? (
        <p className="reg-sub" role="status" style={{ marginTop: 10 }}>
          {message}
        </p>
      ) : null}
    </section>
  );
}
