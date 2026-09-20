"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { resendSignupCode, startSignup } from "@/lib/actions/signup";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULES_SHORT,
  PASSWORD_RULE_VALUES,
} from "@/lib/password-rules";
import { SHIRT_SIZES, type ShirtSizeValue } from "@/lib/shirt-sizes";

// ─────────────────────────────────────────────────────────────────────────────
// SIGNING UP.
//
// Two kinds of account: an ATHLETE, or an ORGANISER — which covers organisers,
// judges, volunteers, coaches, and a Gym/Studio asking to join. A code goes
// to the email; typing it in proves the address and signs them in, waiting
// for approval. The reply is the same whether or not the address already has
// an account (that one gets an email pointing at sign-in instead).
// ─────────────────────────────────────────────────────────────────────────────

type Kind = "athlete" | "organiser";
type OrganiserRole = "organiser" | "judge" | "volunteer" | "coach" | "gym-studio";

const ORGANISER_ROLES: { key: OrganiserRole; label: string; note: string }[] = [
  { key: "organiser", label: "Organiser", note: "Runs the competition floor." },
  { key: "judge", label: "Judge", note: "Scores teams in a zone." },
  { key: "volunteer", label: "Volunteer", note: "Helps on the day." },
  { key: "coach", label: "Coach", note: "Follows their athletes." },
  { key: "gym-studio", label: "Gym/Studio", note: "A gym or studio joining PODIUM." },
];

const ERRORS: Record<string, string> = {
  ROLE_REQUIRED: "Choose what you do.",
  ATHLETE_DETAILS_REQUIRED: "Fill in your date of birth, sex, level and category.",
  PARTNER_REQUIRED: "Enter your partner's name and email.",
  PARTNER_DETAILS_REQUIRED: "Choose your partner's gender and T-shirt size.",
  SHIRT_SIZE_REQUIRED: "Choose your T-shirt size.",
  TEAM_NAME_REQUIRED: "Enter a team name.",
  GYM_REQUIRED: "Enter the name of your gym or studio.",
  EMAIL_INVALID: "That email does not look right.",
  PARTNER_EMAIL_INVALID: "That partner email does not look right.",
  TOO_MANY: "Too many requests. Wait a few minutes and try again.",
  PASSWORD_TOO_SHORT: "The password needs at least {n} characters.",
  PASSWORD_NEEDS_NUMBER: "The password needs a number.",
  PASSWORD_NEEDS_LOWER: "The password needs a lowercase letter.",
  PASSWORD_NEEDS_UPPER: "The password needs an uppercase letter.",
  EMAIL_SEND_FAILED: "We could not send the email. Try again in a moment.",
  INVALID_INPUT: "Check the details and try again.",
};

export function SignupForm({
  studios,
  initialType,
  initialEmail,
}: {
  studios: { id: string; name: string }[];
  initialType?: Kind;
  initialEmail?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [stage, setStage] = useState<"kind" | "details" | "code">(initialType ? "details" : "kind");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<Kind>(initialType ?? "athlete");
  const [roleKey, setRoleKey] = useState<OrganiserRole>("organiser");
  const [form, setForm] = useState({
    name: "",
    email: initialEmail ?? "",
    phone: "",
    studioId: "",
    password: "",
    dateOfBirth: "",
    sex: "" as "" | "m" | "f",
    division: "" as "" | "Rookie" | "Open" | "Pro",
    category: "" as "" | "Womens" | "Mens" | "Mixed",
    shirtSize: "" as "" | ShirtSizeValue,
    bftMember: false,
    hasPartner: null as boolean | null,
    teamName: "",
    partnerName: "",
    partnerEmail: "",
    partnerPhone: "",
    partnerDateOfBirth: "",
    partnerSex: "" as "" | "m" | "f",
    partnerShirtSize: "" as "" | ShirtSizeValue,
    partnerBftMember: false,
    gymName: "",
    city: "",
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const athlete = kind === "athlete";
  const gym = !athlete && roleKey === "gym-studio";

  function submit() {
    setError("");
    if (athlete && form.hasPartner === null) {
      setError(t("Tell us whether you have a partner."));
      return;
    }
    startTransition(async () => {
      try {
        const result = await startSignup({
          type: kind,
          roleKey: athlete ? undefined : roleKey,
          name: form.name,
          email: form.email,
          phone: form.phone,
          studioId: gym ? undefined : form.studioId || undefined,
          password: athlete ? undefined : form.password,
          ...(athlete
            ? {
                dateOfBirth: form.dateOfBirth,
                sex: form.sex || undefined,
                division: form.division || undefined,
                category: form.category || undefined,
                shirtSize: form.shirtSize || undefined,
                bftMember: form.bftMember,
                hasPartner: Boolean(form.hasPartner),
                teamName: form.teamName,
                partnerName: form.partnerName,
                partnerEmail: form.partnerEmail,
                partnerPhone: form.partnerPhone,
                partnerDateOfBirth: form.partnerDateOfBirth,
                partnerSex: form.partnerSex || undefined,
                partnerShirtSize: form.partnerShirtSize || undefined,
                partnerBftMember: form.partnerBftMember,
              }
            : {}),
          ...(gym ? { gymName: form.gymName, city: form.city } : {}),
        });
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? "Something went wrong. Try again.", PASSWORD_RULE_VALUES));
          return;
        }
        setStage("code");
      } catch {
        setError(t("Could not send. Check your connection and try again."));
      }
    });
  }

  async function verify() {
    setError("");
    setBusy(true);
    const attempt = () => signIn("competitor", { redirect: false, email: form.email, code: code.trim() });
    // A stale CSRF cookie comes back as "success" pointing at ?csrf=true, with
    // no session; the second try carries a fresh token.
    let result = await attempt();
    if (result?.url?.includes("csrf=true")) result = await attempt();
    setBusy(false);
    if (!result || result.error || result.url?.includes("csrf=true")) {
      setError(t("That code is not valid or has expired."));
      return;
    }
    router.replace(athlete ? "/me" : "/home");
    router.refresh();
  }

  function resend() {
    setError("");
    setNote("");
    startTransition(async () => {
      const result = await resendSignupCode({ email: form.email });
      if (!result.ok) setError(t(ERRORS[result.error] ?? "Something went wrong. Try again.", PASSWORD_RULE_VALUES));
      else setNote(t("A new code is on its way."));
    });
  }

  if (stage === "kind") {
    return (
      <div>
        <p className="auth-sub">{t("What are you signing up as?")}</p>
        <div className="signup-choices">
          <button type="button" className="signup-choice" data-active={kind === "athlete" || undefined} onClick={() => setKind("athlete")}>
            <strong>{t("Athlete")}</strong>
            <span>{t("I compete in PODIUM.")}</span>
          </button>
          <button type="button" className="signup-choice" data-active={kind === "organiser" || undefined} onClick={() => setKind("organiser")}>
            <strong>{t("Organiser")}</strong>
            <span>{t("I organise, judge, volunteer or coach — or I represent a gym or studio.")}</span>
          </button>
        </div>

        {kind === "organiser" ? (
          <>
            <p className="auth-sub" style={{ marginTop: 16 }}>
              {t("What do you do?")}
            </p>
            <div className="signup-choices">
              {ORGANISER_ROLES.map((role) => (
                <button
                  key={role.key}
                  type="button"
                  className="signup-choice signup-choice-sm"
                  data-active={roleKey === role.key || undefined}
                  onClick={() => setRoleKey(role.key)}
                >
                  <strong>{t(role.label)}</strong>
                  <span>{t(role.note)}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        <button type="button" className="btn btn-block btn-primary" style={{ marginTop: 18 }} onClick={() => setStage("details")}>
          {t("Continue")}
        </button>
        <p className="auth-note">
          {t("Already have an account?")}{" "}
          <Link href="/login" style={{ color: "var(--bft-cyan)" }}>
            {t("Sign in")}
          </Link>
        </p>
      </div>
    );
  }

  if (stage === "code") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void verify();
        }}
      >
        <h2 className="auth-title">{t("Check your email")}</h2>
        <p className="auth-sub">{t("We sent a six-digit code to {email}. Type it in to confirm your address.", { email: form.email })}</p>
        {error ? (
          <div className="notice-error" role="alert" style={{ marginBottom: 14 }}>
            {error}
          </div>
        ) : null}
        {note ? (
          <p className="auth-note" role="status">
            {note}
          </p>
        ) : null}
        <label style={{ display: "block" }}>
          <span className="field-label-dark">{t("Verification code")}</span>
          <input
            className="input otp-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
            autoFocus
          />
        </label>
        <button type="submit" className="btn btn-block btn-primary" disabled={busy || code.length !== 6} style={{ marginTop: 16 }}>
          {busy ? <span className="spinner" /> : null}
          {t("Confirm")}
        </button>
        <button type="button" className="btn btn-block btn-ghost" onClick={resend} disabled={busy || pending} style={{ marginTop: 8 }}>
          {t("Send the code again")}
        </button>
        <p className="auth-note">{t("After this you can sign in straight away. BFT MENA or your studio approves your account.")}</p>
      </form>
    );
  }

  const field = (label: string, input: ReactNode, hint?: string) => (
    <label className="signup-field">
      <span className="field-label-dark">{label}</span>
      {input}
      {hint ? <span className="signup-hint">{hint}</span> : null}
    </label>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="auth-sub">
        {athlete
          ? t("Signing up as an athlete.")
          : t("Signing up as: {role}", { role: t(ORGANISER_ROLES.find((role) => role.key === roleKey)?.label ?? "Organiser") })}{" "}
        <button type="button" className="linkish" onClick={() => setStage("kind")} style={{ color: "var(--bft-cyan)" }}>
          {t("Change")}
        </button>
      </p>

      {field(t("Full name"), <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" required minLength={2} maxLength={120} />)}
      {field(t("Email"), <input className="input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" required maxLength={200} />)}
      {field(t("Phone"), <input className="input" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" required minLength={6} maxLength={30} />)}

      {gym ? (
        <>
          {field(t("Gym or studio name"), <input className="input" value={form.gymName} onChange={(e) => set("gymName", e.target.value)} required maxLength={120} />)}
          {field(t("City"), <input className="input" value={form.city} onChange={(e) => set("city", e.target.value)} maxLength={80} />)}
        </>
      ) : (
        field(
          t("Your gym or studio"),
          <select className="input" value={form.studioId} onChange={(e) => set("studioId", e.target.value)}>
            <option value="">{t("None")}</option>
            {studios.map((studio) => (
              <option key={studio.id} value={studio.id}>
                {studio.name}
              </option>
            ))}
          </select>,
          t("Your studio can approve you. Without one, BFT MENA does.")
        )
      )}

      {!athlete
        ? field(
            t("Password"),
            <input className="input" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} maxLength={200} />,
            t(PASSWORD_RULES_SHORT, PASSWORD_RULE_VALUES)
          )
        : null}

      {athlete ? (
        <>
          <div className="signup-row">
            {field(t("Date of birth"), <input className="input" type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} required />)}
            {field(
              t("Gender"),
              <select className="input" value={form.sex} onChange={(e) => set("sex", e.target.value as typeof form.sex)} required>
                <option value="">—</option>
                <option value="f">{t("Female")}</option>
                <option value="m">{t("Male")}</option>
              </select>
            )}
          </div>
          <div className="signup-row">
            {field(
              t("Level"),
              <select className="input" value={form.division} onChange={(e) => set("division", e.target.value as typeof form.division)} required>
                <option value="">—</option>
                <option value="Rookie">{t("Rookie")}</option>
                <option value="Open">{t("Open")}</option>
                <option value="Pro">{t("Pro")}</option>
              </select>
            )}
            {field(
              t("Category"),
              <select className="input" value={form.category} onChange={(e) => set("category", e.target.value as typeof form.category)} required>
                <option value="">—</option>
                <option value="Womens">{t("Womens")}</option>
                <option value="Mens">{t("Mens")}</option>
                <option value="Mixed">{t("Mixed")}</option>
              </select>
            )}
          </div>
          <div className="signup-row">
            {field(
              t("T-shirt size"),
              <select className="input" value={form.shirtSize} onChange={(e) => set("shirtSize", e.target.value as typeof form.shirtSize)} required>
                <option value="">—</option>
                {SHIRT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            )}
          </div>
          <label className="checkline" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={form.bftMember} onChange={(e) => set("bftMember", e.target.checked)} />
            <span>{t("I am a BFT member")}</span>
          </label>

          <p className="auth-sub" style={{ marginTop: 14, marginBottom: 8 }}>
            {t("Do you have a partner?")}
          </p>
          <div className="signup-choices signup-choices-row">
            <button type="button" className="signup-choice signup-choice-sm" data-active={form.hasPartner === true || undefined} onClick={() => set("hasPartner", true)}>
              <strong>{t("Yes")}</strong>
            </button>
            <button type="button" className="signup-choice signup-choice-sm" data-active={form.hasPartner === false || undefined} onClick={() => set("hasPartner", false)}>
              <strong>{t("No — looking for a partner")}</strong>
            </button>
          </div>
          {form.hasPartner ? (
            <>
              {field(
                t("Team name"),
                <input className="input" value={form.teamName} onChange={(e) => set("teamName", e.target.value)} required maxLength={120} />,
                t("What the two of you compete as.")
              )}
              {field(t("Partner's name"), <input className="input" value={form.partnerName} onChange={(e) => set("partnerName", e.target.value)} required maxLength={120} />)}
              {field(
                t("Partner's email"),
                <input className="input" type="email" value={form.partnerEmail} onChange={(e) => set("partnerEmail", e.target.value)} required maxLength={200} />,
                t("If they are not on PODIUM yet, we invite them. You are linked once they sign up.")
              )}
              <div className="signup-row">
                {field(t("Partner's phone"), <input className="input" type="tel" value={form.partnerPhone} onChange={(e) => set("partnerPhone", e.target.value)} maxLength={30} />)}
                {field(t("Partner's date of birth"), <input className="input" type="date" value={form.partnerDateOfBirth} onChange={(e) => set("partnerDateOfBirth", e.target.value)} />)}
              </div>
              <div className="signup-row">
                {field(
                  t("Partner's gender"),
                  <select className="input" value={form.partnerSex} onChange={(e) => set("partnerSex", e.target.value as typeof form.partnerSex)} required>
                    <option value="">—</option>
                    <option value="f">{t("Female")}</option>
                    <option value="m">{t("Male")}</option>
                  </select>
                )}
                {field(
                  t("Partner's T-shirt size"),
                  <select className="input" value={form.partnerShirtSize} onChange={(e) => set("partnerShirtSize", e.target.value as typeof form.partnerShirtSize)} required>
                    <option value="">—</option>
                    {SHIRT_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <label className="checkline">
                <input type="checkbox" checked={form.partnerBftMember} onChange={(e) => set("partnerBftMember", e.target.checked)} />
                <span>{t("My partner is a BFT member")}</span>
              </label>
            </>
          ) : form.hasPartner === false ? (
            <p className="signup-hint">{t("We match you with athletes at the same level and category. Your studio can pair you into a team.")}</p>
          ) : null}
        </>
      ) : null}

      {error ? (
        <div className="notice-error" role="alert" style={{ marginTop: 14 }}>
          {error}
        </div>
      ) : null}

      <button type="submit" className="btn btn-block btn-primary" disabled={pending} style={{ marginTop: 18 }}>
        {pending ? <span className="spinner" /> : null}
        {t("Send me a code")}
      </button>
      <p className="auth-note">
        {t("Already have an account?")}{" "}
        <Link href={athlete ? "/athlete" : "/login"} style={{ color: "var(--bft-cyan)" }}>
          {t("Sign in")}
        </Link>
      </p>
    </form>
  );
}
