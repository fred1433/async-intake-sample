/**
 * Turns a raw model draft into a Draft the page can show.
 *
 * What the code checks is mechanical. A field must quote a passage that
 * exists on the page it names, its value must be in that passage as one
 * contiguous run of words, and a machine-form date must be the date written
 * in the value, on a real calendar. A claim must quote words that exist in
 * the transcript, as one contiguous run; its audio window is located by the
 * code from those words inside the timestamps the transcription returned, and
 * checked against the length of the recording. A day or a place the claim
 * carries must be in the quoted words; an hour must be an hour of the day.
 *
 * What the code does not do is read the words. It reads no negation, no
 * relation, no polarity: whether a day works, whether an hour is a start or a
 * limit, whether a place is wanted or refused, is the model's extraction,
 * kept as extracted and shown next to its quote for the reviewer to judge.
 * A free statement (other) is never assessed: it is listed for the reviewer.
 *
 * Duplicates are handled over the whole raw output: several blocks for one
 * media are merged, none ignored; two fields with one key are one field
 * (merged when they carry the same value, and uncertain when one of them is;
 * kept as one field with its conflicting values when they differ). Anything
 * that fails is withheld, listed, and never shown as a finding. A claim with
 * no source at all is refused the same way.
 *
 * What the code cannot check is the wording of a rephrase: the claim says so,
 * and the reviewer judges it against the recording.
 */
import type { RawClaim, RawDraft, RawTranscript } from "./raw";
import type { ConflictingValue, Day, Draft, DocumentExtraction, ExtractedField, Place, RecordingClaim, RecordingReview, Transcript, TranscriptSegment, Withheld } from "./types";

export interface DocumentSource {
  mediaId: string;
  /** Text layer per page number, blocks joined by newlines. */
  pages: Record<number, string>;
}

export interface RecordingSource {
  mediaId: string;
  transcript: Transcript;
  /** Length of the media, the bound every audio window is checked against. */
  durationSeconds: number;
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

/** Strips punctuation for a looser comparison of spoken words. Apostrophes and the colon of a clock time stay. */
export function spokenForm(text: string): string {
  return normalize(text)
    .replace(/\b([ap])\.\s?m\.?(?=[\s,.;!?)]|$)/g, "$1m")
    .replace(/[^\p{L}\p{N}\s':]/gu, " ")
    .replace(/(?<!\d):|:(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words of a text, lowercased, without punctuation; an apostrophe inside a word is kept (don't, it's). */
export function words(text: string): string[] {
  return spokenForm(text)
    .split(" ")
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

/** Index at which the words of needle appear in hay, contiguous and in order; -1 when they do not. */
export function indexOfWords(needle: string[], hay: string[], from = 0): number {
  if (needle.length === 0 || needle.length > hay.length) return -1;
  for (let i = Math.max(0, from); i + needle.length <= hay.length; i++) {
    let j = 0;
    while (j < needle.length && hay[i + j] === needle[j]) j++;
    if (j === needle.length) return i;
  }
  return -1;
}

/** True when the words of needle appear in hay as one contiguous run. */
export function wordsContiguous(needle: string[], hay: string[]): boolean {
  return indexOfWords(needle, hay) !== -1;
}

export function quoteIsOnPage(quote: string, pageText: string): boolean {
  const needle = normalize(quote);
  return needle.length > 0 && normalize(pageText).includes(needle);
}

/* ---------- Dates written in a passage ---------- */

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, enero: 1, ene: 1,
  february: 2, feb: 2, febrero: 2,
  march: 3, mar: 3, marzo: 3,
  april: 4, apr: 4, abril: 4, abr: 4,
  may: 5, mayo: 5,
  june: 6, jun: 6, junio: 6,
  july: 7, jul: 7, julio: 7,
  august: 8, aug: 8, agosto: 8, ago: 8,
  september: 9, sep: 9, sept: 9, septiembre: 9, setiembre: 9,
  october: 10, oct: 10, octubre: 10,
  november: 11, nov: 11, noviembre: 11,
  december: 12, dec: 12, diciembre: 12, dic: 12,
};

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** A calendar date that exists, in ISO form; null for February 31 and the like. */
export function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || year < 1000 || year > 9999) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Every calendar date written in a text, in ISO form, in order of appearance. A date that does not exist is not a date. */
export function datesIn(text: string): string[] {
  const out: string[] = [];
  const lower = text.normalize("NFKC").toLowerCase();
  const push = (iso: string | null) => {
    if (iso && !out.includes(iso)) out.push(iso);
  };
  for (const m of lower.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) push(isoDate(+m[1], +m[2], +m[3]));
  for (const m of lower.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g)) push(isoDate(+m[3], +m[1], +m[2]));
  for (const m of lower.matchAll(/\b([a-záéíóú]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const month = MONTHS[m[1]];
    if (month) push(isoDate(+m[3], month, +m[2]));
  }
  for (const m of lower.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:de\s+)?([a-záéíóú]+)\.?,?\s+(?:de\s+)?(\d{4})\b/g)) {
    const month = MONTHS[m[2]];
    if (month) push(isoDate(+m[3], month, +m[1]));
  }
  return out;
}

const DATE_KEYS = new Set(["date_of_birth", "referral_date", "effective_date"]);

const alnum = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/* ---------- The transcript as words, each with its segment ---------- */

interface Token {
  word: string;
  segment: number;
}

function tokenize(segments: TranscriptSegment[]): Token[] {
  const tokens: Token[] = [];
  segments.forEach((segment, index) => {
    for (const word of words(segment.text)) tokens.push({ word, segment: index });
  });
  return tokens;
}

/**
 * Finds the quoted words in the transcript, as one contiguous run of words,
 * and returns the audio window of the segments they span. Null when the words
 * are not there. The timestamps are the transcription's; the window is chosen
 * by the code.
 */
export function locateQuote(quote: string, segments: TranscriptSegment[]): { start: number; end: number } | null {
  const needle = words(quote);
  const tokens = tokenize(segments);
  const at = indexOfWords(
    needle,
    tokens.map((t) => t.word),
  );
  if (at === -1) return null;
  const span = tokens.slice(at, at + needle.length);
  return { start: segments[span[0].segment].start, end: segments[span[span.length - 1].segment].end };
}

/**
 * Reads what the transcription model answered. Segments that fall outside the
 * recording are dropped and counted; a segment that runs past the end is cut
 * at the end. Whether the recording was cut off is what the model reported:
 * the code does not detect that on its own.
 */
export function transcriptFromRaw(mediaId: string, raw: RawTranscript, durationSeconds?: number): Transcript {
  let outOfRange = 0;
  const segments = raw.segments
    .map((s) => ({ start: Math.max(0, s.start), end: Math.max(0, s.end), text: s.text.trim() }))
    .filter((s) => s.text.length > 0)
    .filter((s) => {
      if (durationSeconds !== undefined && durationSeconds > 0 && s.start >= durationSeconds) {
        outOfRange += 1;
        return false;
      }
      return true;
    })
    .map((s) => (durationSeconds !== undefined && durationSeconds > 0 ? { ...s, end: Math.min(s.end, durationSeconds) } : s))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const unusable = !raw.complete
    ? raw.note?.trim() || "The recording ends before the answer does."
    : segments.length === 0
      ? outOfRange > 0
        ? "No segment of the transcription fits inside the length of the recording."
        : "No usable speech was found in the recording."
      : null;
  return { mediaId, segments, unusable, ...(outOfRange > 0 ? { outOfRange } : {}) };
}

/* ---------- Days and places, as words that must be in the quote ---------- */

const DAY_WORDS: Record<Day, string[]> = {
  monday: ["monday", "mondays", "mon", "lunes"],
  tuesday: ["tuesday", "tuesdays", "tue", "tues", "martes"],
  wednesday: ["wednesday", "wednesdays", "wed", "miercoles", "miércoles"],
  thursday: ["thursday", "thursdays", "thu", "thur", "thurs", "jueves"],
  friday: ["friday", "fridays", "fri", "viernes"],
  saturday: ["saturday", "saturdays", "sat", "sabado", "sábado"],
  sunday: ["sunday", "sundays", "sun", "domingo"],
};

const PLACE_WORDS: Record<Place, string[]> = {
  home: ["home", "house", "casa", "hogar", "domicilio"],
  center: ["center", "centre", "clinic", "office", "centro", "clinica", "clínica", "oficina", "consultorio"],
  either: ["either", "both", "anywhere", "wherever", "cualquiera", "cualquier", "ambos", "dos", "donde", "sea"],
};

const KEY_LABELS: Record<RawClaim["key"], string> = {
  days_that_work: "days that work",
  days_that_do_not_work: "days that do not work",
  time_window: "the time window",
  location_preference: "the place",
  other: "a free statement",
};

export const clock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** Words that would make a statement clinical. Nothing clinical is assessed here, so such a statement is withheld. */
const CLINICAL = /\b(autis\w*|asd|diagnos\w*|disorder\w*|spectrum|symptom\w*|sever(?:e|ity)|meltdown\w*|tantrum\w*|aggress\w*|self[- ]?injur\w*|eligib\w*|therap\w*|medicat\w*|seizure\w*|adhd|anxiety|anxious|depress\w*|cognitive|developmental|delay\w*|non[- ]?verbal|regress\w*|sensory|prognos\w*|treatment|cur(?:e|es|ed|ing)|heal\w*|improv\w*|behavio\w*|hours (?:of|a|per) week|units)\b/i;

const ATTRIBUTION = /^(the (parent|family|guardian|caregiver) (states|says|said|reports|mentions|notes|explains|indicates) (that )?)/i;

/** True when the statement, without its attribution, is the quoted words themselves. */
function isVerbatim(statement: string, quote: string): boolean {
  const body = spokenForm(statement.replace(ATTRIBUTION, ""));
  return body.length > 0 && spokenForm(quote).includes(body);
}

/* ---------- The check ---------- */

type Hold = (key: string, label: string, page: number | undefined, reason: Withheld["reason"], detail: string) => void;

/** One block of a document as the model returned it, with its rank when the media came back in several blocks. */
interface DocumentBlock {
  block: RawDraft["documents"][number];
  rank: number;
  of: number;
}

function checkDocument(blocks: DocumentBlock[], source: DocumentSource, hold: Hold): DocumentExtraction {
  const passed: ExtractedField[] = [];
  for (const { block, rank, of } of blocks) {
    for (const field of block.fields) {
      const quote = field.quote.trim();
      const refuse = (reason: Withheld["reason"], detail: string) => hold(field.key, field.label, field.page, reason, detail);
      if (!quote) {
        refuse("no_source", `"${field.label}" came with no passage to check.`);
        continue;
      }
      const pageText = source.pages[field.page];
      if (!pageText || !quoteIsOnPage(quote, pageText)) {
        refuse("quote_not_found", `"${field.label}": the quoted passage is not on page ${field.page}.`);
        continue;
      }
      const checked = [`passage found on page ${field.page}`];
      if (of > 1) checked.push(`proposed in block ${rank} of ${of} the draft returned for this document`);
      const value = field.value.trim();
      if (!wordsContiguous(words(value), words(quote))) {
        refuse("value_not_in_quote", `"${field.label}": the value "${value}" is not in the quoted passage as one run of words.`);
        continue;
      }
      checked.push("value found in the passage, as one run of words");
      let normalized = field.normalized?.trim() || null;
      if (DATE_KEYS.has(field.key)) {
        const written = datesIn(value);
        if (normalized) {
          if (!written.includes(normalized)) {
            refuse(
              "normalized_mismatch",
              `"${field.label}": the machine-form date ${normalized} is not the date written in the value "${value}"${written.length ? ` (which reads ${written.join(", ")})` : " (no calendar date the code can read)"}.`,
            );
            continue;
          }
          checked.push(`date ${normalized} is the date written in the value`);
        } else if (written.length === 1) {
          normalized = written[0];
          checked.push(`date ${normalized} read from the value by the code`);
        } else {
          checked.push("no machine-form date: the rule will say it cannot be assessed");
        }
      } else if (normalized && alnum(normalized) !== alnum(value)) {
        checked.push(`machine form "${normalized}" dropped: it does not match the value`);
        normalized = null;
      }
      passed.push({ key: field.key, label: field.label, value, normalized, page: field.page, quote, uncertain: field.uncertain?.trim() || null, checked });
    }
  }
  // Two fields with the same key are one field. The raw shape does not forbid the repeat; the review must never carry two propositions with one id.
  const fields: ExtractedField[] = [];
  for (const field of passed) {
    const first = fields.find((f) => f.key === field.key);
    if (!first) {
      fields.push(field);
      continue;
    }
    if (alnum(first.value) === alnum(field.value)) {
      first.checked.push(`proposed again with the same value (page ${field.page}): merged into this field`);
      // An uncertainty on either reading makes the merged field uncertain: a merge never loses a doubt.
      if (field.uncertain) {
        first.uncertain = first.uncertain ? `${first.uncertain} ${field.uncertain}` : field.uncertain;
        first.checked.push("the repeated reading was marked uncertain: the merged field is uncertain");
      }
      continue;
    }
    const other: ConflictingValue = { value: field.value, normalized: field.normalized, page: field.page, quote: field.quote, uncertain: field.uncertain, checked: field.checked };
    first.conflict = [...(first.conflict ?? []), other];
    first.checked.push(`another value was proposed for the same field, "${field.value}" (page ${field.page}): both are kept, neither is chosen`);
  }
  const readable = blocks.some(({ block }) => block.readable);
  const unreadableReason = readable ? null : blocks.map(({ block }) => block.unreadableReason?.trim() || "").find(Boolean) || null;
  const mediaId = blocks[0].block.mediaId;
  return { mediaId, readable, unreadableReason, fields, ...(blocks.length > 1 ? { blocks: blocks.length } : {}) };
}

function checkClaim(claim: RawClaim, source: RecordingSource, hold: (reason: Withheld["reason"], detail: string) => void, block: { rank: number; of: number }): RecordingClaim | null {
  const quote = claim.quote.trim();
  if (!quote) {
    hold("no_source", `"${claim.label}" came with no words to check.`);
    return null;
  }
  const located = locateQuote(quote, source.transcript.segments);
  if (!located) {
    const dropped = source.transcript.outOfRange;
    hold(
      "segment_not_found",
      `"${claim.label}": the quoted words are not in the transcript${dropped ? ` (${dropped} transcription segment${dropped === 1 ? "" : "s"} fell outside the recording and ${dropped === 1 ? "was" : "were"} dropped)` : ""}.`,
    );
    return null;
  }
  const duration = source.durationSeconds;
  if (located.start < 0 || located.end <= located.start || (duration > 0 && located.end > duration)) {
    hold("segment_out_of_range", `"${claim.label}": the audio window ${located.start}s to ${located.end}s does not fit a recording of ${duration}s.`);
    return null;
  }
  const checked = [`quoted words found in the recording at ${located.start.toFixed(1)}s to ${located.end.toFixed(1)}s`];
  if (block.of > 1) checked.push(`proposed in block ${block.rank} of ${block.of} the draft returned for this recording`);
  const clinical = [claim.statement, claim.label, claim.uncertain ?? ""].join(" ").match(CLINICAL);
  if (clinical) {
    hold("clinical_content", `"${claim.label}": the statement goes beyond scheduling and administrative facts ("${clinical[0]}"). Nothing clinical is assessed here.`);
    return null;
  }
  if (claim.key === "other") {
    hold("free_statement", `"${claim.label}": a free statement is not assessed by the code. The quoted words are "${quote}"; the reviewer reads them.`);
    return null;
  }

  // What the model structured must be in the quoted words: a day, a place. An hour must be an hour of the day. Nothing more is read.
  const quoted = words(quote);
  const listed = KEY_LABELS[claim.key];
  for (const day of claim.days) {
    if (!DAY_WORDS[day].some((w) => quoted.includes(w))) {
      hold("structured_not_in_quote", `"${claim.label}": ${day} is not in the quoted words.`);
      return null;
    }
    checked.push(`${day} is in the quoted words; listed under ${listed} as extracted, not established by the code`);
  }
  if (claim.days.length === 0 && (claim.key === "days_that_work" || claim.key === "days_that_do_not_work")) checked.push("no day in the structured part");
  if (claim.earliestHour !== null) {
    if (!Number.isInteger(claim.earliestHour) || claim.earliestHour < 0 || claim.earliestHour > 23) {
      hold("structured_not_in_quote", `"${claim.label}": ${claim.earliestHour} is not an hour of the day.`);
      return null;
    }
    checked.push(`earliest hour ${clock(claim.earliestHour)} as extracted by the model; the code reads no hour from the words`);
  } else if (claim.key === "time_window") checked.push("no hour in the structured part");
  if (claim.location !== null) {
    if (!PLACE_WORDS[claim.location].some((w) => quoted.includes(w))) {
      hold("structured_not_in_quote", `"${claim.label}": the place "${claim.location}" is not in the quoted words.`);
      return null;
    }
    checked.push(`place "${claim.location}" is in the quoted words; listed as extracted, not established by the code`);
  } else if (claim.key === "location_preference") checked.push("no place in the structured part");

  const verbatim = isVerbatim(claim.statement, quote);
  const nature = claim.nature === "extraction" && !verbatim ? "rephrase" : claim.nature;
  if (nature === "extraction") checked.push("the statement is the quoted words");
  else checked.push("the wording is the model's, not the quoted words: judge it against the recording");

  return {
    key: claim.key,
    label: claim.label,
    statement: claim.statement.trim(),
    nature,
    segment: { start: located.start, end: located.end },
    quote,
    days: [...claim.days],
    earliestHour: claim.earliestHour,
    location: claim.location,
    uncertain: claim.uncertain?.trim() || null,
    checked,
  };
}

/** Groups the blocks of a raw list by mediaId, in order of first appearance: several blocks for one media are one media. */
function groupByMedia<T extends { mediaId: string }>(list: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of list) {
    const group = groups.get(item.mediaId);
    if (group) group.push(item);
    else groups.set(item.mediaId, [item]);
  }
  return groups;
}

export function verifyDraft(
  raw: RawDraft,
  sources: { documents: DocumentSource[]; recordings: RecordingSource[] },
  meta: { origin: Draft["origin"]; computedAt: string; transcriptReused?: boolean },
): Draft {
  const withheld: Withheld[] = [];
  const documents: DocumentExtraction[] = [];
  const recordings: RecordingReview[] = [];

  for (const [mediaId, blocks] of groupByMedia(raw.documents)) {
    const source = sources.documents.find((d) => d.mediaId === mediaId);
    if (!source) {
      withheld.push({ mediaId, key: "*", label: "Document", reason: "unknown_media", detail: `The draft names a document this file does not hold ("${mediaId}"${blocks.length > 1 ? `, ${blocks.length} times` : ""}).` });
      continue;
    }
    documents.push(
      checkDocument(
        blocks.map((block, index) => ({ block, rank: index + 1, of: blocks.length })),
        source,
        (key, label, page, reason, detail) => withheld.push({ mediaId, key, label, page, reason, detail }),
      ),
    );
  }

  for (const [mediaId, blocks] of groupByMedia(raw.recordings)) {
    const source = sources.recordings.find((r) => r.mediaId === mediaId);
    if (!source) {
      withheld.push({ mediaId, key: "*", label: "Recording", reason: "unknown_media", detail: `The draft names a recording this file does not hold ("${mediaId}"${blocks.length > 1 ? `, ${blocks.length} times` : ""}).` });
      continue;
    }
    const claims: RecordingClaim[] = [];
    blocks.forEach((block, index) => {
      for (const claim of block.claims) {
        const kept = checkClaim(claim, source, (reason, detail) => withheld.push({ mediaId, key: claim.key, label: claim.label, reason, detail }), { rank: index + 1, of: blocks.length });
        if (kept) claims.push(kept);
      }
    });
    recordings.push({ mediaId, transcript: source.transcript, claims, ...(blocks.length > 1 ? { blocks: blocks.length } : {}) });
  }

  // A recording the models did not answer for still exists: its transcript is kept.
  for (const source of sources.recordings) {
    if (!recordings.some((r) => r.mediaId === source.mediaId)) {
      recordings.push({ mediaId: source.mediaId, transcript: source.transcript, claims: [] });
    }
  }

  return {
    origin: meta.origin,
    computedAt: meta.computedAt,
    media: [...sources.documents.map((d) => d.mediaId), ...sources.recordings.map((r) => r.mediaId)],
    ...(meta.transcriptReused ? { transcriptReused: true } : {}),
    documents,
    recordings,
    withheld,
  };
}
