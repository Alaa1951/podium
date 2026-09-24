// Operator-only maintenance. Dry-run by default; the reviewed plan stays outside git.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import mariadb from "mariadb";
import { FIELD, readField } from "../src/lib/crm/field-map.ts";
import { crmBirthDate, normalizeCrmPhone, planPaidRegistrationMerge } from "../src/lib/crm/merge-plan.ts";

const argv = process.argv.slice(2);
const option = (name) => argv[argv.indexOf(name) + 1];
if (!argv.includes("--plan")) throw new Error("Use --plan /private/reviewed-plan.json [--apply --backup-dir /private/directory]");
const applying = argv.includes("--apply");
const spec = JSON.parse(fs.readFileSync(option("--plan"), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(spec.seriesId && spec.reason && Array.isArray(spec.entries) && spec.entries.length, "A scoped, reviewed plan is required");
assert(!applying || argv.includes("--backup-dir"), "Applying requires a private backup directory");
const directory = applying ? path.resolve(option("--backup-dir")) : null;
if (directory) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const encode = (v) => JSON.stringify(v, (_, x) => typeof x === "bigint" ? String(x) : x, 2);
const hash = (v) => createHash("sha256").update(encode(v)).digest("hex");
const email = (v) => v?.trim().toLowerCase() || null;
const databaseUrl = new URL(process.env.DATABASE_URL);
const db = await mariadb.createConnection({ host: databaseUrl.hostname, port: Number(databaseUrl.port || 3306),
  user: decodeURIComponent(databaseUrl.username), password: decodeURIComponent(databaseUrl.password),
  database: databaseUrl.pathname.slice(1), dateStrings: true, timezone: "+00:00" });
let claim = null;
let inTransaction = false;
const started = Date.now();
function audit(event, data = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...data });
  if (directory) fs.appendFileSync(path.join(directory, "audit.jsonl"), line + "\n", { mode: 0o600 });
  console.log(line);
}
async function request(route, { method = "GET", params = {}, body } = {}) {
  assert(!applying || Date.now() - started < 8 * 60_000, "Maintenance window expired; resume from recorded state");
  const url = new URL(route, "https://services.leadconnectorhq.com");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { method, redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${process.env.CRM_GHL}`, Version: "2021-07-28", Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}
const absent = (r) => r.status === 404 || (r.status === 400 && /not found|does not exist/i.test(String(r.data?.message ?? "")));
async function get(route, params) {
  const r = await request(route, { params });
  assert(r.ok, `CRM read failed HTTP ${r.status}`);
  return r.data;
}
async function opportunities() {
  const all = [], seen = new Set();
  for (let page = 1; page <= 50; page++) {
    const result = await get("/opportunities/search", { location_id: process.env.CRM_GHL_location_id, limit: 100, page });
    assert(Array.isArray(result.opportunities), "Unexpected opportunities response");
    for (const item of result.opportunities) {
      assert(!seen.has(item.id), "CRM opportunity pagination repeated a record");
      seen.add(item.id); all.push(item);
    }
    if (result.opportunities.length < 100) return all;
  }
  throw new Error("Incomplete opportunity pagination");
}
async function teamSnapshot(id) {
  return { team: (await db.query("SELECT * FROM Team WHERE id=?", [id]))[0],
    competitors: await db.query("SELECT * FROM Competitor WHERE teamId=? ORDER BY position", [id]) };
}
function stableTeam(team) {
  const copy = { ...team };
  for (const key of ["externalId", "rawPayload", "paymentStatus", "paidAt", "amountMinor", "billingNumber", "confirmedById", "paymentNote", "updatedAt"]) delete copy[key];
  return copy;
}
function verifyContact(contact, before, plan) {
  assert(contact?.id === before.id && email(contact.email) === email(before.email) && normalizeCrmPhone(contact.phone) === normalizeCrmPhone(before.phone), "Payer identity changed");
  assert(readField(contact, FIELD.paidAmount) === plan.payment.amount && readField(contact, FIELD.invoice) === plan.payment.invoice, "Payer's original money changed");
  for (const field of plan.body.customFields) {
    let expected = Array.isArray(field.value) ? field.value[0] : field.value;
    let actual = readField(contact, field.id);
    if (field.id === FIELD.birthTwo) { expected = crmBirthDate(expected); actual = crmBirthDate(actual); }
    assert(actual === expected, `CRM did not retain registration field ${field.id}`);
  }
  if (plan.body.dateOfBirth) assert(crmBirthDate(contact.dateOfBirth) === plan.body.dateOfBirth, "Payer birth date not retained");
}

try {
  if (applying) {
    const marker = new Date().toISOString().replace("T", " ").replace("Z", "");
    const result = await db.query("UPDATE CrmSyncState SET running=1,claimedAt=?,updatedAt=UTC_TIMESTAMP(3) WHERE id='singleton' AND running=0", [marker]);
    assert(result.affectedRows === 1, "CRM sync is active; no merge started"); claim = marker;
  }
  const series = (await db.query("SELECT id,status,archivedAt FROM Series WHERE id=?", [spec.seriesId]))[0];
  assert(series?.status === "scheduled" && !series.archivedAt, "Competition is not scheduled");
  const defs = (await get(`/locations/${process.env.CRM_GHL_location_id}/customFields`)).customFields;
  const pipelines = (await get("/opportunities/pipelines", { locationId: process.env.CRM_GHL_location_id })).pipelines;
  const allOpps = await opportunities();
  const work = [];
  // Validate the entire reviewed batch before modifying any registration.
  for (const entry of spec.entries) {
    const current = await teamSnapshot(entry.teamId);
    assert(current.team?.seriesId === spec.seriesId && current.team.number === entry.number && !current.team.archivedAt, "Team scope changed");
    const saved = (await db.query("SELECT * FROM CrmRegistrationMerge WHERE seriesId=? AND retiredExternalId=?", [spec.seriesId, entry.retiredId]))[0];
    if (saved) assert(saved.teamId === entry.teamId && saved.canonicalExternalId === entry.payerId, "Merge ownership changed");
    const original = saved ? (typeof saved.beforeSnapshot === "string" ? JSON.parse(saved.beforeSnapshot) : saved.beforeSnapshot) : null;
    const payer = (await get(`/contacts/${entry.payerId}`)).contact;
    const retiredResponse = await request(`/contacts/${entry.retiredId}`);
    assert(retiredResponse.ok || (saved?.status !== "prepared" && saved && absent(retiredResponse)), "Retired contact disappeared before linking");
    const retired = retiredResponse.ok ? retiredResponse.data.contact : null;
    assert(payer?.locationId === process.env.CRM_GHL_location_id && email(payer.email) === entry.payerEmail, "Payer contact identity mismatch");
    if (retired) assert(retired.locationId === process.env.CRM_GHL_location_id && email(retired.email) === entry.retiredEmail, "Retired contact identity mismatch");
    const payerOpps = allOpps.filter(o => o.contactId === entry.payerId);
    const retiredOpps = allOpps.filter(o => o.contactId === entry.retiredId);
    assert(payerOpps.length === 1 && payerOpps[0].id === entry.payerOpportunityId && payerOpps[0].pipelineId === spec.pipelineId, "Payer opportunity scope changed");
    const pipeline = pipelines.find(p => p.id === spec.pipelineId);
    const payerStage = pipeline?.stages?.find(s => s.id === payerOpps[0].pipelineStageId)?.name;
    assert(payerStage === "Paid – Not Registered" || payerStage === "Paid – Registered", "Payer is no longer paid");
    assert(pipeline.stages.some(s => s.id === spec.paidRegisteredStageId && s.name === "Paid – Registered"), "Destination payment stage changed");
    if (retired) {
      assert(retiredOpps.length === 1 && retiredOpps[0].id === entry.retiredOpportunityId && retiredOpps[0].pipelineId === spec.pipelineId, "Retired contact has other registrations");
      assert(readField(retired, FIELD.paidAmount) === null && readField(retired, FIELD.invoice) === null, "Retired contact has additional payment data; preserve for review");
      const transactions = await get("/payments/transactions", { altId: process.env.CRM_GHL_location_id, altType: "location", contactId: entry.retiredId, limit: 1, offset: 0 });
      assert(transactions.totalCount === 0 && transactions.data?.length === 0, "Retired contact has payment transactions");
    }
    assert(readField(payer, FIELD.paidAmount) === entry.amount && readField(payer, FIELD.invoice) === entry.invoice, "Payer amount or invoice changed since review");
    const linkedElsewhere = await db.query("SELECT id FROM Team WHERE externalId IN (?,?) AND id<>?", [entry.payerId, entry.retiredId, entry.teamId]);
    assert(linkedElsewhere.length === 0, "CRM record belongs to another application team");
    const before = original ?? { ...current, payer, retired, payerOpportunity: payerOpps[0], retiredOpportunity: retiredOpps[0],
      intake: await db.query("SELECT * FROM CrmIntake WHERE seriesId=? AND externalId IN (?,?)", [spec.seriesId, entry.payerId, entry.retiredId]) };
    assert(before.team.externalId === entry.oldExternalId, "Original team CRM link changed");
    const registration = before.team.externalId === entry.payerId ? before.payer : before.retired;
    const plan = planPaidRegistrationMerge({ team: before.team, registration, payer: before.payer, other: before.retired });
    assert(current.competitors.length === 2 && current.competitors.some(c => email(c.email) === plan.payerEmail) && current.competitors.some(c => email(c.email) === plan.partnerEmail), "Athlete identities changed");
    assert(hash(stableTeam(current.team)) === hash(stableTeam(before.team)) && hash(current.competitors) === hash(before.competitors), "Team or athletes changed during merge");
    for (const field of plan.body.customFields) {
      const def = defs.find(d => d.id === field.id);
      assert(def, "CRM registration field is missing");
      if (Array.isArray(def.picklistOptions) && def.picklistOptions.length) {
        const values = Array.isArray(field.value) ? field.value : [field.value];
        assert(values.every(v => def.picklistOptions.includes(v)), "CRM field option changed");
      }
    }
    audit("PLAN", { team: entry.number, payerId: entry.payerId, retiredId: entry.retiredId, payerPositionInTeam: plan.payerPositionInTeam, amount: plan.payment.amount, fields: plan.body.customFields.length, state: saved?.status ?? "new", applying });
    work.push({ entry, before, plan, saved, payer, retired });
  }
  if (applying) for (const item of work) {
    const { entry, before, plan } = item;
    let state = item.saved?.status ?? "prepared";
    const mergeId = item.saved?.id ?? randomUUID();
    fs.writeFileSync(path.join(directory, `${entry.number}-before.json`), encode({ ...before, evidence: entry.evidence, plan }), { mode: 0o600 });
    if (!item.saved) await db.query("INSERT INTO CrmRegistrationMerge (id,seriesId,teamId,retiredExternalId,canonicalExternalId,status,beforeSnapshot,paymentEvidence,reason,updatedAt) VALUES (?,?,?,?,?,'prepared',?,?,?,UTC_TIMESTAMP(3))", [mergeId, spec.seriesId, entry.teamId, entry.retiredId, entry.payerId, encode(before), encode(entry.evidence ?? null), spec.reason]);
    if (state === "prepared") {
      // Only registration fields and the payer's own DOB. No names, addresses,
      // tags, payment fields, or native "merge contacts" operation.
      const body = { ...plan.body, customFields: plan.body.customFields.map(f => ({ id: f.id, fieldValue: f.value })) };
      const response = await request(`/contacts/${entry.payerId}`, { method: "PUT", body });
      assert(response.ok, `CRM registration update failed HTTP ${response.status}`);
      const canonical = (await get(`/contacts/${entry.payerId}`)).contact;
      verifyContact(canonical, before.payer, plan);
      const stageMove = await request(`/opportunities/${entry.payerOpportunityId}`, { method: "PUT", body: { pipelineId: spec.pipelineId, pipelineStageId: spec.paidRegisteredStageId } });
      assert(stageMove.ok, `CRM stage update failed HTTP ${stageMove.status}`);
      const checkedOpp = (await get(`/opportunities/${entry.payerOpportunityId}`)).opportunity;
      assert(checkedOpp?.contactId === entry.payerId && checkedOpp.pipelineStageId === spec.paidRegisteredStageId, "Paid registered stage was not retained");
      await db.beginTransaction(); inTransaction = true;
      const currentSeries = (await db.query("SELECT status FROM Series WHERE id=? FOR UPDATE", [spec.seriesId]))[0];
      assert(currentSeries?.status === "scheduled", "Competition started during merge");
      const locked = (await db.query("SELECT * FROM Team WHERE id=? FOR UPDATE", [entry.teamId]))[0];
      assert(hash(locked) === hash(before.team), "Team changed since reviewed snapshot");
      const minor = Math.round(Number(plan.payment.amount) * 100);
      assert(Number.isFinite(minor) && minor >= 0 && /^\d+(\.\d{1,2})?$/.test(plan.payment.amount), "Invalid canonical payment amount");
      const note = [before.team.paymentNote, `CRM registrations consolidated by explicit operator request. Payer contact: ${entry.payerId}. Original payment values retained; supporting evidence saved in merge ${mergeId}.`].filter(Boolean).join("\n");
      await db.query("UPDATE Team SET externalId=?,rawPayload=?,paymentStatus='paid',paidAt=COALESCE(paidAt,UTC_TIMESTAMP(3)),amountMinor=?,billingNumber=?,confirmedById=NULL,paymentNote=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=?", [entry.payerId, encode(canonical), minor, plan.payment.invoice, note, entry.teamId]);
      await db.query("DELETE FROM CrmIntake WHERE seriesId=? AND externalId IN (?,?)", [spec.seriesId, entry.payerId, entry.retiredId]);
      await db.query("UPDATE CrmRegistrationMerge SET status='linked',updatedAt=UTC_TIMESTAMP(3) WHERE id=? AND status='prepared'", [mergeId]);
      await db.commit(); inTransaction = false; state = "linked";
      audit("LINKED", { team: entry.number, mergeId });
    }
    if (state === "linked") {
      const current = (await get(`/contacts/${entry.payerId}`)).contact;
      verifyContact(current, before.payer, plan);
      const retired = await request(`/contacts/${entry.retiredId}`);
      if (!absent(retired)) {
        assert(retired.ok && hash(retired.data.contact) === hash(before.retired), "Retired contact changed before deletion");
        const result = await request(`/contacts/${entry.retiredId}`, { method: "DELETE" });
        assert(result.ok && (result.data?.succeeded || result.data?.succeded || result.data?.success), `Retired contact delete unconfirmed HTTP ${result.status}`);
      }
      const removed = await request(`/contacts/${entry.retiredId}`);
      assert(absent(removed), "Retired contact absence not confirmed");
      // Contact deletion may remove opportunities asynchronously. Remove only
      // the exact reviewed registration if it still exists.
      const oldOpp = await request(`/opportunities/${entry.retiredOpportunityId}`);
      if (!absent(oldOpp)) {
        const op = oldOpp.data?.opportunity;
        assert(oldOpp.ok && op?.contactId === entry.retiredId && op.pipelineId === spec.pipelineId, "Retired opportunity scope changed");
        const result = await request(`/opportunities/${entry.retiredOpportunityId}`, { method: "DELETE" });
        assert((result.ok && (result.data?.success || result.data?.succeded)) || absent(result), "Retired opportunity deletion unconfirmed");
      }
      await db.query("UPDATE CrmRegistrationMerge SET status='completed',completedAt=UTC_TIMESTAMP(3),updatedAt=UTC_TIMESTAMP(3) WHERE id=? AND status='linked'", [mergeId]);
    }
    const after = await teamSnapshot(entry.teamId);
    assert(after.team.externalId === entry.payerId && after.team.paymentStatus === "paid", "Application canonical link verification failed");
    assert(hash(stableTeam(after.team)) === hash(stableTeam(before.team)) && hash(after.competitors) === hash(before.competitors), "Team identity or athletes were altered");
    fs.writeFileSync(path.join(directory, `${entry.number}-after.json`), encode(after), { mode: 0o600 });
    audit("VERIFIED", { team: entry.number, canonicalContact: entry.payerId, teamIdPreserved: true, athletesPreserved: true });
  }
} catch (error) {
  if (inTransaction) { await db.rollback(); inTransaction = false; }
  // API bodies, credentials and raw database errors never enter the console.
  audit("STOPPED", { message: error instanceof Error && !error.sql ? error.message.slice(0, 200) : "Database operation failed; inspect the protected backup and merge state" });
  process.exitCode = 1;
} finally {
  if (claim) {
    const release = await db.query("UPDATE CrmSyncState SET running=0,claimedAt=NULL,updatedAt=UTC_TIMESTAMP(3) WHERE id='singleton' AND running=1 AND claimedAt=?", [claim]);
    assert(release.affectedRows === 1, "Could not release the maintenance sync claim");
  }
  await db.end();
}
