"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { createRegistration } from "@/lib/actions/registrations";
import { PersonBlock, Field } from "@/components/admin/registration-fields";

// ─────────────────────────────────────────────────────────────────────────────
// TAKING A REGISTRATION IN.
//
// The fields are the CRM registration form's fields, in its order: category,
// division, the registering competitor, then their partner, each with a phone,
// an email, a date of birth and whether they hold a BFT studio membership.
//
// When the GHL integration lands it will write the same record through the same
// action, so this stays the fallback — the walk-up at the door, the correction
// — rather than becoming a second way in with rules of its own.
// ─────────────────────────────────────────────────────────────────────────────

export type Person = {
  fullName: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  studioId: string;
};

const EMPTY: Person = { fullName: "", phone: "", email: "", dateOfBirth: "", studioId: "" };

export function RegistrationForm({
  seriesId,
  studios,
  defaultAmount,
  currency,
}: {
  seriesId: string;
  studios: { id: string; name: string }[];
  defaultAmount: string;
  currency: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [teamName, setTeamName] = useState("");
  const [category, setCategory] = useState<"Womens" | "Mens" | "Mixed">("Womens");
  const [division, setDivision] = useState<"Rookie" | "Open" | "Pro">("Rookie");
  const [one, setOne] = useState<Person>(EMPTY);
  const [two, setTwo] = useState<Person>(EMPTY);

  const [paid, setPaid] = useState(true);
  const [amount, setAmount] = useState(defaultAmount);
  const [billingNumber, setBillingNumber] = useState("");
  const [paymentNote, setPaymentNote] = useState("");

  // What the board will actually call them, shown while they type — the rule
  // is invisible otherwise, and the first thing somebody asks about.
  const effectiveName = (teamName.trim() || one.fullName.trim() || "—").toUpperCase();

  function submit() {
    setError("");
    startTransition(async () => {
      const result = await createRegistration({
        seriesId,
        teamName: teamName.trim() || null,
        category,
        division,
        one: { ...one, studioId: one.studioId || null },
        two: { ...two, studioId: two.studioId || null },
        paymentStatus: paid ? "paid" : "pending",
        amount: paid ? amount : null,
        currency,
        billingNumber: billingNumber || null,
        paymentNote: paymentNote || null,
      });

      if (!result.ok) {
        setError(
          result.error === "INVALID_INPUT"
            ? t("Check the form — both competitors need a name, and any email must be valid.")
            : t("Something went wrong. Try again.")
        );
        return;
      }

      router.push("../");
      router.refresh();
    });
  }

  return (
    <div style={{ maxWidth: 840 }}>
      {error ? (
        <div className="notice-error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </div>
      ) : null}

      {/* ── The entry ──────────────────────────────────────────────────── */}
      <section className="form-block">
        <h2 className="section-title">{t("The entry")}</h2>

        <div className="form-row">
          <Field label={t("Team name")} hint={t("Optional — they compete as {name}", { name: effectiveName })}>
            <input
              className="input"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder={t("left blank, takes the first competitor's name")}
            />
          </Field>
        </div>

        <div className="form-row">
          <Field label={t("Category")} hint={t("who is competing")}>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
            >
              <option value="Womens">{t("Womens")}</option>
              <option value="Mens">{t("Mens")}</option>
              <option value="Mixed">{t("Mixed")}</option>
            </select>
          </Field>

          <Field label={t("Division")} hint={t("the level they compete at")}>
            <select
              className="input"
              value={division}
              onChange={(e) => setDivision(e.target.value as typeof division)}
            >
              <option value="Rookie">{t("Rookie")}</option>
              <option value="Open">{t("Open")}</option>
              <option value="Pro">{t("Pro")}</option>
            </select>
          </Field>
        </div>
      </section>

      <PersonBlock
        title={t("Competitor 1")}
        note={t("The person who registered. Their studio owns the entry.")}
        person={one}
        onChange={setOne}
        studios={studios}
      />

      <PersonBlock
        title={t("Competitor 2")}
        note={t("Their partner. May be a member of a different studio, or of none.")}
        person={two}
        onChange={setTwo}
        studios={studios}
      />

      {/* ── The money ──────────────────────────────────────────────────── */}
      <section className="form-block">
        <h2 className="section-title">{t("Payment")}</h2>
        <p className="reg-sub" style={{ marginTop: 4 }}>
          {t("Only a paid registration appears on the board. Everything else still counts it.")}
        </p>

        <div className="form-row" style={{ marginTop: 10 }}>
          <label className="checkline">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            <span>{t("Payment confirmed")}</span>
          </label>
        </div>

        {paid ? (
          <div className="form-row">
            <Field label={`${t("Amount")} (${currency})`}>
              <input
                className="input pd-num"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
            </Field>
            <Field label={t("Invoice number")} hint={t("optional")}>
              <input
                className="input"
                value={billingNumber}
                onChange={(e) => setBillingNumber(e.target.value)}
              />
            </Field>
            <Field label={t("Note")} hint={t("cash at the door, card, transfer…")}>
              <input
                className="input"
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </section>

      <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={pending || one.fullName.trim().length < 2 || two.fullName.trim().length < 2}
        >
          {pending ? <span className="spinner" /> : null}
          {t("Register this pair")}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => router.back()}
          disabled={pending}
        >
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}
