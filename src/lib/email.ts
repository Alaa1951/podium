import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

const BRAND = "PODIUM";

type MailPayload = { to: string; subject: string; text: string; html: string };

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

let cachedTransport: Transporter | null = null;
let cachedKey = "";

function resolveSmtpConfig(): SmtpConfig {
  const host = (process.env.SMTP_HOST || "").trim();
  const user = (process.env.SMTP_USER || "").trim();
  const pass = process.env.SMTP_PASSWORD || "";
  const port = Number(process.env.SMTP_PORT || 465);
  const secureEnv = (process.env.SMTP_SECURE || "").trim().toLowerCase();
  const secure = secureEnv ? secureEnv === "true" : port === 465;
  const from = (process.env.EMAIL_FROM || user || "").trim();

  const missing = [
    !host && "SMTP_HOST",
    !user && "SMTP_USER",
    !pass && "SMTP_PASSWORD",
    !from && "EMAIL_FROM",
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(`Missing email environment variables: ${missing.join(", ")}`);
  }

  return { host, port, secure, user, pass, from };
}

function getTransport(config: SmtpConfig) {
  const key = JSON.stringify({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
  });
  if (cachedTransport && cachedKey === key) return cachedTransport;

  cachedTransport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    // Bound every SMTP phase so a hung send cannot stall a request.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    // No mail here ever carries an attachment, so nothing may read local files
    // or fetch URLs on the transport's behalf.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  cachedKey = key;
  return cachedTransport;
}

/**
 * Development logging: explicit opt-in, development process only, and never
 * when a real SMTP host is configured — a production process can never land
 * in this branch.
 */
function shouldLogInsteadOfSend() {
  if (process.env.EMAIL_SEND_IN_DEV === "true") return false;
  if (process.env.NODE_ENV !== "development") return false;
  if (process.env.SMTP_HOST) return false;
  return true;
}

async function sendMail(payload: MailPayload) {
  if (shouldLogInsteadOfSend()) {
    // The timestamp is what lets `npm run otp` say how old a code is. A code
    // lives ten minutes; without this, a code read out of yesterday's log
    // looks exactly like one issued a second ago.
    console.info(
      `\n[EMAIL:dev] at=${new Date().toISOString()}\n[EMAIL:dev] to=${payload.to}\n[EMAIL:dev] subject=${payload.subject}\n[EMAIL:dev] ${payload.text.replace(/\n/g, "\n[EMAIL:dev] ")}\n`
    );
    return;
  }

  // Fail closed: outside the dev-log branch, a missing SMTP configuration
  // must never downgrade to logging secrets like OTP codes. Refuse with a
  // generic error and log only the configuration fact — never the payload.
  if (!process.env.SMTP_HOST) {
    console.error("[EMAIL] SMTP_HOST is not configured — email not sent.");
    throw new Error("EMAIL_SEND_FAILED");
  }

  try {
    const config = resolveSmtpConfig();
    const transport = getTransport(config);

    await transport.sendMail({
      to: payload.to,
      from: `"${BRAND}" <${config.from}>`,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });
  } catch (error: unknown) {
    // Never surface SMTP internals to the caller — they reach an end user.
    console.error("[EMAIL] send failed", error instanceof Error ? error.message : error);
    throw new Error("EMAIL_SEND_FAILED");
  }
}

function shell(title: string, body: string) {
  return `
  <div style="font-family:Helvetica,Arial,sans-serif;background:#07073d;color:#f2f2f3;padding:34px;max-width:540px;margin:auto;border:1px solid #0000c2">
    <div style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#9a9aff;text-align:center">${BRAND} · BFT MENA</div>
    <h2 style="font-size:24px;font-weight:700;letter-spacing:-0.01em;text-transform:uppercase;text-align:center;margin:14px 0 6px">${title}</h2>
    ${body}
  </div>`;
}

export async function sendOtpEmail(params: { email: string; code: string; ttlMinutes: number }) {
  const subject = `${params.code} — your ${BRAND} verification code`;
  const text = `Your ${BRAND} code is: ${params.code}\n\nIt expires in ${params.ttlMinutes} minutes. If you did not try to sign in, ignore this email.`;
  const html = shell(
    "Verification code",
    `<div style="background:#0000c2;padding:22px;text-align:center;margin:20px 0">
       <span style="font-size:38px;font-weight:700;letter-spacing:12px;font-family:monospace">${params.code}</span>
     </div>
     <p style="color:#9a9aff;font-size:12px;text-align:center;margin:0">Expires in ${params.ttlMinutes} minutes. Never share this code.</p>`
  );
  await sendMail({ to: params.email, subject, text, html });
}

export async function sendInviteEmail(params: {
  email: string;
  url: string;
  roleLabel: string;
  invitedBy: string;
}) {
  const subject = `You have been added to ${BRAND}`;
  const text = `${params.invitedBy} added you to ${BRAND} as ${params.roleLabel}.\n\nSet your password here: ${params.url}\n\nThe link expires in 7 days.`;
  const html = shell(
    "Set your password",
    `<p style="color:#c6c6ff;font-size:14px;text-align:center">${params.invitedBy} added you to ${BRAND} as <strong>${params.roleLabel}</strong>.</p>
     <div style="text-align:center;margin:24px 0">
       <a href="${params.url}" style="display:inline-block;background:#00b5cc;color:#07073d;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:14px 26px;text-decoration:none">Set your password</a>
     </div>
     <p style="color:#9a9aff;font-size:12px;text-align:center;margin:0">The link expires in 7 days. If you were not expecting this, ignore the email.</p>`
  );
  await sendMail({ to: params.email, subject, text, html });
}

export async function sendPasswordResetEmail(params: { email: string; url: string }) {
  const subject = `Reset your ${BRAND} password`;
  const text = `Reset your ${BRAND} password here: ${params.url}\n\nThe link expires shortly. If you did not ask for this, ignore the email — your password is unchanged.`;
  const html = shell(
    "Reset your password",
    `<div style="text-align:center;margin:24px 0">
       <a href="${params.url}" style="display:inline-block;background:#00b5cc;color:#07073d;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:14px 26px;text-decoration:none">Choose a new password</a>
     </div>
     <p style="color:#9a9aff;font-size:12px;text-align:center;margin:0">If you did not ask for this, ignore the email — your password is unchanged.</p>`
  );
  await sendMail({ to: params.email, subject, text, html });
}

export async function sendSecurityAlertEmail(params: {
  email: string;
  subject: string;
  details: string[];
}) {
  const text = `${params.subject}\n\n${params.details.join("\n")}`;
  const html = shell(
    params.subject,
    `<div style="border:1px solid #0000c2;padding:16px;margin:18px 0">
       ${params.details.map((d) => `<div style="color:#c6c6ff;font-size:13px">${d}</div>`).join("")}
     </div>
     <p style="color:#9a9aff;font-size:12px;text-align:center;margin:0">If this was not you, reset your password immediately.</p>`
  );
  await sendMail({ to: params.email, subject: `${BRAND} · ${params.subject}`, text, html });
}
