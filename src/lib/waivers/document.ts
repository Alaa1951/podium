import podiumSeries1Ar from "@/lib/waivers/documents/podium-series-1.v1.ar.json";
import podiumSeries1En from "@/lib/waivers/documents/podium-series-1.v1.en.json";

// ─────────────────────────────────────────────────────────────────────────────
// THE WAIVER DOCUMENTS — what an athlete reads and signs.
//
// Each bundled document is one competition's waiver, in English and Arabic:
// two EDITIONS of the same release, taken word for word from BFT MENA's
// source documents (documents/*.json, with one approved correction recorded
// in `corrections`). A document names its own event; it is attached to a
// competition deliberately, in that competition's Settings, and never
// applies anywhere else.
//
// What is stored and hashed for an edition is `editionContent` — the event
// and the blocks exactly as shown — so a signed record can always be read
// back as it was signed.
//
// Pure data: the page, the server and the tests all read the same thing.
// ─────────────────────────────────────────────────────────────────────────────

export type WaiverLanguage = "en" | "ar";
export const WAIVER_LANGUAGES: WaiverLanguage[] = ["en", "ar"];

/** Text with **bold** runs, as in the source document. */
export type Inline = string;

export type WaiverBlock =
  | { t: "title"; lines: string[] }
  | { t: "facts"; rows: { label: string; value: string }[] }
  | { t: "notice"; title: string; paragraphs: Inline[] }
  | { t: "heading"; number: number; text: string }
  | { t: "p"; text: Inline }
  | { t: "ul"; items: Inline[] }
  | { t: "ack"; title: string; paragraphs: Inline[] }
  | { t: "footer"; lines: Inline[] };

export type WaiverEvent = { name: string; organiser: string; date: string; venue: string };

export type WaiverEdition = {
  key: string;
  version: number;
  language: WaiverLanguage;
  dir: "ltr" | "rtl";
  source: string;
  corrections: string[];
  event: WaiverEvent;
  contactEmail: string;
  blocks: WaiverBlock[];
};

export type WaiverDocument = {
  key: string;
  version: number;
  /** The event the document was written for — shown before it is attached. */
  event: WaiverEvent;
  editions: Record<WaiverLanguage, WaiverEdition>;
};

const edition = (raw: unknown) => raw as WaiverEdition;

export const WAIVER_DOCUMENTS: WaiverDocument[] = [
  {
    key: "podium-series-1",
    version: 1,
    event: edition(podiumSeries1En).event,
    editions: { en: edition(podiumSeries1En), ar: edition(podiumSeries1Ar) },
  },
];

export function findWaiverDocument(key: string, version: number): WaiverDocument | null {
  return WAIVER_DOCUMENTS.find((doc) => doc.key === key && doc.version === version) ?? null;
}

/**
 * The words next to "Agree & Sign", per edition. The checkbox sentence is
 * stored word for word with each signature, so it lives here with the
 * document rather than in the interface dictionary.
 */
export const SIGNING_TEXT: Record<WaiverLanguage, { acknowledgement: string; nameLabel: string; helper: string; button: string }> = {
  en: {
    acknowledgement: "I have read and understood the full waiver and voluntarily agree to all provisions that apply to me.",
    nameLabel: "Full name — electronic signature",
    helper: "By typing my full name and selecting ‘Agree & Sign’, I intend to electronically sign this waiver.",
    button: "Agree & Sign",
  },
  ar: {
    acknowledgement: "أقر بأنني قرأت الإقرار كاملًا وفهمت مضمونه، وأوافق طوعًا على جميع البنود المنطبقة عليّ.",
    nameLabel: "الاسم بالكامل — التوقيع الإلكتروني",
    helper: "بكتابة اسمي بالكامل والضغط على «أوافق وأوقّع»، أقصد التوقيع إلكترونيًا على هذا الإقرار.",
    button: "أوافق وأوقّع",
  },
};

/**
 * Exactly what is stored — and hashed — for one edition: the event and the
 * blocks as shown, in a fixed key order. Metadata about the source file is
 * not part of what the athlete reads, so it is not part of the record.
 */
export function editionContent(doc: WaiverEdition): string {
  return JSON.stringify({ key: doc.key, version: doc.version, language: doc.language, event: doc.event, blocks: doc.blocks });
}

/** Read a stored edition back (the receipt renders exactly this). */
export function parseEditionContent(content: string): Pick<WaiverEdition, "key" | "version" | "language" | "event" | "blocks"> {
  return JSON.parse(content);
}
