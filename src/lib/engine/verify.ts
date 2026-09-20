/**
 * Turns a raw model draft into a Draft the page can show.
 *
 * A field must quote a passage that exists on the page it names, its value
 * must be in that passage, and a machine-form date must match a date written
 * in the passage. A claim must quote words that exist in the transcript; its
 * audio window is located by the code from those words inside the timestamps
 * the transcription returned, and checked against the length of the recording;
 * the days, hour and place it carries must be in the quoted words, with the
 * negation kept; a free statement must stay administrative and be supported
 * by its quote. Anything that fails is withheld, listed, and never shown as a
 * finding. A claim with no source at all is refused the same way.
 *
 * What the code cannot check is the wording of a rephrase: the claim says so,
 * and the reviewer judges it against the recording.
 */
import type { RawDraft, RawTranscript } from "./raw";
import type { Day, Draft, DocumentExtraction, ExtractedField, RecordingClaim, RecordingReview, Transcript, TranscriptSegment, Withheld } from "./types";

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

/** Strips punctuation for a looser comparison of spoken words. */
export function spokenForm(text: string): string {
  return normalize(text)
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words of a text, lowercased, without punctuation. */
export function words(text: string): string[] {
  return spokenForm(text).replace(/'/g, " ").split(" ").filter(Boolean);
}

/** True when every word of needle appears in hay, in the same order. */
export function wordsInOrder(needle: string[], hay: string[]): boolean {
  if (needle.length === 0) return false;
  let at = 0;
  for (const word of needle) {
    const found = hay.indexOf(word, at);
    if (found === -1) return false;
    at = found + 1;
  }
  return true;
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

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000 || year > 9999) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Every calendar date written in a text, in ISO form, in order of appearance. */
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

/* ---------- Audio windows ---------- */

/**
 * Finds the transcript segments that carry the quoted words, in order, and
 * returns the audio window they span. Null when the words are not there. The
 * timestamps are the transcription's; the window is chosen by the code.
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

/* ---------- Days, hours, places and negations in spoken words ---------- */

const DAY_WORDS: Record<Day, string[]> = {
  monday: ["monday", "mondays", "mon", "lunes"],
  tuesday: ["tuesday", "tuesdays", "tue", "tues", "martes"],
  wednesday: ["wednesday", "wednesdays", "wed", "miercoles", "miércoles"],
  thursday: ["thursday", "thursdays", "thu", "thur", "thurs", "jueves"],
  friday: ["friday", "fridays", "fri", "viernes"],
  saturday: ["saturday", "saturdays", "sat", "sabado", "sábado"],
  sunday: ["sunday", "sundays", "sun", "domingo"],
};

const NEGATIONS = new Set([
  "not", "no", "never", "cannot", "except", "impossible", "unable", "avoid", "without",
  "nunca", "tampoco", "excepto", "imposible", "jamas", "jamás",
]);

/** Clauses of a quote: the pieces between commas, periods and the like, as word lists. */
function clauses(quote: string): string[][] {
  return normalize(quote)
    .split(/[,.;:!?()]+|\bbut\b|\bpero\b/)
    .map((piece) => words(piece))
    .filter((piece) => piece.length > 0);
}

function mentionsDay(piece: string[], day: Day): boolean {
  return piece.some((w) => DAY_WORDS[day].includes(w));
}

function negated(piece: string[]): boolean {
  return piece.some((w) => NEGATIONS.has(w) || w.endsWith("n't") || w === "dont" || w === "doesnt" || w === "cant" || w === "wont" || w === "isnt" || w === "arent");
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  noon: 12, midday: 12, midnight: 0,
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, mediodia: 12, mediodía: 12,
};

/** True when the hour (24-hour) is named in the words, as a digit or a number word, on the 12-hour clock. */
function hourNamed(quote: string, hour: number): boolean {
  const target = ((hour % 12) + 12) % 12;
  for (const w of words(quote)) {
    const digits = w.match(/^(\d{1,2})(?::\d{2})?(am|pm)?$/);
    if (digits && Number(digits[1]) % 12 === target) return true;
    if (w in NUMBER_WORDS && NUMBER_WORDS[w] % 12 === target) return true;
  }
  return false;
}

const PLACE_WORDS: Record<"home" | "center" | "either", string[]> = {
  home: ["home", "house", "casa", "hogar", "domicilio"],
  center: ["center", "centre", "clinic", "office", "centro", "clinica", "clínica", "oficina", "consultorio"],
  either: ["either", "both", "anywhere", "wherever", "cualquiera", "cualquier", "ambos", "dos", "donde", "sea"],
};

function placeNamed(quote: string, place: "home" | "center" | "either"): boolean {
  const list = words(quote);
  return PLACE_WORDS[place].some((w) => list.includes(w));
}

/** Words that would make a statement clinical. Nothing clinical is assessed here, so such a statement is withheld. */
const CLINICAL = /\b(autis\w*|asd|diagnos\w*|disorder\w*|spectrum|symptom\w*|sever(?:e|ity)|meltdown\w*|tantrum\w*|aggress\w*|self[- ]?injur\w*|eligib\w*|therap\w*|medicat\w*|seizure\w*|adhd|anxiety|anxious|depress\w*|cognitive|developmental|delay\w*|non[- ]?verbal|regress\w*|sensory|prognos\w*|treatment|hours (?:of|a|per) week|units)\b/i;

const ATTRIBUTION = /^(the (parent|family|guardian|caregiver) (states|says|said|reports|mentions|notes|explains|indicates) (that )?)/i;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "at", "is", "are", "be", "that", "this", "it", "its", "they", "their", "we", "our", "us",
  "if", "so", "as", "with", "would", "rather", "do", "does", "did", "have", "has", "will", "can", "any", "some", "there", "here", "about", "from",
]);

function contentWords(text: string): string[] {
  return words(text.replace(ATTRIBUTION, "")).filter((w) => !STOPWORDS.has(w) && w.length > 1);
}

function stem(w: string): string {
  return w.length > 5 ? w.slice(0, 5) : w.replace(/s$/, "");
}

/** Share of the statement's content words that are in the quoted words, on a crude stem. */
export function statementSupport(statement: string, quote: string): number {
  const content = contentWords(statement);
  if (content.length === 0) return 0;
  const quoted = new Set(words(quote).map(stem));
  const found = content.filter((w) => quoted.has(stem(w))).length;
  return found / content.length;
}

/** True when the statement, without its attribution, is the quoted words themselves. */
function isVerbatim(statement: string, quote: string): boolean {
  const body = spokenForm(statement.replace(ATTRIBUTION, ""));
  return body.length > 0 && spokenForm(quote).includes(body);
}

/* ---------- The check ---------- */

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
      withheld.push({ mediaId: doc.mediaId, key: "*", label: "Document", reason: "unknown_media", detail: "The draft names a document this file does not hold." });
      continue;
    }
    const fields: ExtractedField[] = [];
    for (const field of doc.fields) {
      const quote = field.quote.trim();
      const hold = (reason: Withheld["reason"], detail: string) =>
        withheld.push({ mediaId: doc.mediaId, key: field.key, label: field.label, page: field.page, reason, detail });
      if (!quote) {
        hold("no_source", `"${field.label}" came with no passage to check.`);
        continue;
      }
      const pageText = source.pages[field.page];
      if (!pageText || !quoteIsOnPage(quote, pageText)) {
        hold("quote_not_found", `"${field.label}": the quoted passage is not on page ${field.page}.`);
        continue;
      }
      const checked = [`passage found on page ${field.page}`];
      const value = field.value.trim();
      if (!wordsInOrder(words(value), words(quote))) {
        hold("value_not_in_quote", `"${field.label}": the value "${value}" is not in the quoted passage "${quote}".`);
        continue;
      }
      checked.push("value found in the passage");
      let normalized = field.normalized?.trim() || null;
      if (DATE_KEYS.has(field.key)) {
        const written = datesIn(quote);
        if (normalized) {
          if (!written.includes(normalized)) {
            hold("normalized_mismatch", `"${field.label}": the machine-form date ${normalized} does not match the passage "${quote}"${written.length ? ` (which reads ${written.join(", ")})` : ""}.`);
            continue;
          }
          checked.push(`date ${normalized} matches the passage`);
        } else if (written.length === 1) {
          normalized = written[0];
          checked.push(`date ${normalized} read from the passage by the code`);
        } else {
          checked.push("no machine-form date: the rule will say it cannot be assessed");
        }
      } else if (normalized && alnum(normalized) !== alnum(value)) {
        checked.push(`machine form "${normalized}" dropped: it does not match the value`);
        normalized = null;
      }
      fields.push({
        key: field.key,
        label: field.label,
        value,
        normalized,
        page: field.page,
        quote,
        uncertain: field.uncertain?.trim() || null,
        checked,
      });
    }
    documents.push({ mediaId: doc.mediaId, readable: doc.readable, unreadableReason: doc.unreadableReason?.trim() || null, fields });
  }

  for (const rec of raw.recordings) {
    const source = sources.recordings.find((r) => r.mediaId === rec.mediaId);
    if (!source) {
      withheld.push({ mediaId: rec.mediaId, key: "*", label: "Recording", reason: "unknown_media", detail: "The draft names a recording this file does not hold." });
      continue;
    }
    const claims: RecordingClaim[] = [];
    for (const claim of rec.claims) {
      const quote = claim.quote.trim();
      const hold = (reason: Withheld["reason"], detail: string) => withheld.push({ mediaId: rec.mediaId, key: claim.key, label: claim.label, reason, detail });
      if (!quote) {
        hold("no_source", `"${claim.label}" came with no words to check.`);
        continue;
      }
      const segment = locateQuote(quote, source.transcript.segments);
      if (!segment) {
        hold("segment_not_found", `"${claim.label}": the quoted words are not in the transcript${source.transcript.outOfRange ? ` (${source.transcript.outOfRange} transcription segment${source.transcript.outOfRange === 1 ? "" : "s"} fell outside the recording and ${source.transcript.outOfRange === 1 ? "was" : "were"} dropped)` : ""}.`);
        continue;
      }
      const duration = source.durationSeconds;
      if (segment.start < 0 || segment.end <= segment.start || (duration > 0 && segment.end > duration)) {
        hold("segment_out_of_range", `"${claim.label}": the audio window ${segment.start}s to ${segment.end}s does not fit a recording of ${duration}s.`);
        continue;
      }
      const checked = [`quoted words found in the recording at ${segment.start.toFixed(1)}s to ${segment.end.toFixed(1)}s`];
      const clinical = [claim.statement, claim.label, claim.uncertain ?? ""].join(" ").match(CLINICAL);
      if (clinical) {
        hold("clinical_content", `"${claim.label}": the statement goes beyond scheduling and administrative facts ("${clinical[0]}"). Nothing clinical is assessed here.`);
        continue;
      }
      const pieces = clauses(quote);
      let refused: string | null = null;
      let days: Day[] = [];
      let earliestHour: number | null = null;
      let location: RecordingClaim["location"] = null;

      if (claim.key === "days_that_work" || claim.key === "days_that_do_not_work") {
        const wantNegation = claim.key === "days_that_do_not_work";
        for (const day of claim.days) {
          const mentioning = pieces.filter((piece) => mentionsDay(piece, day));
          if (mentioning.length === 0) {
            refused = `structured_not_in_quote:${day} is not named in the quoted words`;
            break;
          }
          const negatedMention = mentioning.some(negated);
          if (wantNegation && !negatedMention) {
            refused = `negation_mismatch:the quoted words do not say that ${day} does not work`;
            break;
          }
          if (!wantNegation && negatedMention) {
            refused = `negation_mismatch:the quoted words negate ${day}`;
            break;
          }
          checked.push(`${day} named in the quoted words, ${negatedMention ? "with a negation" : "with no negation"}`);
        }
        days = [...claim.days];
        if (claim.days.length === 0) checked.push("no day named in the structured part");
        if (claim.earliestHour !== null && hourNamed(quote, claim.earliestHour)) {
          earliestHour = claim.earliestHour;
          checked.push(`hour ${claim.earliestHour}:00 named in the quoted words`);
        } else if (claim.earliestHour !== null) checked.push(`hour ${claim.earliestHour}:00 dropped: not in the quoted words`);
        if (claim.location && placeNamed(quote, claim.location)) location = claim.location;
      } else if (claim.key === "time_window") {
        if (claim.earliestHour !== null) {
          if (!hourNamed(quote, claim.earliestHour)) refused = `structured_not_in_quote:the hour ${claim.earliestHour}:00 is not named in the quoted words`;
          else {
            earliestHour = claim.earliestHour;
            checked.push(`hour ${claim.earliestHour}:00 named in the quoted words`);
          }
        } else checked.push("no hour in the structured part: the rule will say it cannot compare");
        days = claim.days.filter((day) => pieces.some((piece) => mentionsDay(piece, day)));
        if (days.length < claim.days.length) checked.push("days not named in the quoted words dropped");
      } else if (claim.key === "location_preference") {
        if (claim.location !== null) {
          if (!placeNamed(quote, claim.location)) refused = `structured_not_in_quote:the place "${claim.location}" is not named in the quoted words`;
          else {
            location = claim.location;
            checked.push(`place "${claim.location}" named in the quoted words`);
          }
        } else checked.push("no place in the structured part: the rule will say it cannot compare");
      } else {
        const support = statementSupport(claim.statement, quote);
        if (support < 0.5) refused = `statement_unsupported:the quoted words support ${Math.round(support * 100)}% of the statement`;
        else checked.push(`${Math.round(support * 100)}% of the statement's words are in the quoted words`);
      }

      if (refused) {
        const colon = refused.indexOf(":");
        const reason = refused.slice(0, colon) as Withheld["reason"];
        const detail = refused.slice(colon + 1);
        hold(reason, `"${claim.label}": ${detail}.`);
        continue;
      }

      const verbatim = isVerbatim(claim.statement, quote);
      const nature = claim.nature === "extraction" && !verbatim ? "rephrase" : claim.nature;
      if (nature === "extraction") checked.push("the statement is the quoted words");
      else checked.push("the wording is the model's, not the quoted words: judge it against the recording");

      claims.push({
        key: claim.key,
        label: claim.label,
        statement: claim.statement.trim(),
        nature,
        segment,
        quote,
        days,
        earliestHour,
        location,
        uncertain: claim.uncertain?.trim() || null,
        checked,
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
