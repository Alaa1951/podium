import { Fragment } from "react";

import type { Inline, WaiverBlock } from "@/lib/waivers/document";

// ─────────────────────────────────────────────────────────────────────────────
// A WAIVER EDITION ON SCREEN (and on paper) — every block of the document in
// its own order, in its own language and direction. The page renders the
// stored edition, the one that is signed; the receipt renders the same
// stored text. Nothing here rewords anything: bold runs are the document's.
// ─────────────────────────────────────────────────────────────────────────────

/** "a **b** c" → a <strong>b</strong> c; line breaks kept. */
function Text({ text }: { text: Inline }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((part, index) => {
        const lines = part.split("\n").map((line, i) => (
          <Fragment key={i}>
            {i > 0 ? <br /> : null}
            {line}
          </Fragment>
        ));
        return index % 2 === 1 ? <strong key={index}>{lines}</strong> : <Fragment key={index}>{lines}</Fragment>;
      })}
    </>
  );
}

export function WaiverBlocks({ blocks }: { blocks: WaiverBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.t) {
          case "title":
            return (
              <header key={index} className="waiver-title">
                {block.lines.map((line, i) => <div key={i} className={i === block.lines.length - 1 ? "waiver-title-main" : undefined}><Text text={line} /></div>)}
              </header>
            );
          case "facts":
            return (
              <table key={index} className="waiver-facts">
                <tbody>
                  {block.rows.map((row, i) => (
                    <tr key={i}>
                      <th scope="row">{row.label}</th>
                      <td>{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case "notice":
            return (
              <div key={index} className="waiver-box waiver-notice">
                <strong className="waiver-box-title">{block.title}</strong>
                {block.paragraphs.map((text, i) => <p key={i}><Text text={text} /></p>)}
              </div>
            );
          case "heading":
            return <h2 key={index} className="waiver-heading" id={`section-${block.number}`}>{block.text}</h2>;
          case "p":
            return <p key={index}><Text text={block.text} /></p>;
          case "ul":
            return <ul key={index}>{block.items.map((item, i) => <li key={i}><Text text={item} /></li>)}</ul>;
          case "ack":
            return <WaiverAcknowledgement key={index} title={block.title} paragraphs={block.paragraphs} />;
          case "footer":
            return (
              <footer key={index} className="waiver-footer">
                {block.lines.map((line, i) => <div key={i}><Text text={line} /></div>)}
              </footer>
            );
        }
      })}
    </>
  );
}

/** The source document's mandatory acknowledgement — in the document, and again by the signing controls. */
export function WaiverAcknowledgement({ title, paragraphs, id }: { title: string; paragraphs: Inline[]; id?: string }) {
  return (
    <div className="waiver-box waiver-ack" id={id}>
      <strong className="waiver-box-title">{title}</strong>
      {paragraphs.map((text, i) => <p key={i}><Text text={text} /></p>)}
    </div>
  );
}

export function WaiverDocumentView({ blocks, language, dir }: { blocks: WaiverBlock[]; language: "en" | "ar"; dir: "ltr" | "rtl" }) {
  return (
    <article className="waiver-doc" lang={language} dir={dir} data-testid="waiver-document">
      <WaiverBlocks blocks={blocks} />
    </article>
  );
}
