/**
 * The CRM client, and the one property it exists to guarantee.
 *
 * A GoHighLevel error response echoes the request back, and these requests
 * carry eighty-five people's names, emails, phone numbers and dates of birth.
 * An error message that repeats the body puts all of that in a log file, a
 * console, and whatever ships logs onward. The redaction tests below are the
 * point of this file; the paging tests are there because a half-read CRM is
 * indistinguishable from a CRM where the unread half was deleted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCrmClient, CrmApiError } from "@/lib/crm/client";

const TOKEN = "pit-secret-token-value";
const LOCATION = "loc-123";

/** A body of the shape GHL actually returns when it rejects a call. */
const LEAKY_BODY = {
  message: "Unauthorized",
  contacts: [{ email: "someone@example.com", phone: "+97455555555", firstName: "Sample" }],
  request: { headers: { Authorization: `Bearer ${TOKEN}` } },
};

/** The error a call produced. Fails the test if the call did not fail. */
async function failureOf(work: Promise<unknown>): Promise<Error> {
  try {
    await work;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to fail, and it did not");
}

function respond(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.CRM_GHL = TOKEN;
  process.env.CRM_GHL_location_id = LOCATION;
});

afterEach(() => {
  delete process.env.CRM_GHL;
  delete process.env.CRM_GHL_location_id;
});

describe("credentials", () => {
  // Read at call time, so a token rotated while the server runs is picked up
  // without a restart — and a server with no token still boots.
  it("refuses to call without a token, and names which variable", async () => {
    delete process.env.CRM_GHL;
    await expect(createCrmClient(respond(200, {})).listPipelines()).rejects.toThrow("CRM_GHL is not set.");
  });

  it("refuses without a location, which is as much a credential as the token", async () => {
    delete process.env.CRM_GHL_location_id;
    await expect(createCrmClient(respond(200, {})).listPipelines()).rejects.toThrow(
      "CRM_GHL_location_id is not set."
    );
  });

  it("sends the token as a bearer and the version GHL requires", async () => {
    const fetchImpl = respond(200, { pipelines: [] });
    await createCrmClient(fetchImpl).listPipelines();
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect((init.headers as Record<string, string>).Version).toBe("2021-07-28");
    // Redirects are never followed: a redirect is a request to send these
    // credentials and this data somewhere the allow-list never approved.
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeDefined();
  });
});

describe("what an error is allowed to say", () => {
  // THE ONE THAT MATTERS.
  it("never repeats the response body, which carries the contacts", async () => {
    const client = createCrmClient(respond(401, LEAKY_BODY));
    await expect(client.listContacts()).rejects.toThrow(CrmApiError);

    const error = await failureOf(client.listContacts());
    expect(error.message).not.toContain("someone@example.com");
    expect(error.message).not.toContain("+97455555555");
    expect(error.message).not.toContain("Sample");
  });

  it("never repeats the token", async () => {
    const client = createCrmClient(respond(401, LEAKY_BODY));
    const error = await failureOf(client.listContacts());
    expect(error.message).not.toContain(TOKEN);
  });

  it("says the status, so a 401 can be told apart from a 500", async () => {
    const client = createCrmClient(respond(503, { message: "nope" }));
    const error = await failureOf(client.listContacts());
    expect(error.message).toContain("503");
  });

  // A short, well-shaped code is useful and safe; free text is neither.
  it("admits a short code but not a sentence of free text", async () => {
    const withCode = createCrmClient(respond(400, { code: "invalid_location" }));
    const coded = await failureOf(withCode.listContacts());
    expect(coded.message).toContain("invalid_location");

    const withProse = createCrmClient(
      respond(400, { code: "the contact someone@example.com could not be read from location loc-123" })
    );
    const prose = await failureOf(withProse.listContacts());
    expect(prose.message).not.toContain("someone@example.com");
  });

  it("replaces a transport failure rather than repeating it", async () => {
    const thrower = vi.fn(async () => {
      // A real fetch error can carry the request, and the request carries the
      // contacts — so the original is dropped entirely.
      throw new Error(`connect ECONNREFUSED while sending ${JSON.stringify(LEAKY_BODY)}`);
    }) as unknown as typeof fetch;
    const error = await failureOf(createCrmClient(thrower).listContacts());
    expect(error.message).toBe("CRM request failed.");
  });

  it("says so when a call times out, rather than blaming the data", async () => {
    const timeout = vi.fn(async () => {
      const error = new Error("The operation was aborted");
      error.name = "TimeoutError";
      throw error;
    }) as unknown as typeof fetch;
    const error = await failureOf(createCrmClient(timeout).listContacts());
    expect(error.message).toBe("CRM request timed out.");
  });
});

describe("reading a whole list", () => {
  /** Answers with `pages`, in order, then with an empty page forever. */
  function pager(key: string, pages: unknown[][]) {
    let call = 0;
    return vi.fn(async () => {
      const body = { [key]: pages[call] ?? [] };
      call += 1;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
  }

  it("follows the pages until one comes back short", async () => {
    const full = Array.from({ length: 100 }, (_, index) => ({ id: `c${index}` }));
    const rest = [{ id: "c100" }, { id: "c101" }];
    const contacts = await createCrmClient(pager("contacts", [full, rest])).listContacts();
    expect(contacts).toHaveLength(102);
  });

  // A server that ignores the cursor would otherwise loop forever, holding the
  // poll open and hammering the CRM with the same request.
  it("stops instead of spinning when a page repeats what it already has", async () => {
    const same = Array.from({ length: 100 }, (_, index) => ({ id: `c${index}` }));
    const contacts = await createCrmClient(
      pager("contacts", Array.from({ length: 80 }, () => same))
    ).listContacts();
    expect(contacts).toHaveLength(100);
  });

  it("reads opportunities the same way", async () => {
    const opportunities = await createCrmClient(
      pager("opportunities", [[{ id: "o1", contactId: "c1" }]])
    ).listOpportunities();
    expect(opportunities).toHaveLength(1);
  });

  it("returns an empty list rather than throwing when there is nothing", async () => {
    await expect(createCrmClient(respond(200, {})).listContacts()).resolves.toEqual([]);
    await expect(createCrmClient(respond(200, {})).listCustomFieldIds()).resolves.toEqual([]);
  });
});
