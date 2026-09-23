import "server-only";

import { UNWRITABLE_FIELD_IDS, type CrmContact } from "@/lib/crm/field-map";

// ─────────────────────────────────────────────────────────────────────────────
// TALKING TO THE CRM.
//
// The only place this app speaks to GoHighLevel, and the second place it
// speaks to any third party at all. The hardening is lifted from
// `openai-client.ts`, which learned it the hard way, and the reasons carry
// over unchanged:
//
//   THE TOKEN IS READ AT CALL TIME, so a rotated token is picked up without a
//   restart and a server with no token still boots.
//
//   THE ORIGIN IS CHECKED BEFORE THE REQUEST, so a constant edited carelessly
//   fails here rather than sending eighty-five people's names somewhere new.
//
//   AN ERROR NEVER CARRIES THE BODY. A GHL error echoes the request, and the
//   request carries contacts — names, emails, phone numbers. Only the status
//   and a short whitelisted code are allowed into a message.
//
// Everything is injected: `fetchImpl` for tests, and the whole client behind
// a narrow interface so the poller can be driven with no network at all.
//
// ── AND NOW IT WRITES ────────────────────────────────────────────────────────
//
// For most of its life this client only ever sent GETs. Two methods changed
// that, and they carry two rules of their own:
//
//   PODIUM NEVER WRITES THE MONEY. `UNWRITABLE_FIELD_IDS` is refused here, in
//   the one place a field id can reach the network — because "the CRM owns the
//   money" has to be a thing the code cannot do, not a thing we remember.
//
//   THE REQUEST SHAPE IS FROM THE DOCUMENTATION, NOT FROM A TEST. GHL resolves
//   the record BEFORE it validates the body: a malformed body against a
//   missing id returns the same "not found" as a perfect one, so no probe can
//   confirm a shape without writing to a real person's record. Both bodies
//   below are the documented shape and were first proved by one deliberate
//   single-record write, read back by hand.
// ─────────────────────────────────────────────────────────────────────────────

const API_ORIGIN = "https://services.leadconnectorhq.com";

/** The API contract version GHL requires on every v2 request. */
const API_VERSION = "2021-07-28";

const CALL_TIMEOUT_MS = 30_000;

/** GHL's own ceiling for these list endpoints. */
const PAGE_SIZE = 100;

export class CrmApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmApiError";
  }
}

export type CrmStage = { id: string; name: string };
export type CrmPipeline = { id: string; name: string; stages: CrmStage[] };
export type CrmOpportunity = {
  id: string;
  contactId: string;
  pipelineId: string;
  pipelineStageId: string;
  status: string;
};

/**
 * One field as the CRM describes it, option list included.
 *
 * The options matter as much as the id does once this app writes: a picklist
 * takes the CRM's exact label or nothing, and "BFT West Walk  Female" has a
 * double space in it. Read, never typed.
 */
export type CrmFieldDef = { id: string; name: string; dataType: string; options: string[] };

/** Everything the reconciler is allowed to ask the CRM for. */
/** One custom field to write. A multi-choice field takes an array. */
export type CrmFieldWrite = { id: string; value: string | string[] };

export type CrmClient = {
  listCustomFieldIds(): Promise<string[]>;

  /** The same endpoint, read in full — for writing, where the options matter. */
  listCustomFields(): Promise<CrmFieldDef[]>;

  /**
   * One contact, read on its own.
   *
   * THIS IS HOW A WRITE IS BELIEVED. The body shape cannot be proved by any
   * probe, so a write that quietly stored nothing would look exactly like a
   * write that worked. Reading the record back turns that into something the
   * caller can check and say out loud.
   */
  getContact(contactId: string): Promise<CrmContact | null>;
  listPipelines(): Promise<CrmPipeline[]>;
  listContacts(): Promise<CrmContact[]>;
  listOpportunities(): Promise<CrmOpportunity[]>;

  /**
   * Fill in what somebody was missing. THE FIRST WRITE THIS APP EVER MAKES TO
   * THE CRM, so read the header before adding a second one.
   */
  updateContactFields(contactId: string, fields: CrmFieldWrite[]): Promise<void>;

  /**
   * Move one opportunity to another stage of the same pipeline.
   *
   * The caller decides WHICH stage and carries the rule; this only carries
   * it out. See `stageAfterCompleting` in complete.ts for the rule.
   */
  moveOpportunityStage(opportunityId: string, pipelineId: string, stageId: string): Promise<void>;
};

export function createCrmClient(fetchImpl: typeof fetch = fetch): CrmClient {
  async function call<T>(
    pathname: string,
    params: Record<string, string | number>,
    write?: { method: "PUT"; body: unknown }
  ): Promise<T> {
    // At call time, both of them: the location is as much a credential as the
    // token here, since the token is scoped to exactly one sub-account.
    const token = process.env.CRM_GHL;
    const locationId = process.env.CRM_GHL_location_id;
    if (!token) throw new CrmApiError("CRM_GHL is not set.");
    if (!locationId) throw new CrmApiError("CRM_GHL_location_id is not set.");

    const url = new URL(pathname, API_ORIGIN);
    if (url.origin !== API_ORIGIN) throw new CrmApiError("Unexpected CRM origin.");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: write?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Version: API_VERSION,
          Accept: "application/json",
          ...(write ? { "Content-Type": "application/json" } : {}),
        },
        ...(write ? { body: JSON.stringify(write.body) } : {}),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        redirect: "error",
      });
    } catch (error) {
      // Not repeated: a thrown fetch error can carry the request.
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "failed";
      throw new CrmApiError(`CRM request ${reason}.`);
    }

    if (!response.ok) {
      // The status, and a short code if the body offers a well-shaped one.
      // Never the body: it echoes back the contacts we just asked for.
      let code = "";
      try {
        const body = (await response.json()) as { code?: string; error?: string };
        const raw = body.code ?? body.error ?? "";
        if (/^[a-z0-9_. -]{1,64}$/i.test(raw)) code = ` (${raw})`;
      } catch {
        // Not JSON. The status alone is what we get to say.
      }
      throw new CrmApiError(`CRM request failed: HTTP ${response.status}${code}.`);
    }

    return (await response.json()) as T;
  }

  /** The location every call is scoped to, read the same way `call` reads it. */
  const location = () => process.env.CRM_GHL_location_id ?? "";

  return {
    async listCustomFieldIds() {
      const body = await call<{ customFields?: { id: string }[] }>(
        `/locations/${location()}/customFields`,
        {}
      );
      return (body.customFields ?? []).map((field) => field.id);
    },

    async listCustomFields() {
      const body = await call<{
        customFields?: { id: string; name?: string; dataType?: string; picklistOptions?: unknown }[];
      }>(`/locations/${location()}/customFields`, {});
      return (body.customFields ?? []).map((field) => ({
        id: field.id,
        name: field.name ?? "",
        dataType: field.dataType ?? "",
        // A field with no picklist gets an empty list, not a missing one, so
        // `completionFields` can treat "no options" as "nothing writable here"
        // without asking whether the CRM forgot to say.
        options: Array.isArray(field.picklistOptions)
          ? field.picklistOptions.filter((option): option is string => typeof option === "string")
          : [],
      }));
    },

    async listPipelines() {
      const body = await call<{ pipelines?: CrmPipeline[] }>("/opportunities/pipelines", {
        locationId: location(),
      });
      return body.pipelines ?? [];
    },

    // BOTH LISTS ARE READ WHOLE, on purpose. The reconciler compares two
    // snapshots, and a half-read CRM looks exactly like a CRM where the
    // unread half was deleted. Paging stops at a page that returns nothing
    // new, so a server that ignores the cursor cannot spin here forever.
    async listContacts() {
      const all: CrmContact[] = [];
      const seen = new Set<string>();
      for (let page = 1; page <= 50; page += 1) {
        const body = await call<{ contacts?: CrmContact[] }>("/contacts/", {
          locationId: location(),
          limit: PAGE_SIZE,
          page,
        });
        const batch = (body.contacts ?? []).filter((contact) => !seen.has(contact.id));
        if (batch.length === 0) break;
        for (const contact of batch) seen.add(contact.id);
        all.push(...batch);
        if ((body.contacts ?? []).length < PAGE_SIZE) break;
      }
      return all;
    },

    async getContact(contactId) {
      if (!contactId.trim()) throw new CrmApiError("A contact id is required.");
      const body = await call<{ contact?: CrmContact }>(
        `/contacts/${encodeURIComponent(contactId)}`,
        {}
      );
      return body.contact ?? null;
    },

    // ── Writing ───────────────────────────────────────────────────────────

    async updateContactFields(contactId, fields) {
      if (!contactId.trim()) throw new CrmApiError("A contact id is required.");
      if (fields.length === 0) return; // Nothing to say is not an error.

      // THE GUARD, before the body is even built. A money field arriving here
      // is a bug upstream, and it must not become a request while we decide
      // whose bug it was.
      const forbidden = fields.filter((field) => UNWRITABLE_FIELD_IDS.includes(field.id));
      if (forbidden.length) {
        throw new CrmApiError("PODIUM does not write the CRM's payment fields.");
      }

      await call(`/contacts/${encodeURIComponent(contactId)}`, {}, {
        method: "PUT",
        // Only `customFields`. A contact's own columns — name, email, phone —
        // are the registrant's own answers, and the CRM is where they were
        // given; this write is for what was LEFT BLANK, nothing else.
        body: { customFields: fields.map((field) => ({ id: field.id, value: field.value })) },
      });
    },

    async moveOpportunityStage(opportunityId, pipelineId, stageId) {
      if (!opportunityId.trim() || !pipelineId.trim() || !stageId.trim()) {
        throw new CrmApiError("An opportunity, pipeline and stage are all required.");
      }

      // THE PIPELINE ID IS SENT even though the opportunity already knows it,
      // because the API requires it — and sending it makes an accidental
      // cross-pipeline move fail at the CRM rather than land somewhere odd.
      await call(`/opportunities/${encodeURIComponent(opportunityId)}`, {}, {
        method: "PUT",
        body: { pipelineId, pipelineStageId: stageId },
      });
    },

    async listOpportunities() {
      const all: CrmOpportunity[] = [];
      const seen = new Set<string>();
      for (let page = 1; page <= 50; page += 1) {
        const body = await call<{ opportunities?: CrmOpportunity[] }>("/opportunities/search", {
          location_id: location(),
          limit: PAGE_SIZE,
          page,
        });
        const batch = (body.opportunities ?? []).filter((row) => !seen.has(row.id));
        if (batch.length === 0) break;
        for (const row of batch) seen.add(row.id);
        all.push(...batch);
        if ((body.opportunities ?? []).length < PAGE_SIZE) break;
      }
      return all;
    },
  };
}
