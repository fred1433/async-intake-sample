/**
 * Turns a raw model draft into a Draft the page can show.
 *
 * A field must quote a passage that exists on the page it names, its value
 * must be in that passage as one contiguous run of words, and a machine-form
 * date must be the date written in the value, on a real calendar. Two fields
 * with the same key are one field: merged when they carry the same value,
 * kept as one field with its conflicting values when they do not. A claim
 * must quote words that exist in the transcript; its audio window is located
 * by the code from those words inside the timestamps the transcription
 * returned, and checked against the length of the recording. The days, hour
 * and place it carries are checked in the source clause the quoted words come
 * from, not only in the words the model chose to quote, so a negation the
 * quote left out still counts. An hour is named only when the words give its
 * value, AM or PM, and "from", with no minutes: anything less is kept as
 * something to confirm. What a clause explicitly denies (a day, a start hour,
 * a place, with a negation in that same clause) is recorded as such: it is
 * the only ground on which the review says that two sources disagree. Named
 * is never established: no availability is concluded from the words. A free
 * statement (other) is never assessed: it is listed for the reviewer.
 * Anything that fails is withheld, listed, and never shown as a finding. A
 * claim with no source at all is refused the same way.
 *
 * What the code cannot check is the wording of a rephrase: the claim says so,
 * and the reviewer judges it against the recording.
 */
import type { RawClaim, RawDraft, RawTranscript } from "./raw";
import type { ConflictingValue, Day, Denied, Draft, DocumentExtraction, ExtractedField, Place, RecordingClaim, RecordingReview, Transcript, TranscriptSegment, Withheld } from "./types";

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

/* ---------- The transcript as tokens, with their segment and their clause ---------- */

interface Token {
  word: string;
  segment: number;
  clause: number;
}

/** How a clause began: at punctuation, at a segment boundary of the transcription, or at "but" / "pero", kept as its first word. */
type Break = "punct" | "segment" | "conjunction";

interface Tokenized {
  tokens: Token[];
  /** By clause id. */
  breaks: Break[];
}

/** Punctuation that closes a clause: everything but the colon of a clock time. */
const PUNCT_BREAK = /[,.;!?()]+|(?<!\d):|:(?!\d)/;
/** Words that open a clause and stay in it, so the quoted words still match the transcript. */
const CONJUNCTIONS = new Set(["but", "pero"]);

function tokenize(segments: TranscriptSegment[]): Tokenized {
  const tokens: Token[] = [];
  const breaks: Break[] = [];
  let clause = -1;
  const open = (kind: Break) => {
    clause += 1;
    breaks[clause] = kind;
  };
  segments.forEach((segment, index) => {
    const text = normalize(segment.text).replace(/\b([ap])\.\s?m\.?(?=[\s,.;!?)]|$)/g, "$1m");
    let first = true;
    for (const piece of text.split(PUNCT_BREAK)) {
      const list = words(piece);
      if (list.length === 0) continue;
      open(first ? "segment" : "punct");
      first = false;
      for (const word of list) {
        const clauseHasWords = tokens.length > 0 && tokens[tokens.length - 1].clause === clause;
        if (CONJUNCTIONS.has(word) && clauseHasWords) open("conjunction");
        tokens.push({ word, segment: index, clause });
      }
    }
  });
  return { tokens, breaks };
}

/** The words of one clause. */
function clauseWords(tokenized: Tokenized, clause: number): string[] {
  return tokenized.tokens.filter((t) => t.clause === clause).map((t) => t.word);
}

/**
 * True when a token can be read together with the clause it follows or
 * precedes: only a break made by the transcription's segments joins, since a
 * segment is a timestamp, not a grammatical unit. Punctuation and "but" do not.
 */
function joined(tokenized: Tokenized, fromClause: number, toClause: number): boolean {
  const [low, high] = fromClause <= toClause ? [fromClause, toClause] : [toClause, fromClause];
  for (let c = low + 1; c <= high; c++) if (tokenized.breaks[c] !== "segment") return false;
  return true;
}

export interface LocatedQuote {
  start: number;
  end: number;
  /** The full clauses the quoted words come from, as word lists: what the parent said around the quote. */
  clauses: string[][];
  /** The clauses by id in the tokenized transcript, for the hour reading that looks across a segment boundary. */
  context: { tokenized: Tokenized; clauseIds: number[] };
}

/**
 * Finds the quoted words in the transcript, as one contiguous run of words,
 * and returns the audio window of the segments they span and the clauses they
 * come from. Null when the words are not there. The timestamps are the
 * transcription's; the window is chosen by the code.
 */
export function locateWords(quote: string, segments: TranscriptSegment[]): LocatedQuote | null {
  const needle = words(quote);
  const tokenized = tokenize(segments);
  const { tokens } = tokenized;
  const at = indexOfWords(
    needle,
    tokens.map((t) => t.word),
  );
  if (at === -1) return null;
  const span = tokens.slice(at, at + needle.length);
  const first = span[0].segment;
  const last = span[span.length - 1].segment;
  const clauseIds = [...new Set(span.map((t) => t.clause))];
  const clauses = clauseIds.map((id) => clauseWords(tokenized, id));
  return { start: segments[first].start, end: segments[last].end, clauses, context: { tokenized, clauseIds } };
}

export function locateQuote(quote: string, segments: TranscriptSegment[]): { start: number; end: number } | null {
  const located = locateWords(quote, segments);
  return located ? { start: located.start, end: located.end } : null;
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

/* ---------- Days, hours, places and negations in the spoken clauses ---------- */

const DAY_WORDS: Record<Day, string[]> = {
  monday: ["monday", "mondays", "mon", "lunes"],
  tuesday: ["tuesday", "tuesdays", "tue", "tues", "martes"],
  wednesday: ["wednesday", "wednesdays", "wed", "miercoles", "miércoles"],
  thursday: ["thursday", "thursdays", "thu", "thur", "thurs", "jueves"],
  friday: ["friday", "fridays", "fri", "viernes"],
  saturday: ["saturday", "saturdays", "sat", "sabado", "sábado"],
  sunday: ["sunday", "sundays", "sun", "domingo"],
};

const ALL_DAYS = Object.keys(DAY_WORDS) as Day[];

const NEGATIONS = new Set([
  "not", "no", "never", "cannot", "except", "impossible", "unable", "avoid", "without", "neither", "nor",
  "dont", "doesnt", "cant", "wont", "isnt", "arent", "couldnt", "wouldnt", "shouldnt",
  "nunca", "tampoco", "excepto", "imposible", "jamas", "jamás", "ni", "sin",
]);

/** Phrases whose "no" or "not" affirms rather than negates: "no problem with Tuesdays" says that Tuesday works. */
const NEGATION_EXCEPTIONS: string[][] = [
  ["no", "problem"],
  ["no", "problems"],
  ["no", "issue"],
  ["no", "issues"],
  ["no", "trouble"],
  ["not", "a", "problem"],
  ["not", "an", "issue"],
  ["sin", "problema"],
  ["sin", "problemas"],
  ["ningun", "problema"],
  ["ningún", "problema"],
  ["no", "hay", "problema"],
];

function mentionsDay(clause: string[], day: Day): boolean {
  return clause.some((w) => DAY_WORDS[day].includes(w));
}

/** The clause without the phrases that only look like negations. */
function withoutExceptions(clause: string[]): string[] {
  const out = [...clause];
  for (const phrase of NEGATION_EXCEPTIONS) {
    let at = indexOfWords(phrase, out);
    while (at !== -1) {
      out.splice(at, phrase.length);
      at = indexOfWords(phrase, out);
    }
  }
  return out;
}

/** True when the clause carries a negation of its own: a negation word in this clause, not in the one before the comma or the segment boundary. */
function negated(clause: string[]): boolean {
  return withoutExceptions(clause).some((w) => NEGATIONS.has(w) || w.endsWith("n't"));
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};

const FROM_WORDS = new Set(["after", "from", "starting", "past", "beginning", "onwards", "onward", "desde", "después", "despues", "partir", "luego"]);
const BEFORE_WORDS = new Set(["before", "until", "till", "by", "antes", "hasta"]);
/** "at" and its Spanish "a"; the articles "las" and "la" are not relations. */
const AT_WORDS = new Set(["at", "around", "about", "a", "alrededor"]);

export interface HourMention {
  /** The words the hour was read from, as spoken. */
  text: string;
  /** 0 to 11: the value on a 12-hour clock. */
  hour12: number;
  /** The 24-hour value when AM or PM (or a 24-hour figure) is in the words; null when the period is not said. */
  hour24: number | null;
  /** Minutes as spoken: "3:30 pm" is not 15:00. */
  minutes: number;
  relation: "from" | "before" | "at" | null;
  /** The clause the hour sits in carries a negation of its own. */
  negated: boolean;
}

const PERIOD_PATTERNS: { re: RegExp; period: "am" | "pm"; length: number }[] = [
  { re: /^am\b/, period: "am", length: 1 },
  { re: /^pm\b/, period: "pm", length: 1 },
  { re: /^a m\b/, period: "am", length: 2 },
  { re: /^p m\b/, period: "pm", length: 2 },
  { re: /^in the morning\b/, period: "am", length: 3 },
  { re: /^de la (mañana|manana)\b/, period: "am", length: 3 },
  { re: /^in the (afternoon|evening)\b/, period: "pm", length: 3 },
  { re: /^de la (tarde|noche)\b/, period: "pm", length: 3 },
  { re: /^at night\b/, period: "pm", length: 2 },
  { re: /^tonight\b/, period: "pm", length: 1 },
];

/**
 * Every clock hour named in a clause, with what the words say about its
 * period, its minutes and its relation. The words after the hour (its AM or
 * PM) and before it (its "from") are read across a boundary the transcription
 * drew between two segments, never across punctuation or "but".
 */
export function hourMentions(tokenized: Tokenized, clause: number): HourMention[] {
  const { tokens } = tokenized;
  const out: HourMention[] = [];
  const isNegated = negated(clauseWords(tokenized, clause));
  tokens.forEach((token, i) => {
    if (token.clause !== clause) return;
    const word = token.word;
    let value: number | null = null;
    let period: "am" | "pm" | null = null;
    let minutes = 0;
    const digits = word.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
    if (digits) {
      const h = Number(digits[1]);
      minutes = digits[2] !== undefined ? Number(digits[2]) : 0;
      // A lone "00" or "30" is a minute figure, not an hour; anything past 23 is not a clock hour.
      if (digits[1].length === 2 && digits[1].startsWith("0") && digits[2] === undefined && !digits[3]) return;
      if (h > 23 || minutes > 59) return;
      value = h;
      if (digits[3]) period = digits[3] as "am" | "pm";
      else if (h > 12 || h === 0) period = h >= 12 ? "pm" : "am";
    } else if (word === "noon" || word === "midday" || word === "mediodia" || word === "mediodía") {
      value = 12;
      period = "pm";
    } else if (word === "midnight" || word === "medianoche") {
      value = 0;
      period = "am";
    } else if (word in NUMBER_WORDS) {
      // "once" is Spanish for eleven and an English adverb: only count it after "las" or "la".
      const two = tokens.slice(Math.max(0, i - 2), i).map((t) => t.word);
      if (word === "once" && !two.some((w) => w === "las" || w === "la")) return;
      value = NUMBER_WORDS[word];
    }
    if (value === null) return;
    // Up to five words after the hour, and four before, as long as only a segment boundary separates them from it.
    let after = tokens.slice(i + 1, i + 6).filter((t) => joined(tokenized, clause, t.clause)).map((t) => t.word);
    const before = tokens
      .slice(Math.max(0, i - 4), i)
      .filter((t) => joined(tokenized, t.clause, clause))
      .map((t) => t.word);
    const extra: string[] = [];
    if (after[0] === "o'clock" || after[0] === "oclock") {
      extra.push(after[0]);
      after = after.slice(1);
    }
    if (!period) {
      const next = after.join(" ");
      const match = PERIOD_PATTERNS.find((p) => p.re.test(next));
      if (match) {
        period = match.period;
        extra.push(...after.slice(0, match.length));
      }
    }
    let relation: HourMention["relation"] = null;
    for (let j = before.length - 1; j >= 0 && relation === null; j--) {
      const w = before[j];
      if (FROM_WORDS.has(w)) relation = "from";
      else if (BEFORE_WORDS.has(w)) relation = "before";
      else if (AT_WORDS.has(w)) relation = "at";
    }
    const hour12 = value % 12;
    const hour24 = period === null ? null : period === "pm" ? hour12 + 12 : hour12;
    out.push({ text: [word, ...extra].join(" "), hour12, hour24, minutes, relation, negated: isNegated });
  });
  return out;
}

export type HourCheck =
  | { status: "named"; mention: HourMention }
  | { status: "negated"; mention: HourMention }
  | { status: "period_missing"; mention: HourMention }
  | { status: "relation_missing"; mention: HourMention }
  | { status: "minutes_named"; mention: HourMention }
  | { status: "not_earliest"; mention: HourMention }
  | { status: "period_mismatch"; mention: HourMention }
  | { status: "not_named" }
  | { status: "invalid" };

/**
 * What the spoken clauses say about a 24-hour earliest hour the model
 * structured. "named" means value, AM or PM, and "from" are all in the words,
 * with no minutes and no negation in the clause: the hour was said, which
 * does not make it established as working.
 */
export function checkHour(hour: number, mentions: HourMention[]): HourCheck {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { status: "invalid" };
  const exact = mentions.find((m) => m.hour24 === hour && m.minutes === 0);
  const withMinutes = mentions.find((m) => m.hour24 === hour && m.minutes !== 0);
  const ambiguous = mentions.find((m) => m.hour24 === null && m.hour12 === hour % 12);
  const mismatch = mentions.find((m) => m.hour24 !== null && m.hour24 !== hour && m.hour12 === hour % 12);
  const mention = exact ?? withMinutes ?? ambiguous;
  if (!mention) return mismatch ? { status: "period_mismatch", mention: mismatch } : { status: "not_named" };
  if (mention.relation === "before") return { status: "not_earliest", mention };
  if (mention.hour24 === null) return { status: "period_missing", mention };
  if (mention.minutes !== 0) return { status: "minutes_named", mention };
  if (mention.relation !== "from") return { status: "relation_missing", mention };
  if (mention.negated) return { status: "negated", mention };
  return { status: "named", mention };
}

const clock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

const PLACE_WORDS: Record<Place, string[]> = {
  home: ["home", "house", "casa", "hogar", "domicilio"],
  center: ["center", "centre", "clinic", "office", "centro", "clinica", "clínica", "oficina", "consultorio"],
  either: ["either", "both", "anywhere", "wherever", "cualquiera", "cualquier", "ambos", "dos", "donde", "sea"],
};

const ALL_PLACES = Object.keys(PLACE_WORDS) as Place[];

function placeClauses(clauses: string[][], place: Place): string[][] {
  return clauses.filter((clause) => PLACE_WORDS[place].some((w) => clause.includes(w)));
}

/**
 * What the clauses of the quoted words explicitly deny: a day, a place, or a
 * start hour (value, AM or PM and "from" all spoken) named in a clause that
 * carries a negation of its own. Never read across a comma, a segment
 * boundary or "but". The only ground for "Sources disagree".
 */
function deniedIn(located: LocatedQuote): Denied {
  const { tokenized, clauseIds } = located.context;
  const denied: Denied = { days: [], hours: [], places: [] };
  for (const id of clauseIds) {
    const clause = clauseWords(tokenized, id);
    if (!negated(clause)) continue;
    for (const day of ALL_DAYS) if (mentionsDay(clause, day) && !denied.days.includes(day)) denied.days.push(day);
    for (const place of ALL_PLACES) if (PLACE_WORDS[place].some((w) => clause.includes(w)) && !denied.places.includes(place)) denied.places.push(place);
    for (const m of hourMentions(tokenized, id)) {
      if (m.hour24 !== null && m.minutes === 0 && m.relation === "from" && !denied.hours.includes(m.hour24)) denied.hours.push(m.hour24);
    }
  }
  return denied;
}

/** Words that would make a statement clinical. Nothing clinical is assessed here, so such a statement is withheld. */
const CLINICAL = /\b(autis\w*|asd|diagnos\w*|disorder\w*|spectrum|symptom\w*|sever(?:e|ity)|meltdown\w*|tantrum\w*|aggress\w*|self[- ]?injur\w*|eligib\w*|therap\w*|medicat\w*|seizure\w*|adhd|anxiety|anxious|depress\w*|cognitive|developmental|delay\w*|non[- ]?verbal|regress\w*|sensory|prognos\w*|treatment|cur(?:e|es|ed|ing)|heal\w*|improv\w*|behavio\w*|hours (?:of|a|per) week|units)\b/i;

const ATTRIBUTION = /^(the (parent|family|guardian|caregiver) (states|says|said|reports|mentions|notes|explains|indicates) (that )?)/i;

/** True when the statement, without its attribution, is the quoted words themselves. */
function isVerbatim(statement: string, quote: string): boolean {
  const body = spokenForm(statement.replace(ATTRIBUTION, ""));
  return body.length > 0 && spokenForm(quote).includes(body);
}

/* ---------- The check ---------- */

function checkDocument(doc: RawDraft["documents"][number], source: DocumentSource, hold: (key: string, label: string, page: number, reason: Withheld["reason"], detail: string) => void): DocumentExtraction {
  const passed: ExtractedField[] = [];
  for (const field of doc.fields) {
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
      continue;
    }
    const other: ConflictingValue = { value: field.value, normalized: field.normalized, page: field.page, quote: field.quote, uncertain: field.uncertain, checked: field.checked };
    first.conflict = [...(first.conflict ?? []), other];
    first.checked.push(`another value was proposed for the same field, "${field.value}" (page ${field.page}): both are kept, neither is chosen`);
  }
  return { mediaId: doc.mediaId, readable: doc.readable, unreadableReason: doc.unreadableReason?.trim() || null, fields };
}

function checkClaim(claim: RawClaim, source: RecordingSource, hold: (reason: Withheld["reason"], detail: string) => void): RecordingClaim | null {
  const quote = claim.quote.trim();
  if (!quote) {
    hold("no_source", `"${claim.label}" came with no words to check.`);
    return null;
  }
  const located = locateWords(quote, source.transcript.segments);
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
  const clinical = [claim.statement, claim.label, claim.uncertain ?? ""].join(" ").match(CLINICAL);
  if (clinical) {
    hold("clinical_content", `"${claim.label}": the statement goes beyond scheduling and administrative facts ("${clinical[0]}"). Nothing clinical is assessed here.`);
    return null;
  }
  if (claim.key === "other") {
    hold("free_statement", `"${claim.label}": a free statement is not assessed by the code. The quoted words are "${quote}"; the reviewer reads them.`);
    return null;
  }
  const clauses = located.clauses;
  const { tokenized, clauseIds } = located.context;
  const mentions = clauseIds.flatMap((id) => hourMentions(tokenized, id));
  const spoken = clauses.map((c) => c.join(" ")).join(" / ");
  checked.push(`checked in the spoken clause${clauses.length > 1 ? "s" : ""} "${spoken}"`);
  let days: Day[] = [];
  let earliestHour: number | null = null;
  let location: RecordingClaim["location"] = null;
  const unresolved: string[] = [];

  const checkDays = (wantNegation: boolean): string | null => {
    for (const day of claim.days) {
      const mentioning = clauses.filter((clause) => mentionsDay(clause, day));
      if (mentioning.length === 0) return `structured_not_in_quote:${day} is not named in the spoken clause`;
      const negatedMention = mentioning.some(negated);
      if (wantNegation && !negatedMention) return `negation_mismatch:the spoken words do not say that ${day} does not work`;
      if (!wantNegation && negatedMention) return `negation_mismatch:the spoken words negate ${day}`;
      checked.push(`${day} named in the spoken clause, ${negatedMention ? "with a negation in that clause" : "with no negation in that clause"}; named is not established as working`);
    }
    days = [...claim.days];
    if (claim.days.length === 0) checked.push("no day named in the structured part");
    return null;
  };

  const hourDetail = (check: HourCheck, hour: number): string => {
    switch (check.status) {
      case "invalid":
        return `${hour} is not an hour of the day`;
      case "not_named":
        return `the hour ${clock(hour)} is not named in the spoken clause`;
      case "period_mismatch":
        return `the spoken words say "${check.mention.text}", not ${clock(hour)}`;
      case "not_earliest":
        return `the spoken words say "${check.mention.text}" as a limit, not as an hour to start from`;
      case "period_missing":
        return `"${check.mention.text}" is named without AM or PM`;
      case "relation_missing":
        return `"${check.mention.text}" is named without saying from when`;
      case "minutes_named":
        return `the spoken words say "${check.mention.text}", with minutes, not ${clock(hour)}`;
      case "negated":
        return `the spoken clause that names "${check.mention.text}" negates it`;
      default:
        return "";
    }
  };

  let refused: string | null = null;
  if (claim.key === "days_that_work" || claim.key === "days_that_do_not_work") {
    refused = checkDays(claim.key === "days_that_do_not_work");
    if (!refused && claim.earliestHour !== null) {
      const check = checkHour(claim.earliestHour, mentions);
      if (check.status === "named") {
        earliestHour = claim.earliestHour;
        checked.push(`hour ${clock(claim.earliestHour)} named in the spoken words as "${check.mention.text}"; named is not established as working`);
      } else checked.push(`hour ${clock(claim.earliestHour)} dropped: ${hourDetail(check, claim.earliestHour)}`);
    }
    if (!refused && claim.location) {
      const named = placeClauses(clauses, claim.location);
      if (named.length > 0 && !named.some(negated)) location = claim.location;
      else checked.push(`place "${claim.location}" dropped: ${named.length === 0 ? "not named in the spoken clause" : "the spoken words negate it"}`);
    }
  } else if (claim.key === "time_window") {
    if (claim.earliestHour !== null) {
      const check = checkHour(claim.earliestHour, mentions);
      if (check.status === "named") {
        earliestHour = claim.earliestHour;
        checked.push(`hour ${clock(claim.earliestHour)} named in the spoken words as "${check.mention.text}": value, AM or PM, and "from" all present; named is not established as working`);
      } else if (check.status === "period_missing" || check.status === "relation_missing" || check.status === "minutes_named" || check.status === "negated") {
        unresolved.push(`${hourDetail(check, claim.earliestHour)}: ${clock(claim.earliestHour)} is the model's reading and is not taken from the words.`);
        checked.push(`hour ${clock(claim.earliestHour)} not taken: ${hourDetail(check, claim.earliestHour)}`);
      } else refused = `structured_not_in_quote:${hourDetail(check, claim.earliestHour)}`;
    } else checked.push("no hour in the structured part: the rule will say it cannot compare");
    days = claim.days.filter((day) => clauses.some((clause) => mentionsDay(clause, day) && !negated(clause)));
    if (days.length < claim.days.length) checked.push("days not named without negation in the spoken clause dropped");
  } else if (claim.key === "location_preference") {
    if (claim.location !== null) {
      const named = placeClauses(clauses, claim.location);
      if (named.length === 0) refused = `structured_not_in_quote:the place "${claim.location}" is not named in the spoken clause`;
      else if (named.some(negated)) refused = `negation_mismatch:the spoken words negate the place "${claim.location}"`;
      else {
        location = claim.location;
        checked.push(`place "${claim.location}" named in the spoken clause, with no negation in that clause; named is not established as preferred`);
      }
    } else checked.push("no place in the structured part: the rule will say it cannot compare");
  }

  if (refused) {
    const colon = refused.indexOf(":");
    hold(refused.slice(0, colon) as Withheld["reason"], `"${claim.label}": ${refused.slice(colon + 1)}.`);
    return null;
  }

  const denies = deniedIn(located);
  const deniedWords = [
    ...denies.days.map((d) => d),
    ...denies.hours.map((h) => `from ${clock(h)}`),
    ...denies.places.map((p) => `the place "${p}"`),
  ];
  if (deniedWords.length > 0) checked.push(`the spoken clause explicitly negates ${deniedWords.join(", ")}: the only ground on which the review says that two sources disagree`);

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
    days,
    earliestHour,
    location,
    proposed: { days: [...claim.days], earliestHour: claim.earliestHour, location: claim.location },
    denies,
    uncertain: claim.uncertain?.trim() || null,
    unresolved: unresolved.length > 0 ? unresolved.join(" ") : null,
    checked,
  };
}

export function verifyDraft(
  raw: RawDraft,
  sources: { documents: DocumentSource[]; recordings: RecordingSource[] },
  meta: { origin: Draft["origin"]; computedAt: string; transcriptReused?: boolean },
): Draft {
  const withheld: Withheld[] = [];
  const documents: DocumentExtraction[] = [];
  const recordings: RecordingReview[] = [];

  for (const doc of raw.documents) {
    const source = sources.documents.find((d) => d.mediaId === doc.mediaId);
    if (!source) {
      withheld.push({ mediaId: doc.mediaId, key: "*", label: "Document", reason: "unknown_media", detail: `The draft names a document this file does not hold ("${doc.mediaId}").` });
      continue;
    }
    documents.push(checkDocument(doc, source, (key, label, page, reason, detail) => withheld.push({ mediaId: doc.mediaId, key, label, page, reason, detail })));
  }

  for (const rec of raw.recordings) {
    const source = sources.recordings.find((r) => r.mediaId === rec.mediaId);
    if (!source) {
      withheld.push({ mediaId: rec.mediaId, key: "*", label: "Recording", reason: "unknown_media", detail: `The draft names a recording this file does not hold ("${rec.mediaId}").` });
      continue;
    }
    const claims: RecordingClaim[] = [];
    for (const claim of rec.claims) {
      const kept = checkClaim(claim, source, (reason, detail) => withheld.push({ mediaId: rec.mediaId, key: claim.key, label: claim.label, reason, detail }));
      if (kept) claims.push(kept);
    }
    recordings.push({ mediaId: rec.mediaId, transcript: source.transcript, claims });
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
