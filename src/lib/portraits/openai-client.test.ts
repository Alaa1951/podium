/**
 * The one place this app sends a person's photograph somewhere else.
 *
 * The tests that earn their place are the two that protect the things nobody
 * would notice going wrong: that the API KEY can never reach an error message
 * or a log line, and that the REQUEST BODY — which is a photograph of a face —
 * can never reach one either. A leak there would be invisible until it was
 * somebody else's problem.
 *
 * `fetch` is injected, never mocked globally: the same convention as
 * `scripts/play-publish.test.mjs`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPortraitClient, PortraitApiError } from "@/lib/portraits/openai-client";

const KEY = "sk-test-SUPERSECRET-do-not-log";
const photo = { imageB64: Buffer.from("not-really-a-jpeg").toString("base64"), mimeType: "image/jpeg" };

beforeEach(() => {
  process.env.OPENAI_API_KEY = KEY;
});
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

/** A fake fetch that records how it was called, typed as the real thing. */
function ok(b64 = "UE5H") {
  const calls: [URL, RequestInit][] = [];
  const impl = (async (url: URL, init: RequestInit) => {
    calls.push([url, init]);
    return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("a successful call", () => {
  it("returns the image the API sent back", async () => {
    const client = createPortraitClient(ok("QUJD").impl);
    expect(await client.restylePortrait(photo)).toEqual({ imageB64: "QUJD", mimeType: "image/png" });
  });

  it("goes only to api.openai.com, with the key in a header and not a query", async () => {
    const fetchImpl = ok();
    await createPortraitClient(fetchImpl.impl).restylePortrait(photo);

    const [url, init] = fetchImpl.calls[0];
    expect(url.origin).toBe("https://api.openai.com");
    expect(url.toString()).not.toContain(KEY);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it("refuses redirects and bounds the call", async () => {
    const fetchImpl = ok();
    await createPortraitClient(fetchImpl.impl).restylePortrait(photo);
    const init = fetchImpl.calls[0][1];
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends BOTH portraits for a team composite", async () => {
    const fetchImpl = ok();
    await createPortraitClient(fetchImpl.impl).compositeTeam({ a: photo, b: photo });
    const body = fetchImpl.calls[0][1].body as FormData;
    expect(body.getAll("image[]")).toHaveLength(2);
  });
});

describe("nothing secret escapes in an error", () => {
  // The load-bearing pair. An API that echoes the request, a transport that
  // throws with the request attached, a 500 with a long body — none of them
  // may put the key or the photograph into a message somebody will log.
  const hostile = [
    ["an API error echoing the request", async () =>
      new Response(`bad request: Bearer ${KEY} image=${photo.imageB64}`, { status: 400 })],
    ["a transport failure carrying the request", async () => {
      throw new Error(`connect ECONNREFUSED while sending Bearer ${KEY} ${photo.imageB64}`);
    }],
  ] as const;

  for (const [name, fetchImpl] of hostile) {
    it(`keeps the key out of the message — ${name}`, async () => {
      const client = createPortraitClient(fetchImpl as unknown as typeof fetch);
      await expect(client.restylePortrait(photo)).rejects.toThrow(PortraitApiError);
      const error = await client.restylePortrait(photo).catch((e: unknown) => e as Error);
      const message = (error as Error).message;
      expect(message).not.toContain(KEY);
      expect(message).not.toContain("SUPERSECRET");
      expect(message).not.toContain(photo.imageB64);
    });
  }

  it("fails cleanly with no key set, rather than calling anything", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchImpl = ok();
    const client = createPortraitClient(fetchImpl.impl);
    await expect(client.restylePortrait(photo)).rejects.toThrow("OPENAI_API_KEY is not set.");
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("refuses a response with no image rather than storing nothing", async () => {
    const empty = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const client = createPortraitClient(empty as unknown as typeof fetch);
    await expect(client.restylePortrait(photo)).rejects.toThrow("carried no image");
  });
});
