import "server-only";

import type { CrmContact } from "@/lib/crm/field-map";

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

/** Everything the reconciler is allowed to ask the CRM for. */
export type CrmClient = {
  listCustomFieldIds(): Promise<string[]>;
  listPipelines(): Promise<CrmPipeline[]>;
  listContacts(): Promise<CrmContact[]>;
  listOpportunities(): Promise<CrmOpportunity[]>;
};

export function createCrmClient(fetchImpl: typeof fetch = fetch): CrmClient {
  async function call<T>(pathname: string, params: Record<string, string | number>): Promise<T> {
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
        headers: { Authorization: `Bearer ${token}`, Version: API_VERSION, Accept: "application/json" },
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
