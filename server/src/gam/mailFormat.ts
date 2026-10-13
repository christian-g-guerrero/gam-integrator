// Heuristic boundaries for where a reply/forward's quoted history begins.
// Not a full parser (see Mailgun's Talon / email-reply-parser for that) —
// covers Gmail and Outlook's standard quote-block openers.
const QUOTE_BLOCK_PATTERNS = [
  /\n[ \t]*On .{0,150}wrote:[ \t]*\n/i,
  /\n[ \t]*-{2,}[ \t]*Original Message[ \t]*-{2,}/i,
  /\n[ \t]*-{2,}[ \t]*Forwarded message[ \t]*-{2,}/i,
  /\nFrom:[ \t]*.+\nSent:[ \t]*.+\nTo:[ \t]*.+\nSubject:[ \t]*.+/i,
  /\n>[ \t]?.*(\n>.*)*/,
];

/** Strips quoted reply/forward history, leaving just the new text the sender wrote — avoids re-embedding the same paragraphs once per reply in a thread. */
export function stripQuotedHistory(body: string): string {
  let cut = body.length;
  for (const re of QUOTE_BLOCK_PATTERNS) {
    const m = re.exec(body);
    if (m && m.index < cut) cut = m.index;
  }
  return body.slice(0, cut).trimEnd();
}

export function parseDateIso(raw: string): string | null {
  const t = new Date(raw);
  return isNaN(t.getTime()) ? null : t.toISOString();
}
