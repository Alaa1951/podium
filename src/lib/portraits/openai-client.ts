import "server-only";

import { COMPOSITE_PROMPT, SOLO_PROMPT } from "@/lib/portraits/prompts";

// ─────────────────────────────────────────────────────────────────────────────
// THE ONLY PLACE THIS APP TALKS TO A THIRD PARTY ABOUT A PERSON.
//
// Until this file existed the app's single outbound path was SMTP. That is
// worth saying out loud, because everything here is shaped by it: one module,
// one host, one narrow interface, so that "what leaves this server, and to
// whom" has exactly one answer and one file to read.
//
// The hardening is taken from the two API clients this project already has
// (`scripts/asc-api.mjs`, `scripts/play-publish.mjs`):
//   • the key is read from the environment AT CALL TIME, never at module load,
//     so a missing key is a failed job rather than a server that will not boot
//   • the origin is checked against an allow-list BEFORE any request is made
//   • every call is bounded by AbortSignal.timeout
//   • redirects are an error, never followed
//   • no error message may carry the key, and none may carry the request body,
//     because the request body is a photograph of somebody's face
//
// The `fetchImpl` seam is how this is tested: the runner is given a fake
// PortraitClient, and this module's own tests inject a fake fetch. Nothing
// mocks the global — the same convention as `play-publish.test.mjs`.
// ─────────────────────────────────────────────────────────────────────────────

const API_ORIGIN = "https://api.openai.com";
const EDITS_URL = `${API_ORIGIN}/v1/images/edits`;

/** Generous over the 60–90s these calls are expected to take. */
const CALL_TIMEOUT_MS = 180_000;

/** A person standing is a tall picture; a pair standing is a wide one. */
const PORTRAIT_SIZE = "1024x1536";
const TEAM_SIZE = "1536x1024";
/**
 * THE MODEL, and a note on how it was chosen — because the first choice was
 * wrong and cost a week of working around it.
 *
 * `gpt-image-1` was used first, not because it was compared against anything
 * but because it was the one this code's author knew of. It could not
 * reproduce the brand mark, drifted faces when combining two pictures, and on
 * one pass replaced the logo with words nobody had written. A whole module was
 * built to composite the mark on afterwards, routing around all of it.
 *
 * Asking the API which models the key actually carries returned ten, of which
 * that was the oldest. On 2.5 the same prompts reproduce the mark from the
 * artwork, carry faces through the combine intact, and run in half the time.
 *
 * ASK, DO NOT ASSUME. A model id recalled from memory is a guess with a date
 * on it, and the date is not visible in the diff.
 */
const MODEL = "gpt-image-2.5-flare";

export type PortraitImage = { imageB64: string; mimeType: string };

export type PortraitClient = {
  /** The athlete's photo, and the artwork to print on the shirt. */
  restylePortrait(input: { photo: PortraitImage; logo: PortraitImage }): Promise<PortraitImage>;
  compositeTeam(input: { a: PortraitImage; b: PortraitImage }): Promise<PortraitImage>;
};

/** Everything the caller is allowed to learn when a call fails. */
export class PortraitApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortraitApiError";
  }
}

function toBlob(image: PortraitImage): Blob {
  return new Blob([Buffer.from(image.imageB64, "base64")], { type: image.mimeType });
}

/** A file name is required by the multipart API; it carries no information. */
function fileName(mimeType: string): string {
  return mimeType === "image/png" ? "photo.png" : "photo.jpg";
}

export function createPortraitClient(fetchImpl: typeof fetch = fetch): PortraitClient {
  async function call(form: FormData): Promise<PortraitImage> {
    // At call time: a key rotated while the server runs is picked up without a
    // restart, and a server with no key still boots.
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new PortraitApiError("OPENAI_API_KEY is not set.");

    // Before the request, not after: the host is fixed, and a constant edited
    // carelessly should fail here rather than send a face somewhere new.
    const url = new URL(EDITS_URL);
    if (url.origin !== API_ORIGIN) throw new PortraitApiError("Unexpected API origin.");

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        redirect: "error",
      });
    } catch (error) {
      // Whatever the transport said, it is not repeated: a thrown fetch error
      // can carry the request, and the request carries the photograph.
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "failed";
      throw new PortraitApiError(`Image request ${reason}.`);
    }

    if (!response.ok) {
      // THE STATUS, AND A CODE. Never the response text.
      //
      // An error body may echo the request back, and the request carries both
      // the key and the photograph — a test in this file proves that exact
      // case, because the first version of this code pasted the body straight
      // into the message. Only `error.code`/`error.type` are taken: short
      // identifiers the API chooses from, not free text it was handed.
      let code = "";
      try {
        const body = (await response.json()) as { error?: { code?: string; type?: string } };
        const raw = body.error?.code ?? body.error?.type ?? "";
        if (/^[a-z0-9_.-]{1,64}$/i.test(raw)) code = ` (${raw})`;
      } catch {
        // Not JSON, or unreadable. The status alone is what we get to say.
      }
      throw new PortraitApiError(`Image request failed: HTTP ${response.status}${code}.`);
    }

    const payload = (await response.json()) as { data?: { b64_json?: string }[] };
    const b64 = payload.data?.[0]?.b64_json;
    if (!b64) throw new PortraitApiError("Image response carried no image.");
    return { imageB64: b64, mimeType: "image/png" };
  }

  return {
    async restylePortrait({ photo, logo }) {
      const form = new FormData();
      form.append("model", MODEL);
      form.append("prompt", SOLO_PROMPT);
      form.append("size", PORTRAIT_SIZE);
      // The ORDER is load-bearing: the prompt calls them IMAGE 1 (the person)
      // and IMAGE 2 (the mark).
      form.append("image[]", toBlob(photo), fileName(photo.mimeType));
      form.append("image[]", toBlob(logo), "logo.png");
      return call(form);
    },

    async compositeTeam({ a, b }) {
      const form = new FormData();
      form.append("model", MODEL);
      form.append("prompt", COMPOSITE_PROMPT);
      // Landscape: two people standing side by side is a wide picture.
      form.append("size", TEAM_SIZE);
      form.append("image[]", toBlob(a), "a.png");
      form.append("image[]", toBlob(b), "b.png");
      return call(form);
    },
  };
}
