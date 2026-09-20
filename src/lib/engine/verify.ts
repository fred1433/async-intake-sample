/**
 * Turns a raw model draft into a Draft the page can show.
 *
 * The rule is simple: a field must quote a passage that exists on the page it
 * names; a claim must quote words that exist in the transcript, and its audio
 * segment is located by the code from those words. Anything that fails is
 * withheld, listed, and never shown as a finding. A claim with no source at all
 * is refused the same way.
 */
import type { RawDraft, RawTranscript } from "./raw";
import type { Draft, DocumentExtraction, RecordingClaim, RecordingReview, Transcript, TranscriptSegment, Withheld } from "./types";

export interface DocumentSource {
  mediaId: string;
  /** Text layer per page number, blocks joined by newlines. */
  pages: Record<number, string>;
}

export interface RecordingSource {
  mediaId: string;
  transcript: Transcript;
}

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips punctuation for a looser comparison of spoken words. */
function spokenForm(text: string): string {
  return normalize(text)
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function quoteIsOnPage(quote: string, pageText: string): boolean {
  const needle = normalize(quote);
  return needle.length > 0 && normalize(pageText).includes(needle);
}

/**
 * Finds the transcript segments that carry the quoted words, in order, and
 * returns the audio window they span. Null when the words are not there.
 */
export function locateQuote(quote: string, segments: TranscriptSegment[]): { start: number; end: number } | null {
  const needle = spokenForm(quote);
  if (!needle) return null;
  const parts = segments.map((s) => spokenForm(s.text));
  let offset = 0;
  const bounds: { from: number; to: number }[] = [];
  for (const part of parts) {
    bounds.push({ from: offset, to: offset + part.length });
    offset += part.length + 1;
  }
  const joined = parts.join(" ");
  const at = joined.indexOf(needle);
  if (at === -1) return null;
  const endAt = at + needle.length;
  let first = -1;
  let last = -1;
  bounds.forEach((b, i) => {
    if (first === -1 && at < b.to && endAt > b.from) first = i;
    if (at < b.to && endAt > b.from) last = i;
  });
  if (first === -1 || last === -1) return null;
  return { start: segments[first].start, end: segments[last].end };
}

export function transcriptFromRaw(mediaId: string, raw: RawTranscript): Transcript {
  const segments = raw.segments
    .map((s) => ({ start: Math.max(0, s.start), end: Math.max(0, s.end), text: s.text.trim() }))
    .filter((s) => s.text.length > 0 && s.end >= s.start)
    .sort((a, b) => a.start - b.start);
  const unusable = !raw.complete
    ? raw.note?.trim() || "The recording ends before the answer does."
    : segments.length === 0
      ? "No usable speech was found in the recording."
      : null;
  return { mediaId, segments, unusable };
}

export function verifyDraft(
  raw: RawDraft,
  sources: { documents: DocumentSource[]; recordings: RecordingSource[] },
  meta: { origin: Draft["origin"]; computedAt: string },
): Draft {
  const withheld: Withheld[] = [];
  const documents: DocumentExtraction[] = [];
  const recordings: RecordingReview[] = [];

  for (const doc of raw.documents) {
    const source = sources.documents.find((d) => d.mediaId === doc.mediaId);
    if (!source) {
      withheld.push({ mediaId: doc.mediaId, key: "*", reason: "unknown_media", detail: "The draft names a document this file does not hold." });
      continue;
    }
    const fields = [];
    for (const field of doc.fields) {
      const quote = field.quote.trim();
      if (!quote) {
        withheld.push({ mediaId: doc.mediaId, key: field.key, reason: "no_source", detail: `"${field.label}" came with no passage to check.` });
        continue;
      }
      const pageText = source.pages[field.page];
      if (!pageText || !quoteIsOnPage(quote, pageText)) {
        withheld.push({
          mediaId: doc.mediaId,
          key: field.key,
          reason: "quote_not_found",
          detail: `"${field.label}": the quoted passage is not on page ${field.page}.`,
        });
        continue;
      }
      fields.push({
        key: field.key,
        label: field.label,
        value: field.value.trim(),
        normalized: field.normalized?.trim() || null,
        page: field.page,
        quote,
        uncertain: field.uncertain?.trim() || null,
      });
    }
    documents.push({ mediaId: doc.mediaId, readable: doc.readable, unreadableReason: doc.unreadableReason?.trim() || null, fields });
  }

  for (const rec of raw.recordings) {
    const source = sources.recordings.find((r) => r.mediaId === rec.mediaId);
    if (!source) {
      withheld.push({ mediaId: rec.mediaId, key: "*", reason: "unknown_media", detail: "The draft names a recording this file does not hold." });
      continue;
    }
    const claims: RecordingClaim[] = [];
    for (const claim of rec.claims) {
      const quote = claim.quote.trim();
      if (!quote) {
        withheld.push({ mediaId: rec.mediaId, key: claim.key, reason: "no_source", detail: `"${claim.label}" came with no words to check.` });
        continue;
      }
      const segment = locateQuote(quote, source.transcript.segments);
      if (!segment) {
        withheld.push({
          mediaId: rec.mediaId,
          key: claim.key,
          reason: "segment_not_found",
          detail: `"${claim.label}": the quoted words are not in the transcript.`,
        });
        continue;
      }
      claims.push({
        key: claim.key,
        label: claim.label,
        statement: claim.statement.trim(),
        nature: claim.nature,
        segment,
        quote,
        days: [...claim.days],
        earliestHour: claim.earliestHour,
        location: claim.location,
        uncertain: claim.uncertain?.trim() || null,
      });
    }
    recordings.push({ mediaId: rec.mediaId, transcript: source.transcript, claims });
  }

  // A recording the models did not answer for still exists: its transcript is kept.
  for (const source of sources.recordings) {
    if (!recordings.some((r) => r.mediaId === source.mediaId)) {
      recordings.push({ mediaId: source.mediaId, transcript: source.transcript, claims: [] });
    }
  }

  return { origin: meta.origin, computedAt: meta.computedAt, documents, recordings, withheld };
}
