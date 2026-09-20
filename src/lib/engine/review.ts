/**
 * The review: propositions, the three rules, the reviewer's actions, the journal.
 *
 * Rule 1: a required item is missing (or not readable) → a request to the family
 *         is prepared. It is not sent.
 * Rule 2: two sources disagree, or an extraction is uncertain → the file waits
 *         for review. Nothing is chosen for the family.
 * Rule 3: the reviewer approves the current version → the file moves to the next
 *         administrative step, and the journal keeps the approved version.
 *
 * Pure functions over plain data, so the same code runs in tests, in the
 * browser and on the server. Every function returns a new state.
 *
 * Three things hold the approvals honest. Every proposition carries a source
 * key, a digest of what the source gave it (statement, nature, finding,
 * evidence, criterion, structured data, what the code checked): when a new
 * draft or a new submission produces a proposition with another key, the
 * reviewer's work on the old one goes to the history and the new one is
 * proposed again, and every reviewed proposition that rests on it, reviewed
 * through the request included, is flagged. The request carries a context
 * key (the whole current submission, the items and their kinds, the current
 * statements of the propositions it cites and of what they rest on): an
 * approval of its text holds only for that context, and is never reused when
 * the key differs. A resolution by the reviewer belongs to one instance of a
 * question and survives every run: only a new submission, or the reviewer
 * asking again, opens the question again, as a new instance that inherits
 * nothing; a closed line of the request is never rewritten. And the file
 * approval names a SHA-256 of the whole content, request included, so a
 * change anywhere ends it.
 *
 * The code reads no polarity from words. What the recording says is the
 * model's extraction: every cross-check shows it as extracted, next to its
 * quote, and compares it field by field with the form. Every uncertainty the
 * model declares is kept on the proposition, shown, and part of its key.
 */
import { documentItems, promptQuestions, TEMPLATE } from "../template";
import { dict, optionLabel } from "../i18n";
import { sameText } from "./text";
import { clock, KEY_LABELS } from "./verify";
import type {
  ApprovedProposition,
  Criterion,
  Day,
  DocumentExtraction,
  Draft,
  ExtractedField,
  Evidence,
  Finding,
  JournalEntry,
  Lang,
  Proposition,
  PropositionGroup,
  RequestDraft,
  RequestItem,
  ReviewState,
  Stage,
  Submission,
  Withheld,
} from "./types";
import { Refused } from "./types";

/* ---------- Labels of the reviewer side (English) ---------- */

export const DOCUMENT_LABELS: Record<string, string> = {
  referral_letter: "Referral letter",
  insurance_card: "Insurance card (front and back)",
};

export const PROMPT_LABELS: Record<string, string> = {
  scheduling_prompt: "Recorded answer: scheduling",
};

export const GROUP_LABELS: Record<PropositionGroup, string> = {
  documents: "Requested items",
  referral_letter: "Referral letter",
  insurance_card: "Insurance card",
  recording: "Recorded answer",
  cross_checks: "Cross-checks",
};

export const STAGE_LABELS: Record<Stage, string> = {
  in_review: "In review",
  waiting_for_review: "Waiting for review",
  waiting_on_family: "Waiting on family",
  ready_for_scheduling: "Ready for the scheduling call",
};

export const FINDING_LABELS: Record<Finding, string> = {
  present: "Present",
  unreadable: "Not readable",
  missing: "Not received",
  conflicting: "Sources disagree (as extracted)",
  to_confirm: "To confirm",
  unusable_audio: "Audio not usable",
  negative: "Not working, as extracted",
  withheld: "Not evaluable",
  not_checked: "Not checked",
};

const FIELD_ORDER = [
  "patient_name",
  "date_of_birth",
  "guardian_name",
  "referral_date",
  "referring_provider",
  "service_requested",
  "diagnosis_reference",
  "member_name",
  "member_id",
  "group_number",
  "plan_name",
  "dependent_name",
  "effective_date",
  "member_services_phone",
];

const DAY_ORDER: Day[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/* ---------- SHA-256, in plain code so the same digest is computed in tests, in the browser and on the server ---------- */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

/** JSON with object keys in a fixed order, so equal content gives an equal digest. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/* ---------- Small helpers ---------- */

function answerText(submission: Submission, id: string): string {
  const value = submission.answers[id];
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

function answerList(submission: Submission, id: string): string[] {
  const value = submission.answers[id];
  return Array.isArray(value) ? value : value ? [value] : [];
}

export function dayList(days: string[], lang: Lang = "en"): string {
  const sorted = DAY_ORDER.filter((d) => days.includes(d)).map((d) => optionLabel(lang, d));
  if (sorted.length <= 1) return sorted.join("");
  const last = sorted.pop();
  return `${sorted.join(", ")} ${lang === "es" ? "y" : "and"} ${last}`;
}

function daysBetween(a: string, b: string): number | null {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.floor((db - da) / 86_400_000);
}

const FORM_TIME_HOUR: Record<string, number | null> = {
  morning: 8,
  early_afternoon: 12,
  after_3pm: 15,
  evening: 17,
};

/** The language the request to the family is written in: the contact language the parent chose, then the form language. */
export function requestLanguage(submission: Submission): Lang {
  const chosen = submission.answers.contact_language;
  return chosen === "en" || chosen === "es" ? chosen : submission.language;
}

/** The media a live run has to read for a submission. */
export function mediaOfSubmission(submission: Submission): string[] {
  const ids: string[] = [];
  for (const slot of Object.values(submission.documents)) if (slot.status === "received" && slot.mediaId) ids.push(slot.mediaId);
  for (const slot of Object.values(submission.recordings)) if (slot.status === "received" && slot.mediaId) ids.push(slot.mediaId);
  return ids;
}

/* ---------- Digests ---------- */

/** What the source gave a proposition. Same key: same proposition, the reviewer's work stands. */
function sourceKeyOf(p: Omit<Proposition, "sourceKey">): string {
  return sha256Hex(
    canonical({
      id: p.id,
      statement: p.history[0]?.statement ?? p.statement,
      nature: p.nature,
      finding: p.finding,
      evidence: p.evidence,
      criterion: p.criterion,
      details: p.details,
      requestable: p.requestable,
      checked: p.checked,
    }),
  );
}

function keyed(p: Omit<Proposition, "sourceKey">): Proposition {
  return { ...p, sourceKey: sourceKeyOf(p) };
}

/** SHA-256 of everything a file approval covers: the submission, every proposition with its evidence and criterion, the request. */
export function contentFingerprint(state: Pick<ReviewState, "submission" | "draft" | "propositions" | "request">): string {
  return sha256Hex(
    canonical({
      submission: {
        reference: state.submission.reference,
        version: state.submission.version,
        submittedAt: state.submission.submittedAt,
        language: state.submission.language,
        answers: state.submission.answers,
        documents: state.submission.documents,
        recordings: state.submission.recordings,
        signature: state.submission.signature ?? null,
      },
      draft: { origin: state.draft.origin, computedAt: state.draft.computedAt },
      propositions: state.propositions.map((p) => ({
        id: p.id,
        statement: p.statement,
        state: p.state,
        nature: p.nature,
        finding: p.finding,
        evidence: p.evidence,
        criterion: p.criterion,
        details: p.details,
        inRequest: p.inRequest,
        recheck: p.recheck ? p.recheck.because : null,
      })),
      request: state.request ? { text: state.request.text, status: state.request.status, items: state.request.items } : null,
    }),
  );
}

/* ---------- Building propositions from a submission and a draft ---------- */

function documentPropositions(submission: Submission, draft: Draft, now: string, version: number): Proposition[] {
  const out: Proposition[] = [];
  for (const item of documentItems(TEMPLATE)) {
    const label = DOCUMENT_LABELS[item.id] ?? item.id;
    const slot = submission.documents[item.id] ?? { status: "missing" as const };
    const id = `doc:${item.id}`;
    const base = {
      id,
      group: "documents" as const,
      label,
      nature: "rule" as const,
      state: "proposed" as const,
      dependsOn: [],
      inRequest: false,
    };
    if (slot.status === "missing" || !slot.mediaId) {
      out.push(
        keyed({
          ...base,
          statement: item.required ? "Not received. Required for the file." : "Not received. Optional.",
          evidence: [{ kind: "form", questionId: `documents.${item.id}`, value: "Not attached" }],
          finding: "missing",
          history: [{ statement: "Not received.", by: "rule", at: now, version }],
          requestable: item.required ? "missing_item" : undefined,
          inRequest: item.required,
        }),
      );
      continue;
    }
    const extraction = draft.documents.find((d) => d.mediaId === slot.mediaId);
    if (extraction && !extraction.readable) {
      const statement = `Received, not readable: ${extraction.unreadableReason ?? "the copy could not be read"}.`;
      out.push(
        keyed({
          ...base,
          statement,
          evidence: [{ kind: "document", mediaId: slot.mediaId, page: 1, quote: "" }],
          finding: "unreadable",
          history: [{ statement, by: "ai", at: now, version }],
          requestable: "unreadable_item",
          inRequest: true,
        }),
      );
      continue;
    }
    const withheld = draft.withheld.filter((w) => w.mediaId === slot.mediaId && w.key !== "*").length;
    const pages = extraction ? new Set(extraction.fields.map((f) => f.page)).size : 0;
    const read = extraction ? extraction.fields.length : 0;
    // Given to the run and absent from its output: read, with nothing usable back. Not given to any run yet: not read.
    const given = !extraction && (draft.media?.includes(slot.mediaId) ?? false);
    const unreadableBlocks = extraction?.readings?.filter((r) => !r.readable) ?? [];
    const statement = extraction
      ? `Received and readable. ${read} field${read === 1 ? "" : "s"} read${pages > 1 ? ` across ${pages} pages` : ""}${withheld > 0 ? `, ${withheld} withheld by the source check` : ""}.${
          unreadableBlocks.length > 0
            ? ` ${unreadableBlocks.length === 1 ? "One block" : `${unreadableBlocks.length} blocks`} of the ${extraction.blocks} the draft returned called it not readable (${unreadableBlocks.map((r) => r.unreadableReason ?? "no reason given").join("; ")}); the merge is listed below, to confirm.`
            : ""
        }`
      : given
        ? "Received. The draft returned nothing for it: 0 fields read."
        : "Received. Not read yet: no draft has read this document.";
    const unread = !extraction || read === 0;
    out.push(
      keyed({
        ...base,
        statement,
        evidence: [{ kind: "document", mediaId: slot.mediaId, page: 1, quote: "" }],
        finding: unread ? "to_confirm" : "present",
        criterion: unread
          ? {
              id: "document_read",
              label: "Something could be read from the document",
              rule: "At least one field passed the source check. A document that was received but not read is not a document read.",
              result: extraction || given ? "not_met" : "not_assessable",
              note: extraction
                ? withheld > 0
                  ? `${withheld} proposed field${withheld === 1 ? "" : "s"} failed the check and ${withheld === 1 ? "is" : "are"} listed below as not evaluable.`
                  : "The model proposed nothing for this document."
                : given
                  ? "The document was given to the run and nothing came back for it."
                  : "No draft has read this document yet. Run the draft again, or check it by hand.",
            }
          : undefined,
        history: [{ statement, by: extraction ? "ai" : "rule", at: now, version }],
      }),
    );
  }
  return out;
}

function fieldCriterion(
  key: string,
  field: DocumentExtraction["fields"][number],
  submission: Submission,
): { criterion?: Criterion; finding: Finding } {
  const uncertainFinding: Finding = field.uncertain ? "to_confirm" : "present";
  const { criterion, finding } = rawFieldCriterion(key, field, submission, uncertainFinding);
  // An uncertain reading is never a met criterion: the same convention as for the recording. The comparison stays in the note.
  if (field.uncertain && criterion && criterion.result !== "not_assessable") {
    const comparison = criterion.result === "met" ? "The value would meet the rule as read" : `The value as read does not meet the rule${criterion.note ? ` (${criterion.note})` : ""}`;
    return {
      criterion: { ...criterion, result: "not_assessable", note: `${comparison}; the reading is uncertain, so the rule is not applied.` },
      finding: "to_confirm",
    };
  }
  return { criterion, finding };
}

/** The one convention of equality, the same for the deduplication of values and for these criteria. */
const SAME_TEXT_RULE = "Same text as the form under one convention: case, runs of spaces and punctuation at the ends of words are ignored; word boundaries are kept. A mechanical comparison of two texts, nothing more.";

function rawFieldCriterion(
  key: string,
  field: DocumentExtraction["fields"][number],
  submission: Submission,
  uncertainFinding: Finding,
): { criterion?: Criterion; finding: Finding } {
  switch (key) {
    case "patient_name": {
      const met = sameText(field.value, `${answerText(submission, "child_first_name")} ${answerText(submission, "child_last_name")}`);
      return {
        criterion: {
          id: "name_matches_form",
          label: "Name on the referral matches the intake form",
          rule: SAME_TEXT_RULE,
          result: met ? "met" : "not_met",
          note: met ? undefined : `Form: ${answerText(submission, "child_first_name")} ${answerText(submission, "child_last_name")}.`,
        },
        finding: met ? uncertainFinding : "conflicting",
      };
    }
    case "guardian_name": {
      const met = sameText(field.value, answerText(submission, "guardian_name"));
      return {
        criterion: {
          id: "guardian_matches_form",
          label: "Parent or guardian on the referral matches the intake form",
          rule: SAME_TEXT_RULE,
          result: met ? "met" : "not_met",
          note: met ? undefined : `Form: ${answerText(submission, "guardian_name")}.`,
        },
        finding: met ? uncertainFinding : "conflicting",
      };
    }
    case "date_of_birth": {
      const expected = answerText(submission, "child_dob");
      const met = !!field.normalized && field.normalized === expected;
      return {
        criterion: {
          id: "dob_matches_form",
          label: "Date of birth matches the intake form",
          rule: "Same calendar date as the form, compared in ISO form.",
          result: field.normalized ? (met ? "met" : "not_met") : "not_assessable",
          note: field.normalized ? (met ? undefined : `Form: ${expected}.`) : "No date could be read in machine form.",
        },
        finding: field.normalized ? (met ? uncertainFinding : "conflicting") : "to_confirm",
      };
    }
    case "referral_date": {
      const age = field.normalized ? daysBetween(field.normalized, submission.submittedAt) : null;
      const met = age !== null && age >= 0 && age <= 365;
      return {
        criterion: {
          id: "referral_within_12_months",
          label: "Referral dated within 12 months of the submission",
          rule: "Sample administrative rule, invented for this sample: referral date at most 365 days before the submission date, and not after it.",
          result: age === null ? "not_assessable" : met ? "met" : "not_met",
          note: age === null ? "No date could be read in machine form." : `${age} days before the submission.`,
        },
        finding: age === null ? "to_confirm" : met ? uncertainFinding : "conflicting",
      };
    }
    case "referring_provider":
      // Present means the quoted passage is on the page. Whose name it is, the code does not establish: a title, a credential or
      // a line label proves nothing about who wrote the referral.
      return {
        criterion: {
          id: "provider_role_to_confirm",
          label: "Role to confirm by the reviewer",
          rule: `The value is quoted from page ${field.page} of the letter. Whether this person is the referring provider, the code does not establish: the reviewer reads the passage.`,
          result: "not_assessable",
          note: `"${field.value}" is in the passage; its role is for the reviewer to confirm.`,
        },
        finding: uncertainFinding,
      };
    case "service_requested":
      return {
        criterion: {
          id: "service_to_confirm",
          label: "Service requested: meaning to confirm by the reviewer",
          rule: `The value is quoted from page ${field.page} of the letter. Whether it names the service requested, the code does not establish: a non-empty value proves nothing.`,
          result: "not_assessable",
          note: `"${field.value}" is in the passage; what it names is for the reviewer to confirm.`,
        },
        finding: uncertainFinding,
      };
    case "diagnosis_reference":
      return {
        criterion: {
          id: "diagnosis_reference_to_confirm",
          label: "Diagnosis reference: to confirm by the reviewer",
          rule: `The value is quoted from page ${field.page} of the letter, as written. Whether it is the diagnosis reference, the code does not establish. Nothing about it is assessed here.`,
          result: "not_assessable",
          note: `"${field.value}" is in the passage; whether it is the reference is for the reviewer to confirm.`,
        },
        finding: uncertainFinding,
      };
    case "dependent_name": {
      const met = sameText(field.value, `${answerText(submission, "child_first_name")} ${answerText(submission, "child_last_name")}`);
      return {
        criterion: {
          id: "dependent_matches_child",
          label: "Dependent on the card matches the child's name",
          rule: SAME_TEXT_RULE,
          result: met ? "met" : "not_met",
          note: met ? undefined : `Form: ${answerText(submission, "child_first_name")} ${answerText(submission, "child_last_name")}.`,
        },
        finding: met ? uncertainFinding : "conflicting",
      };
    }
    case "effective_date": {
      const age = field.normalized ? daysBetween(field.normalized, submission.submittedAt) : null;
      const met = age !== null && age >= 0;
      return {
        criterion: {
          id: "coverage_effective",
          label: "Coverage effective on or before the submission date",
          rule: "Sample administrative rule, invented for this sample: effective date not after the submission date. Eligibility itself is not checked here.",
          result: age === null ? "not_assessable" : met ? "met" : "not_met",
          note: age === null ? "No date could be read in machine form." : undefined,
        },
        finding: age === null ? "to_confirm" : met ? uncertainFinding : "to_confirm",
      };
    }
    default:
      return { finding: uncertainFinding };
  }
}

/**
 * Several values for a field the form also carries: the mechanical comparison
 * of each text with the form, under the shared convention. Met when one of
 * the values is the same text as the form and is not marked uncertain; the
 * other values stay visible, to confirm. Nothing chooses between them.
 */
function valuesAgainstForm(key: string, values: Pick<ExtractedField, "value" | "page" | "uncertain">[], submission: Submission): Criterion | undefined {
  const forms: Record<string, { id: string; label: string; expected: string }> = {
    patient_name: { id: "name_matches_form", label: "Name on the referral matches the intake form", expected: `${answerText(submission, "child_first_name")} ${answerText(submission, "child_last_name")}` },
    guardian_name: { id: "guardian_matches_form", label: "Parent or guardian on the referral matches the intake form", expected: answerText(submission, "guardian_name") },
    dependent_name: { id: "dependent_matches_child", label: "Dependent on the card matches the child's name", expected: `${answerText(submission, "child_first_name")} ${answerText(submission, "child_last_name")}` },
  };
  const form = forms[key];
  if (!form) return undefined;
  const same = values.filter((v) => sameText(v.value, form.expected));
  const others = values.filter((v) => !same.includes(v));
  const sure = same.filter((v) => !v.uncertain);
  const lines = [
    ...same.map((v) => `"${v.value}" (page ${v.page}) is the same text as the form${v.uncertain ? `, and is marked uncertain by the model: ${v.uncertain}` : ""}.`),
    ...others.map((v) => `"${v.value}" (page ${v.page}) is another reading of the same field${v.uncertain ? `, marked uncertain by the model: ${v.uncertain}` : ""}; it stays visible, to confirm.`),
    `Form: ${form.expected}. Neither value is chosen by the code.`,
  ];
  return {
    id: form.id,
    label: form.label,
    rule: `${SAME_TEXT_RULE} With several values, met when one of them is the same text as the form and is not marked uncertain; the others stay to confirm.`,
    result: sure.length > 0 ? "met" : same.length > 0 ? "not_assessable" : "not_met",
    note: lines.join(" "),
  };
}

function groupOfItem(itemId: string): PropositionGroup {
  return itemId === "insurance_card" ? "insurance_card" : "referral_letter";
}

/**
 * The draft returned one media in several blocks. All of them were read and
 * merged by the source check, none ignored; this proposition says so, lists
 * what each block said about the document when the blocks disagreed on its
 * readability, and leaves the merge to the reviewer to confirm.
 */
function blocksProposition(
  mediaId: string,
  group: PropositionGroup,
  kind: "document" | "recording",
  blocks: number,
  evidence: Evidence[],
  now: string,
  version: number,
  readings: DocumentExtraction["readings"] = undefined,
): Proposition {
  const opinions = (readings ?? []).map((r) => `block ${r.block} of ${blocks}: ${r.readable ? "readable" : `not readable (${r.unreadableReason ?? "no reason given"})`}`);
  const disagree = new Set((readings ?? []).map((r) => r.readable)).size > 1;
  const statement = `To confirm: the draft returned ${blocks} blocks for this ${kind}. All ${blocks} were read and merged, none ignored: ${
    kind === "document" ? "a field proposed in more than one block is shown with every value" : "every statement of every block is listed below"
  }.${opinions.length > 0 && (disagree || !readings?.some((r) => r.readable)) ? ` The blocks on its readability: ${opinions.join("; ")}.` : ""}`;
  return keyed({
    id: `blocks:${mediaId}`,
    group,
    label: `${kind === "document" ? "Document" : "Recording"} returned in ${blocks} blocks`,
    statement,
    nature: "rule",
    evidence,
    finding: "to_confirm",
    criterion: {
      id: "conflicting_extraction",
      label: "One block per media",
      rule: `The draft must return one block per ${kind}. Several blocks are merged, all of them read, and the merge is shown for the reviewer to confirm.`,
      result: "not_assessable",
      note: `${blocks} blocks returned for "${mediaId}".${opinions.length > 0 ? ` ${opinions.join("; ")}.` : ""}`,
    },
    state: "proposed",
    history: [{ statement, by: "rule", at: now, version }],
    dependsOn: [],
    inRequest: false,
    details: { blocks: [String(blocks)], readings: opinions },
  });
}

function extractionPropositions(submission: Submission, draft: Draft, now: string, version: number): Proposition[] {
  const out: Proposition[] = [];
  for (const item of documentItems(TEMPLATE)) {
    const slot = submission.documents[item.id];
    if (!slot || slot.status !== "received" || !slot.mediaId) continue;
    const extraction = draft.documents.find((d) => d.mediaId === slot.mediaId);
    if (!extraction) continue;
    const group = groupOfItem(item.id);
    // Several blocks are named whatever they said: two unreadable blocks are two opinions to show, not one reason to keep.
    if (extraction.blocks && extraction.blocks > 1) {
      out.push(blocksProposition(slot.mediaId, group, "document", extraction.blocks, [{ kind: "document", mediaId: slot.mediaId, page: 1, quote: "" }], now, version, extraction.readings));
    }
    if (!extraction.readable) continue;
    const fields = [...extraction.fields].sort((a, b) => FIELD_ORDER.indexOf(a.key) - FIELD_ORDER.indexOf(b.key));
    for (const field of fields) {
      const id = `field:${slot.mediaId}:${field.key}`;
      if (field.conflict && field.conflict.length > 0) {
        // The draft proposed more than one value for this key. Neither is chosen: every value is shown with its passage, every
        // uncertainty declared on any of them is kept, and the reviewer picks.
        const all = [field, ...field.conflict];
        const doubts = all.filter((v) => v.uncertain).map((v) => `"${v.value}" (page ${v.page}) is marked uncertain by the model: ${v.uncertain}`);
        const statement = `To confirm: the draft proposed ${all.length} values for this field, ${all.map((v) => `"${v.value}" (page ${v.page})`).join(" and ")}. Neither is taken.${doubts.length > 0 ? ` ${doubts.join(". ")}.` : ""}`;
        const comparison = valuesAgainstForm(field.key, all, submission);
        out.push(
          keyed({
            id,
            group,
            label: field.label,
            statement,
            nature: "rule",
            evidence: all.map((v) => ({ kind: "document" as const, mediaId: slot.mediaId!, page: v.page, quote: v.quote })),
            finding: "to_confirm",
            criterion: comparison ?? {
              id: "conflicting_extraction",
              label: "One value for the field",
              rule: "The draft must give one value per field. Two different values, each in its passage, are shown side by side and neither is established.",
              result: "not_assessable",
              note: [all.map((v) => `"${v.value}" quoted as "${v.quote}"`).join("; "), ...doubts.map((d) => `${d}.`)].join(" "),
            },
            state: "proposed",
            history: [{ statement, by: "rule", at: now, version }],
            dependsOn: [],
            inRequest: false,
            checked: all.flatMap((v) => v.checked),
            details: { values: all.map((v) => v.value), uncertain: all.filter((v) => v.uncertain).map((v) => `"${v.value}" (page ${v.page}): ${v.uncertain}`) },
          }),
        );
        continue;
      }
      const { criterion, finding } = fieldCriterion(field.key, field, submission);
      out.push(
        keyed({
          id,
          group,
          label: field.label,
          statement: field.value,
          nature: "extraction",
          evidence: [{ kind: "document", mediaId: slot.mediaId, page: field.page, quote: field.quote }],
          finding,
          criterion: field.uncertain && criterion ? { ...criterion, note: [criterion.note, `Uncertain, in the model's words: ${field.uncertain}`].filter(Boolean).join(" ") } : criterion,
          state: "proposed",
          history: [{ statement: field.value, by: "ai", at: now, version }],
          dependsOn: [],
          inRequest: false,
          checked: field.checked,
          // The uncertainty the model declared, whether or not a criterion carries it: shown, and part of the source key.
          details: field.uncertain ? { uncertain: [field.uncertain] } : undefined,
        }),
      );
      if (field.key === "referring_provider") {
        out.push(
          keyed({
            id: `${id}:license`,
            group,
            label: "Provider license status",
            statement: "Not checked. A registry lookup is not part of this sample.",
            nature: "rule",
            evidence: [{ kind: "document", mediaId: slot.mediaId, page: field.page, quote: field.quote }],
            finding: "not_checked",
            criterion: {
              id: "license_status",
              label: "Referring provider holds a current license",
              rule: "Would need a registry lookup. The letter alone cannot answer it, and this sample does not look it up.",
              result: "not_assessable",
            },
            state: "proposed",
            history: [{ statement: "Not checked. A registry lookup is not part of this sample.", by: "rule", at: now, version }],
            dependsOn: [id],
            inRequest: false,
          }),
        );
      }
    }
  }
  return out;
}

const WITHHELD_REASONS: Record<string, string> = {
  no_source: "No passage or words were given to check.",
  quote_not_found: "The quoted passage is not on the page named.",
  value_not_in_quote: "The value is not in the quoted passage.",
  normalized_mismatch: "The machine-form date does not match the passage.",
  segment_not_found: "The quoted words are not in the transcript.",
  segment_out_of_range: "The audio window does not fit the recording.",
  structured_not_in_quote: "A day or a place is not in the quoted words, or an hour is not an hour of the day.",
  free_statement: "A free statement is not assessed by the code: the reviewer reads the quoted words.",
  flagged_for_review: "Flagged for review: a word of the statement is on the short list that sends it to the reviewer unread by the code. Whether it is clinical is not established; nothing clinical is assessed here.",
  unknown_media: "The draft names a file this submission does not hold.",
};

/** A sentence ends with a full stop: a doubt written without one is still a sentence here. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * What the model proposed under a refusal, as it came: the value or the
 * statement, the words it cited, what it structured from them, and the doubt
 * it declared. None of it is established, all of it is the reviewer's to
 * read, and all of it is in the key of the proposition: a refused proposal
 * that changes, its doubt included, is a proposition to look at again.
 */
function withheldDetails(w: Withheld): Record<string, string[]> {
  const details: Record<string, string[]> = { reason: [w.reason] };
  const p = w.proposed;
  if (!p) return details;
  const what = p.statement ?? p.value;
  if (what !== undefined && what !== "") details.proposed = [what];
  if (p.normalized) details.normalized = [p.normalized];
  if (p.days && p.days.length > 0) details.days = [...p.days];
  if (p.earliestHour !== undefined && p.earliestHour !== null) details.earliest = [clock(p.earliestHour)];
  if (p.location) details.place = [p.location];
  if (p.quote) details.quote = [p.quote];
  if (p.uncertain) details.uncertain = [p.uncertain];
  return details;
}

/** The statement of a refused proposition: what the code refused, then what the model had proposed and the doubt it declared. */
function withheldStatement(w: Withheld): string {
  const parts = [`Withheld by the source check. ${w.detail}`];
  const p = w.proposed;
  const what = p?.statement ?? p?.value;
  if (what) parts.push(`The model proposed "${what}"; the code did not keep it, and nothing in it is established.`);
  if (p?.uncertain) parts.push(`The model said it was unsure: ${sentence(p.uncertain)}`);
  return parts.join(" ");
}

/** What the models proposed and the code refused: listed as not evaluable, never as a finding. */
function withheldPropositions(submission: Submission, draft: Draft, now: string, version: number): Proposition[] {
  const out: Proposition[] = [];
  const seen = new Map<string, number>();
  for (const w of draft.withheld) {
    if (w.key === "*") {
      // The draft named a file this submission does not hold: nothing to attach it to, still listed. The id carries the kind of
      // media and a rank, so a document and a recording named alike are two propositions.
      const kind = w.label === "Recording" ? "recording" : "document";
      const rank = (seen.get(`*:${kind}:${w.mediaId}`) ?? 0) + 1;
      seen.set(`*:${kind}:${w.mediaId}`, rank);
      const statement = `Not evaluable. ${w.detail}`;
      out.push(
        keyed({
          id: `withheld:${kind}:${w.mediaId}:*${rank > 1 ? `:${rank}` : ""}`,
          group: w.label === "Recording" ? "recording" : "documents",
          label: `${w.label} named by the draft: "${w.mediaId}"`,
          statement,
          nature: "rule",
          evidence: [],
          finding: "withheld",
          criterion: {
            id: "source_check",
            label: "Source check",
            rule: "Every value must be in a passage of the page it names; every claim must quote words that are in the recording, and a day or a place it carries must be in those words.",
            result: "not_assessable",
            note: WITHHELD_REASONS[w.reason] ?? w.reason,
          },
          state: "proposed",
          history: [{ statement, by: "rule", at: now, version }],
          dependsOn: [],
          inRequest: false,
        }),
      );
      continue;
    }
    const docItem = documentItems(TEMPLATE).find((item) => submission.documents[item.id]?.status === "received" && submission.documents[item.id]?.mediaId === w.mediaId);
    const prompt = promptQuestions(TEMPLATE).find((p) => submission.recordings[p.id]?.status === "received" && submission.recordings[p.id]?.mediaId === w.mediaId);
    if (!docItem && !prompt) continue;
    const count = (seen.get(`${w.mediaId}:${w.key}`) ?? 0) + 1;
    seen.set(`${w.mediaId}:${w.key}`, count);
    const id = `withheld:${w.mediaId}:${w.key}${count > 1 ? `:${count}` : ""}`;
    const statement = withheldStatement(w);
    const evidence: Evidence[] = docItem
      ? [{ kind: "document", mediaId: w.mediaId, page: w.page ?? 1, quote: "" }]
      : [{ kind: "audio", mediaId: w.mediaId, start: 0, end: submission.recordings[prompt!.id]?.durationSeconds ?? 0, quote: "" }];
    out.push(
      keyed({
        id,
        group: docItem ? groupOfItem(docItem.id) : "recording",
        label: w.label,
        statement,
        nature: "rule",
        evidence,
        finding: "withheld",
        criterion: {
          id: "source_check",
          label: "Source check",
          rule: "Every value must be in a passage of the page it names; every claim must quote words that are in the recording, and a day or a place it carries must be in those words.",
          result: "not_assessable",
          note: WITHHELD_REASONS[w.reason] ?? w.reason,
        },
        state: "proposed",
        history: [{ statement, by: "rule", at: now, version }],
        dependsOn: [],
        inRequest: false,
        details: withheldDetails(w),
      }),
    );
  }
  return out;
}

function recordingPropositions(submission: Submission, draft: Draft, now: string, version: number): Proposition[] {
  const out: Proposition[] = [];
  for (const prompt of promptQuestions(TEMPLATE)) {
    const label = PROMPT_LABELS[prompt.id] ?? prompt.id;
    const slot = submission.recordings[prompt.id] ?? { status: "missing" as const };
    if (slot.status === "missing" || !slot.mediaId) {
      out.push(
        keyed({
          id: `rec:${prompt.id}`,
          group: "recording",
          label,
          statement: "No recorded answer was received.",
          nature: "rule",
          evidence: [{ kind: "form", questionId: `recordings.${prompt.id}`, value: "Not attached" }],
          finding: "missing",
          state: "proposed",
          history: [{ statement: "No recorded answer was received.", by: "rule", at: now, version }],
          dependsOn: [],
          requestable: "missing_item",
          inRequest: true,
        }),
      );
      continue;
    }
    const review = draft.recordings.find((r) => r.mediaId === slot.mediaId);
    if (!review) {
      const statement = "Received. Not read yet: no draft has transcribed this recording.";
      out.push(
        keyed({
          id: `rec:${prompt.id}:unread`,
          group: "recording",
          label,
          statement,
          nature: "rule",
          evidence: [{ kind: "audio", mediaId: slot.mediaId, start: 0, end: slot.durationSeconds ?? 0, quote: "" }],
          finding: "to_confirm",
          criterion: { id: "recording_read", label: "Something could be read from the recording", rule: "At least one claim passed the source check. A recording received but not transcribed is not a recording read.", result: "not_assessable", note: "No draft has read this recording yet." },
          state: "proposed",
          history: [{ statement, by: "rule", at: now, version }],
          dependsOn: [],
          inRequest: false,
        }),
      );
      continue;
    }
    if (review.transcript.unusable) {
      const statement = `The recording could not be used: ${review.transcript.unusable}`;
      out.push(
        keyed({
          id: `rec:${prompt.id}:unusable`,
          group: "recording",
          label,
          statement,
          nature: "rule",
          evidence: [{ kind: "audio", mediaId: slot.mediaId, start: 0, end: slot.durationSeconds ?? 0, quote: "" }],
          finding: "unusable_audio",
          state: "proposed",
          history: [{ statement, by: "ai", at: now, version }],
          dependsOn: [],
          requestable: "unreadable_item",
          inRequest: true,
        }),
      );
      continue;
    }
    const mediaId = slot.mediaId;
    if (review.claims.length === 0) {
      const withheld = draft.withheld.filter((w) => w.mediaId === mediaId && w.key !== "*").length;
      const statement = `Transcribed, but no statement about scheduling passed the source check${withheld > 0 ? ` (${withheld} withheld, listed below)` : ""}.`;
      out.push(
        keyed({
          id: `rec:${prompt.id}:noclaims`,
          group: "recording",
          label,
          statement,
          nature: "rule",
          evidence: [{ kind: "audio", mediaId, start: 0, end: slot.durationSeconds ?? 0, quote: "" }],
          finding: "to_confirm",
          criterion: { id: "recording_read", label: "Something could be read from the recording", rule: "At least one claim passed the source check.", result: "not_met" },
          state: "proposed",
          history: [{ statement, by: "rule", at: now, version }],
          dependsOn: [],
          inRequest: false,
        }),
      );
    }
    if (review.blocks && review.blocks > 1) {
      out.push(blocksProposition(mediaId, "recording", "recording", review.blocks, [{ kind: "audio", mediaId, start: 0, end: slot.durationSeconds ?? 0, quote: "" }], now, version));
    }
    review.claims.forEach((claim, index) => {
      const finding: Finding = claim.uncertain ? "to_confirm" : claim.key === "days_that_do_not_work" ? "negative" : "present";
      // What the model structured, listed under the key it returned it with: a day under the time window is a day under the time
      // window, never a day that works. The label is the key's own, the same one the source check uses.
      const extracted = [
        claim.days.length > 0 ? `${claim.days.map((d) => optionLabel("en", d)).join(", ")} under ${KEY_LABELS[claim.key]}` : "",
        claim.earliestHour !== null ? `earliest hour ${clockLabel(claim.earliestHour)}` : "",
        claim.location ? `place: ${place(claim.location)}` : "",
      ].filter(Boolean);
      const notes = [claim.uncertain ? `Uncertain, in the model's words: ${claim.uncertain}.` : "", extracted.length > 0 ? `As extracted: ${extracted.join("; ")}.` : ""].filter(Boolean);
      const criterion: Criterion =
        claim.key === "location_preference"
          ? {
              id: "place_to_confirm",
              label: "Place: as extracted, not established",
              rule: "The place is the model's extraction from the quoted words, located in the recording. Whether it is the place the family wants is not established by the code: the reviewer confirms it against the recording.",
              result: "not_assessable",
              note: notes.join(" ") || undefined,
            }
          : {
              id: "availability_to_confirm",
              label: "Availability: as extracted, not established",
              rule: "The days and hours are the model's extraction from the quoted words, located in the recording. Whether they work for the family is not established by the code: the reviewer confirms them against the recording.",
              result: "not_assessable",
              note: notes.join(" ") || undefined,
            };
      out.push(
        keyed({
          id: `claim:${mediaId}:${claim.key}:${index}`,
          group: "recording",
          label: claim.label,
          statement: claim.statement,
          nature: claim.nature,
          evidence: [{ kind: "audio", mediaId, start: claim.segment.start, end: claim.segment.end, quote: claim.quote }],
          finding,
          criterion,
          state: "proposed",
          history: [{ statement: claim.statement, by: "ai", at: now, version }],
          dependsOn: [],
          inRequest: false,
          checked: claim.checked,
          // The structured data as extracted: part of the source key, so a change here is a new proposition.
          details: {
            days: [...claim.days],
            hour: claim.earliestHour !== null ? [String(claim.earliestHour)] : [],
            place: claim.location ? [claim.location] : [],
            uncertain: claim.uncertain ? [claim.uncertain] : [],
          },
        }),
      );
    });
  }
  return out;
}

const place = (value: string | null) => (value === "home" ? "at home" : value === "center" ? "at the center" : "either place");

/** The form's time option as a window of the day: what its start and end are, for a comparison with an extracted earliest hour. */
const FORM_TIME_WINDOW: Record<string, { start: number; end: number }> = {
  morning: { start: 6, end: 12 },
  early_afternoon: { start: 12, end: 15 },
  after_3pm: { start: 15, end: 24 },
  evening: { start: 17, end: 24 },
};

const NO_POLARITY_RULE = "The code reads no polarity from words: what the recording says is the model's extraction, shown with its quote for the reviewer to check against the recording.";

const quoted = (texts: string[]) => texts.map((q) => `"${q}"`).join(" / ");
const isAre = (n: number) => (n > 1 ? "are" : "is");

/**
 * The three cross-checks between the form and the extraction. Structured
 * fields against structured fields, nothing read from words: the form's days,
 * time option and place against the days, earliest hour and place the model
 * extracted. Two findings only: "Sources disagree (as extracted)" on a
 * structural contradiction (a form day listed under days that do not work,
 * an extracted earliest hour past the end of the form's window, the other
 * place than the one the form names); "To confirm" for everything else, what
 * seems to match included. Every statement is attributed to the extraction.
 */
function crossCheckPropositions(submission: Submission, draft: Draft, recordingProps: Proposition[], now: string, version: number): Proposition[] {
  const out: Proposition[] = [];
  const prompt = promptQuestions(TEMPLATE)[0];
  const slot = prompt ? submission.recordings[prompt.id] : undefined;
  const review = slot?.mediaId ? draft.recordings.find((r) => r.mediaId === slot.mediaId) : undefined;
  if (!review || review.transcript.unusable) return out;

  type Claim = (typeof review.claims)[number];
  const claimsOf = (key: string) => review.claims.filter((c) => c.key === key);
  /** The proposition ids of these claims: every claim a cross-check reads is a dependency, not the first one only. */
  const idsOf = (claims: Claim[]) =>
    claims.map((c) => recordingProps.find((p) => p.id === `claim:${review.mediaId}:${c.key}:${review.claims.indexOf(c)}`)?.id).filter((id): id is string => !!id);
  const audioOf = (claims: Claim[]): Evidence[] => {
    const seen = new Set<string>();
    const evidence: Evidence[] = [];
    for (const c of claims) {
      const key = `${c.segment.start}-${c.segment.end}-${c.quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({ kind: "audio", mediaId: review.mediaId, start: c.segment.start, end: c.segment.end, quote: c.quote });
    }
    return evidence;
  };
  const uncertainNote = (claims: Claim[]): string | null => {
    const notes = claims.filter((c) => c.uncertain).map((c) => `"${c.label}" is marked uncertain by the model: ${c.uncertain}`);
    return notes.length > 0 ? notes.join(" ") : null;
  };
  const quotesOf = (claims: Claim[]) => [...new Set(claims.map((c) => c.quote))];

  /* Days: the form's list against the extracted lists. */
  const formDays = answerList(submission, "preferred_days");
  const positive = claimsOf("days_that_work");
  const negative = claimsOf("days_that_do_not_work");
  const dayClaims = [...negative, ...positive];
  if (dayClaims.length > 0) {
    const works = [...new Set(positive.flatMap((c) => c.days))];
    const doesNot = [...new Set(negative.flatMap((c) => c.days))];
    const uncertain = uncertainNote(dayClaims);
    // A form day under days that do not work is the structural contradiction; an uncertain extraction is never one.
    const contradicted = uncertain ? [] : formDays.filter((d) => doesNot.includes(d as Day));
    const unmentioned = formDays.filter((d) => !works.includes(d as Day) && !doesNot.includes(d as Day));
    const both = works.filter((d) => doesNot.includes(d));
    const base = {
      id: "xcheck:days",
      group: "cross_checks" as const,
      label: "Preferred days",
      nature: "rule" as const,
      evidence: [{ kind: "form" as const, questionId: "preferred_days", value: dayList(formDays) || "none" }, ...audioOf(dayClaims)],
      state: "proposed" as const,
      dependsOn: idsOf(dayClaims),
      details: { formDays, works, doesNot, contradicted, unmentioned },
      requestable: "confirm" as const,
      inRequest: false,
    };
    const criterionLabel = "Days: the form against the extraction";
    const rule = `Sources disagree, as extracted, when a day the form lists is under days that do not work in the extraction. Anything else, what seems to match included, is to confirm. ${NO_POLARITY_RULE}`;
    const formSays = formDays.length === 0 ? "The form lists no day." : `The form lists ${dayList(formDays)}.`;
    if (contradicted.length > 0) {
      const from = negative.filter((c) => c.days.some((d) => contradicted.includes(d)));
      const statement = `As extracted from the recording (${quoted(quotesOf(from))}), ${dayList(contradicted)} ${isAre(contradicted.length)} listed under days that do not work. ${formSays} To confirm which days.`;
      out.push(
        keyed({
          ...base,
          statement,
          finding: "conflicting",
          criterion: { id: "days_form_against_extraction", label: criterionLabel, rule, result: "not_met", note: `${dayList(contradicted)} ${isAre(contradicted.length)} on the form and under days that do not work in the extraction. As extracted is not established by the code.` },
          history: [{ statement, by: "rule", at: now, version }],
        }),
      );
    } else {
      const listed = [
        works.length > 0 ? `${dayList(works)} ${isAre(works.length)} listed under days that work` : "",
        doesNot.length > 0 ? `${dayList(doesNot)} ${isAre(doesNot.length)} listed under days that do not work` : "",
      ]
        .filter(Boolean)
        .join(", and ");
      const statement = `As extracted from the recording (${quoted(quotesOf(dayClaims))}), ${listed || "no day is listed"}. ${formSays}${unmentioned.length > 0 ? ` ${dayList(unmentioned)} ${isAre(unmentioned.length)} not in the extraction.` : ""} To confirm.`;
      const note = [
        formDays.length === 0 ? "The form names no day to compare with." : "",
        unmentioned.length > 0 ? `${dayList(unmentioned)} ${isAre(unmentioned.length)} on the form and not in the extraction.` : "",
        both.length > 0 ? `${dayList(both)} ${isAre(both.length)} under both lists in the extraction.` : "",
        uncertain ? `${uncertain}.` : "",
        "As extracted is not established by the code.",
      ]
        .filter(Boolean)
        .join(" ");
      out.push(
        keyed({
          ...base,
          statement,
          finding: "to_confirm",
          criterion: { id: "days_form_against_extraction", label: criterionLabel, rule, result: "not_assessable", note },
          history: [{ statement, by: "rule", at: now, version }],
        }),
      );
    }
  }

  /* Time: the form's option, a window of the day, against the extracted earliest hour. */
  const times = claimsOf("time_window");
  const formTime = answerText(submission, "preferred_time");
  if (times.length > 0 && formTime) {
    const formLabel = optionLabel("en", formTime).toLowerCase();
    const window = FORM_TIME_WINDOW[formTime];
    const hours = [...new Set(times.map((c) => c.earliestHour).filter((h): h is number => h !== null))];
    const uncertain = uncertainNote(times);
    const hour = hours.length === 1 && !uncertain ? hours[0] : null;
    const past = hour !== null && window !== undefined && hour > window.end;
    const extracted =
      hours.length === 0 ? "no hour is given" : hours.length === 1 ? `the earliest hour is ${clockLabel(hours[0])}` : `the earliest hour is given more than once (${hours.map(clockLabel).join(", ")})`;
    const base = {
      id: "xcheck:time",
      group: "cross_checks" as const,
      label: "Time of day",
      nature: "rule" as const,
      evidence: [{ kind: "form" as const, questionId: "preferred_time", value: optionLabel("en", formTime) }, ...audioOf(times)],
      state: "proposed" as const,
      dependsOn: idsOf(times),
      requestable: "confirm" as const,
      inRequest: false,
      details: { formTime: [formTime], recordedHour: hour !== null ? [String(hour)] : [], hours: hours.map(String) },
    };
    const criterionLabel = "Time: the form against the extraction";
    const rule = `Sources disagree, as extracted, when the extracted earliest hour is later than the end of the form's window (morning ends at noon, early afternoon at 3 pm; after 3 pm and evening run to the end of the day). Anything else, what seems to match included, is to confirm. ${NO_POLARITY_RULE}`;
    if (past) {
      const statement = `As extracted from the recording (${quoted(quotesOf(times))}), ${extracted}, past the end of the form's window. The form says ${formLabel}. To confirm which time of day.`;
      out.push(
        keyed({
          ...base,
          statement,
          finding: "conflicting",
          criterion: { id: "time_form_against_extraction", label: criterionLabel, rule, result: "not_met", note: `${clockLabel(hour!)} is later than the end of the form's window (${formLabel}). As extracted is not established by the code.` },
          history: [{ statement, by: "rule", at: now, version }],
        }),
      );
    } else {
      const statement = `As extracted from the recording (${quoted(quotesOf(times))}), ${extracted}. The form says ${formLabel}. To confirm.`;
      const note = [
        hours.length === 0 ? "The extraction gives no hour to compare with the form." : "",
        hours.length > 1 ? "The extraction gives more than one earliest hour." : "",
        window === undefined ? "The form option has no window to compare with." : "",
        uncertain ? `${uncertain}.` : "",
        "As extracted is not established by the code.",
      ]
        .filter(Boolean)
        .join(" ");
      out.push(
        keyed({
          ...base,
          statement,
          finding: "to_confirm",
          criterion: { id: "time_form_against_extraction", label: criterionLabel, rule, result: "not_assessable", note },
          history: [{ statement, by: "rule", at: now, version }],
        }),
      );
    }
  }

  /* Place: the form's answer against the extracted place. */
  const locations = claimsOf("location_preference");
  const formLocation = answerText(submission, "location");
  if (locations.length > 0 && formLocation) {
    const formPlace = formLocation === "home" || formLocation === "center" ? formLocation : null;
    const places = [...new Set(locations.map((c) => c.location).filter((x): x is "home" | "center" | "either" => x !== null))];
    const uncertain = uncertainNote(locations);
    const recorded = places.length === 1 && !uncertain ? places[0] : null;
    const other = recorded !== null && formPlace !== null && recorded !== "either" && recorded !== formPlace;
    const extracted =
      places.length === 0 ? "no place is given" : places.length === 1 ? (places[0] === "either" ? "either place is given" : `the place is ${place(places[0])}`) : `the place is given more than once (${places.map(place).join(", ")})`;
    const formSays = formLocation === "either" ? "The form allows either place." : `The form says ${place(formLocation)}.`;
    const base = {
      id: "xcheck:location",
      group: "cross_checks" as const,
      label: "Where sessions take place",
      nature: "rule" as const,
      evidence: [{ kind: "form" as const, questionId: "location", value: optionLabel("en", formLocation) }, ...audioOf(locations)],
      state: "proposed" as const,
      dependsOn: idsOf(locations),
      requestable: "confirm" as const,
      inRequest: false,
      details: { formPlace: [formLocation], recordedPlace: recorded ? [recorded] : [], places },
    };
    const criterionLabel = "Place: the form against the extraction";
    const rule = `Sources disagree, as extracted, when the form names one place (home or the center) and the extraction names the other one. Anything else, what seems to match included, is to confirm. ${NO_POLARITY_RULE}`;
    if (other) {
      const statement = `As extracted from the recording (${quoted(quotesOf(locations))}), ${extracted}. ${formSays} To confirm which place.`;
      out.push(
        keyed({
          ...base,
          statement,
          finding: "conflicting",
          criterion: { id: "place_form_against_extraction", label: criterionLabel, rule, result: "not_met", note: `The form says ${place(formLocation)}; the extraction gives ${place(recorded)}. As extracted is not established by the code.` },
          history: [{ statement, by: "rule", at: now, version }],
        }),
      );
    } else {
      const statement = `As extracted from the recording (${quoted(quotesOf(locations))}), ${extracted}. ${formSays} To confirm.`;
      const note = [
        places.length === 0 ? "The extraction gives no place to compare with the form." : "",
        places.length > 1 ? "The extraction gives more than one place." : "",
        formPlace === null ? "The form allows either place: nothing to contradict." : "",
        uncertain ? `${uncertain}.` : "",
        "As extracted is not established by the code.",
      ]
        .filter(Boolean)
        .join(" ");
      out.push(
        keyed({
          ...base,
          statement,
          finding: "to_confirm",
          criterion: { id: "place_form_against_extraction", label: criterionLabel, rule, result: "not_assessable", note },
          history: [{ statement, by: "rule", at: now, version }],
        }),
      );
    }
  }
  return out;
}

const clockLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? "am" : "pm"}`;

export function buildPropositions(submission: Submission, draft: Draft, now: string, version = 1): Proposition[] {
  const docs = documentPropositions(submission, draft, now, version);
  const fields = extractionPropositions(submission, draft, now, version);
  const recording = recordingPropositions(submission, draft, now, version);
  const withheld = withheldPropositions(submission, draft, now, version);
  const cross = crossCheckPropositions(submission, draft, recording, now, version);
  const byGroup = (group: PropositionGroup) => [...fields, ...withheld].filter((p) => p.group === group);
  return [...docs, ...byGroup("documents"), ...byGroup("referral_letter"), ...byGroup("insurance_card"), ...recording, ...withheld.filter((p) => p.group === "recording"), ...cross];
}

/* ---------- The request to the family (rule 1) ---------- */

export function requestText(submission: Submission, propositions: Proposition[], items: RequestItem[], code: string): string {
  const lang = requestLanguage(submission);
  const t = dict(lang).requestDraft;
  const parentFirst = answerText(submission, "guardian_name").split(" ")[0] || "";
  const child = answerText(submission, "child_first_name") || "";
  const lines: string[] = [t.greeting(parentFirst), "", t.thanks(child)];
  const open = items.filter((i) => !i.satisfiedAt);
  const missing = open.filter((i) => i.kind !== "confirm");
  const confirms = open.filter((i) => i.kind === "confirm");
  const labelOf = (id: string) => {
    const docId = id.startsWith("doc:") ? id.slice(4) : null;
    if (docId) return dict(lang).documents[docId] ?? DOCUMENT_LABELS[docId] ?? docId;
    if (id.startsWith("rec:")) return t.recordedAnswer;
    return id;
  };
  if (missing.length > 0) {
    lines.push("", missing.length > 1 ? t.missingIntroPlural : t.missingIntro);
    for (const item of missing) {
      const label = labelOf(item.propositionId);
      if (item.propositionId.startsWith("rec:") && item.kind === "unreadable_item") lines.push(`- ${t.unusableRecording}`);
      else if (item.kind === "unreadable_item") lines.push(`- ${t.unreadableItem(label)}`);
      else lines.push(`- ${t.missingItem(label)}`);
    }
  }
  if (confirms.length > 0) {
    lines.push("", confirms.length > 1 ? t.confirmIntroPlural : t.confirmIntro);
    for (const item of confirms) {
      const prop = propositions.find((p) => p.id === item.propositionId);
      // The form side of a question is always the family's current answer. The extracted side comes from the proposition, or,
      // when the current draft no longer carries it, from the facts the question was composed with: it stays readable, and open.
      const details = prop?.details ?? item.facts ?? {};
      if (item.propositionId === "xcheck:days") {
        const formDayIds = answerList(submission, "preferred_days");
        const formDays = dayList(formDayIds, lang);
        const works = details.works ?? [];
        const doesNot = details.doesNot ?? [];
        if (!formDays) lines.push(`- ${t.confirmDaysNone(dayList([...works, ...doesNot], lang))}`);
        else if (works.length > 0 && doesNot.length > 0) lines.push(`- ${t.confirmDaysBoth(formDays, dayList(works, lang), dayList(doesNot, lang))}`);
        else if (doesNot.length > 0) lines.push(`- ${t.confirmDays(formDays, dayList(doesNot, lang))}`);
        else lines.push(`- ${t.confirmDaysUnmentioned(formDays, dayList(works, lang))}`);
      } else if (item.propositionId === "xcheck:time") {
        const formTimeId = answerText(submission, "preferred_time");
        const formTime = t.timePhrase[formTimeId] ?? optionLabel(lang, formTimeId).toLowerCase();
        const hour = details.recordedHour?.[0] ? Number(details.recordedHour[0]) : null;
        const clock = hour === null ? "" : lang === "es" ? `${hour}:00` : `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? "am" : "pm"}`;
        // The extracted hour is quoted back only when it differs from the form's: when it is the same, the question is simply asked.
        const differs = hour !== null && hour !== (FORM_TIME_HOUR[formTimeId] ?? null);
        lines.push(`- ${differs ? t.confirmTime(formTime, clock) : t.confirmTimeUnknown(formTime)}`);
      } else if (item.propositionId === "xcheck:location") {
        const formPlaceId = answerText(submission, "location");
        const formPlace = optionLabel(lang, formPlaceId).toLowerCase();
        const recorded = details.recordedPlace?.[0];
        const differs = !!recorded && recorded !== formPlaceId;
        lines.push(`- ${differs ? t.confirmLocation(formPlace, optionLabel(lang, recorded).toLowerCase()) : t.confirmLocationUnknown(formPlace)}`);
      } else {
        lines.push(`- ${t.confirmSchedule}`);
      }
    }
  }
  lines.push("", t.resume(code), "", t.closing, t.signature);
  return lines.join("\n");
}

export interface RequestContext {
  /** The whole current submission: answers, documents, recordings, signature, language, reference. */
  submission: string;
  /** Which items, of which kind, and whether their basis is still there. */
  items: string;
  /** The facts asked about, by item: the structured details and the current statement of the proposition the item cites, and of everything it rests on. */
  facts: Record<string, string>;
  key: string;
}

/** Digest of the whole submission as the family has it now: its date and version included, so a submission sent again is another one. */
export function submissionKey(submission: Submission): string {
  return sha256Hex(
    canonical({
      reference: submission.reference,
      version: submission.version,
      submittedAt: submission.submittedAt,
      language: submission.language,
      answers: submission.answers,
      documents: submission.documents,
      recordings: submission.recordings,
      signature: submission.signature ?? null,
    }),
  );
}

/**
 * What the request is about: the whole submission it answers, which items
 * and of which kind, and the facts asked about, the current statements of
 * the propositions it cites and of the propositions they rest on included.
 * The reviewer's corrected text and the approval of the text hold only for
 * this context, and each part is digested apart so a change can be named.
 */
export function requestContext(submission: Submission, propositions: Proposition[], items: RequestItem[]): RequestContext {
  // A question asked again is another question: its instance is part of what the text was approved for.
  const open = items
    .filter((i) => !i.satisfiedAt)
    .map((i) => ({ id: i.propositionId, kind: i.kind, instance: instanceOf(i), basisMissing: Boolean(i.basisMissing) }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const whole = submissionKey(submission);
  const itemsKey = sha256Hex(canonical(open));
  const facts: Record<string, string> = {};
  for (const i of open) {
    const p = propositions.find((q) => q.id === i.id);
    const rests = p ? p.dependsOn.map((id) => propositions.find((q) => q.id === id)).map((q) => (q ? { id: q.id, statement: q.statement, sourceKey: q.sourceKey } : null)) : [];
    facts[i.id] = sha256Hex(canonical(p ? { details: p.details ?? null, statement: p.statement, rests } : null));
  }
  return { submission: whole, items: itemsKey, facts, key: sha256Hex(`${whole}:${itemsKey}:${canonical(facts)}`) };
}

export function requestContextKey(submission: Submission, propositions: Proposition[], items: RequestItem[]): string {
  return requestContext(submission, propositions, items).key;
}

/** What an item rests on: the document or recording slot as the family sent it, or the source key of the proposition. */
function basisOf(p: Proposition, submission: Submission): string {
  if (p.id.startsWith("doc:")) {
    const slot = submission.documents[p.id.slice(4)];
    return slot ? `${slot.status}:${slot.mediaId ?? ""}:${slot.receivedAt ?? ""}` : "missing";
  }
  if (p.id.startsWith("rec:")) {
    const slot = submission.recordings[p.id.slice(4).split(":")[0]];
    return slot ? `${slot.status}:${slot.mediaId ?? ""}` : "missing";
  }
  return p.sourceKey;
}

/**
 * The question an item stands for: a document slot, a recording slot, or a
 * cross-check. The propositions about one recording slot carry several ids
 * (missing, unusable, not read); the question is the same.
 */
export function slotOf(propositionId: string): string {
  if (propositionId.startsWith("rec:")) return `rec:${propositionId.slice(4).split(":")[0]}`;
  return propositionId;
}

/** Which opening of its question a line is. Lines stored before the field existed are the first opening. */
export function instanceOf(item: Pick<RequestItem, "instance">): number {
  return item.instance ?? 1;
}

/** The latest line of a question: the highest instance, the open one when there is one. */
function latestLine(items: RequestItem[], slot: string): RequestItem | undefined {
  let latest: RequestItem | undefined;
  for (const item of items) {
    if (slotOf(item.propositionId) !== slot) continue;
    if (!latest || instanceOf(item) > instanceOf(latest) || (instanceOf(item) === instanceOf(latest) && !item.satisfiedAt)) latest = item;
  }
  return latest;
}

/**
 * The questions the reviewer resolved and nobody opened again since: the
 * latest line of the question is closed by the reviewer. A question asked
 * again (a new submission, the reviewer asking) has an open line as its
 * latest, and no resolution applies to it: it is a new instance.
 *
 * A resolution holds for the submission it was given under and for no other.
 * Pass the key of the submission in hand and a resolution given under an
 * earlier one is spent: the family sent the form again, so a proposition that
 * asks the question again opens a new instance. Without that key, every
 * resolution is read as applying, which is what a caller that has no
 * submission to compare against can say.
 */
export function resolvedQuestions(request: RequestDraft | undefined, submissionVersion?: string): Set<string> {
  const slots = new Set<string>();
  for (const item of request?.items ?? []) {
    const slot = slotOf(item.propositionId);
    const latest = latestLine(request!.items, slot);
    if (latest?.satisfiedBy !== "reviewer") continue;
    // A line closed before this field existed is not bound to a submission: it keeps applying, as it did.
    if (submissionVersion && latest.submissionVersion && latest.submissionVersion !== submissionVersion) continue;
    slots.add(slot);
  }
  return slots;
}

/** True when the reviewer's resolution of this question was given under another submission: it no longer applies. */
function resolutionSpent(latest: RequestItem | undefined, submissionVersion: string): boolean {
  return latest?.satisfiedBy === "reviewer" && Boolean(latest.submissionVersion) && latest.submissionVersion !== submissionVersion;
}

const ASKED_AGAIN_NEW_SUBMISSION = "the family sent the form again since this question was resolved";

/** The slot an item was composed for, as the family has it now: a change here is a piece the family sent, or took away. */
function slotBasisNow(item: RequestItem, submission: Submission): string | null {
  if (item.propositionId.startsWith("doc:")) {
    const slot = submission.documents[item.propositionId.slice(4)];
    return slot ? `${slot.status}:${slot.mediaId ?? ""}:${slot.receivedAt ?? ""}` : "missing";
  }
  if (item.propositionId.startsWith("rec:")) {
    const slot = submission.recordings[item.propositionId.slice(4).split(":")[0]];
    return slot ? `${slot.status}:${slot.mediaId ?? ""}` : "missing";
  }
  return null;
}

/** True when the slot an item was composed for now holds a piece the family sent. */
function slotReceivedNow(item: RequestItem, submission: Submission): boolean {
  if (item.propositionId.startsWith("doc:")) return submission.documents[item.propositionId.slice(4)]?.status === "received";
  if (item.propositionId.startsWith("rec:")) return submission.recordings[item.propositionId.slice(4).split(":")[0]]?.status === "received";
  return false;
}

/** A piece the family sent: the slot the item was composed for changed, and now holds something. Taking a piece away is not sending one. */
function familySent(item: RequestItem, submission: Submission): boolean {
  const slotNow = slotBasisNow(item, submission);
  return slotNow !== null && item.basis !== undefined && slotNow !== item.basis && slotReceivedNow(item, submission);
}

const BASIS_MISSING = "The draft no longer carries this item; review it";

interface ComposedRequest {
  request?: RequestDraft;
  /** The request was approved and its text or its context changed: it is a draft again. */
  reopened?: { approvedText: string; because: string };
  /** The reviewer had corrected the text and the context changed: the rule composed it again; this is the reviewer's text. */
  editedDropped?: { text: string; because: string };
  /** Items the reviewer had resolved and that are asked again, by proposition id. */
  reopenedItems: string[];
}

/** Names what changed in the context of a request, part by part. */
function describeContextChange(previous: RequestDraft | undefined, next: RequestContext): string {
  if (!previous) return "";
  const parts = previous.contextParts;
  // A request stored before the parts were digested this way cannot name the part: the generic reason stands.
  if (!parts || typeof parts.submission !== "string" || typeof parts.facts !== "object" || parts.facts === null) {
    return "context changed: the submission, the items or the facts asked about changed";
  }
  const changed: string[] = [];
  if (parts.submission !== next.submission) changed.push("submission changed: the family's answers, documents, recording, signature or language changed");
  if (parts.items !== next.items) changed.push("items changed: the items asked for");
  // A fact counts as changed only for an item that was already asked about: a new item brings its facts, it does not correct one.
  if (Object.keys(next.facts).some((id) => id in parts.facts && parts.facts[id] !== next.facts[id])) changed.push("fact corrected: a fact asked about was corrected or recomputed");
  return changed.join("; ");
}

/**
 * Composes the request from the propositions that ask for something, and
 * carries the earlier items forward. An item is the question about a slot or
 * a cross-check: it continues under a new proposition id or kind (a card
 * asked for as missing and received unreadable, a recording removed and
 * asked for again) rather than closing. It closes only when the family sent
 * the piece (the slot changed and holds something) or when the reviewer
 * resolved it; a draft that stops carrying the proposition leaves it open,
 * its basis missing. Each opening of a question is an instance: a question
 * asked again after a resolution or a reception is a new line with the next
 * instance number, and a closed line is never touched again. An item the
 * reviewer resolved is asked again only when the proposition asks for it
 * again after a new submission, or when the reviewer asks: the caller keeps
 * a resolved question out of the propositions until then.
 *
 * The text and its approval hold for one context key. When the key differs,
 * nothing approved is reused, whether items are still open or all satisfied.
 */
function composeRequest(submission: Submission, propositions: Proposition[], previous: RequestDraft | undefined, now: string, because = ""): ComposedRequest {
  const items: RequestItem[] = [];
  const used = new Set<RequestItem>();
  const reopenedItems: string[] = [];
  const earlier = previous?.items ?? [];
  const submissionVersion = submissionKey(submission);
  for (const p of propositions) {
    if (!(p.inRequest && p.requestable)) continue;
    const slot = slotOf(p.id);
    const basis = basisOf(p, submission);
    const facts = p.details;
    const open = earlier.find((i) => slotOf(i.propositionId) === slot && !i.satisfiedAt && !used.has(i));
    if (open) {
      used.add(open);
      if (familySent(open, submission)) {
        // The family sent the piece and it still needs asking (unreadable, say): the old question closes as received, a new one opens.
        items.push({ propositionId: p.id, kind: p.requestable, basis, facts, instance: instanceOf(open) + 1 });
        items.push({ ...open, satisfiedAt: now, satisfiedBy: "family", basisMissing: undefined });
      } else {
        // The same question continues, under the proposition's current id and kind.
        items.push({ ...open, propositionId: p.id, kind: p.requestable, basis, facts, basisMissing: undefined });
      }
      continue;
    }
    // No open line: the question is asked for the first time, or again after a line that closed.
    const latest = latestLine(earlier, slot);
    const item: RequestItem = { propositionId: p.id, kind: p.requestable, basis, facts, instance: latest ? instanceOf(latest) + 1 : 1 };
    if (latest?.satisfiedBy === "reviewer") {
      // A resolution given under an earlier submission is spent: say so, whatever the run that noticed it was doing.
      item.reopened = { at: now, because: resolutionSpent(latest, submissionVersion) ? ASKED_AGAIN_NEW_SUBMISSION : because || "asked again" };
      reopenedItems.push(p.id);
    }
    items.push(item);
  }
  for (const item of earlier) {
    if (used.has(item)) continue;
    if (item.satisfiedAt) {
      items.push(item);
      continue;
    }
    // An item the propositions no longer ask for leaves the request only when the family sent the piece or the reviewer resolved
    // it. A draft that stopped carrying it does not answer the question: the item stays open, its basis missing.
    items.push(familySent(item, submission) ? { ...item, satisfiedAt: now, satisfiedBy: "family", basisMissing: undefined } : { ...item, basisMissing: item.basisMissing ?? { at: now, because: BASIS_MISSING } });
  }
  if (items.length === 0) return { reopenedItems };
  const context = requestContext(submission, propositions, items);
  const contextKey = context.key;
  const sameContext = previous?.contextKey === contextKey;
  const contextChange = previous && !sameContext ? describeContextChange(previous, context) : "";
  const composed = requestText(submission, propositions, items, submission.reference);
  const keepEdit = Boolean(previous?.edited && sameContext);
  const text = keepEdit ? previous!.text : composed;
  const editedDropped = previous?.edited && !keepEdit ? { text: previous.text, because: contextChange } : undefined;
  const wasApproved = previous?.status === "approved";
  const textChanged = text !== previous?.approvedText;
  const contextChanged = previous?.approvedContextKey !== contextKey;
  const reopened = wasApproved && (textChanged || contextChanged);
  const because2 = textChanged && contextChanged ? `the text changed and ${contextChange}` : textChanged ? "the text changed" : contextChange;
  const approvals = (previous?.approvals ?? []).map((a, index, all) => (reopened && index === all.length - 1 && !a.superseded ? { ...a, superseded: { at: now, because: because2 } } : a));
  return {
    request: {
      language: requestLanguage(submission),
      items,
      text,
      contextKey,
      contextParts: { submission: context.submission, items: context.items, facts: context.facts },
      status: reopened ? "draft" : (previous?.status ?? "draft"),
      approvedAt: reopened ? undefined : previous?.approvedAt,
      approvedText: previous?.approvedText,
      approvedContextKey: previous?.approvedContextKey,
      approvals,
      edited: keepEdit ? previous!.edited : undefined,
    },
    reopened: reopened ? { approvedText: previous!.approvedText ?? "", because: because2 } : undefined,
    editedDropped,
    reopenedItems,
  };
}

/* ---------- Stage (rules 2 and 3) ---------- */

export function isReviewed(p: Proposition, request?: RequestDraft): boolean {
  if (p.recheck) return false;
  if (p.inRequest) return request?.status === "approved";
  return p.state === "approved" || p.state === "corrected";
}

export function openConflicts(state: Pick<ReviewState, "propositions" | "request">): Proposition[] {
  return state.propositions.filter(
    (p) =>
      (p.finding === "conflicting" || p.finding === "to_confirm" || p.finding === "unusable_audio" || p.finding === "withheld") &&
      p.state === "proposed" &&
      !(p.inRequest && state.request?.status === "approved"),
  );
}

export function deriveStage(state: Pick<ReviewState, "propositions" | "request" | "approval">): Stage {
  if (state.approval && !state.approval.detached) {
    const pending = state.request?.items.some((i) => !i.satisfiedAt);
    return pending ? "waiting_on_family" : "ready_for_scheduling";
  }
  return openConflicts(state).length > 0 ? "waiting_for_review" : "in_review";
}

/* ---------- Journal ---------- */

function entry(state: ReviewState, e: Omit<JournalEntry, "version">): ReviewState {
  return { ...state, journal: [...state.journal, { ...e, version: state.version }] };
}

function withStage(state: ReviewState, now: string, because: string): ReviewState {
  const next = deriveStage(state);
  if (next === state.stage) return state;
  const moved = { ...state, stage: next };
  return entry(moved, { at: now, actor: "rule", action: "stage_changed", detail: because, from: STAGE_LABELS[state.stage], to: STAGE_LABELS[next] });
}

/** Recomposes the request from the propositions and journals what that did to an approval or to a correction. */
function refreshRequest(state: ReviewState, now: string, because: string): ReviewState {
  const previous = state.request;
  const { request, reopened, editedDropped, reopenedItems } = composeRequest(state.submission, state.propositions, previous, now, because);
  let next: ReviewState = { ...state, request };
  for (const id of reopenedItems) {
    const label = state.propositions.find((p) => p.id === id)?.label ?? id;
    next = entry(next, {
      at: now,
      actor: "rule",
      action: "request_updated",
      detail: `${label}: resolved by the reviewer earlier, asked again (${because}). The resolution stays in the journal.`,
      target: id,
    });
  }
  if (editedDropped && request) {
    next = entry(next, {
      at: now,
      actor: "rule",
      action: "request_updated",
      detail: `The request was composed again by rule 1 (${because}: ${editedDropped.because}). The reviewer's wording is kept here, without its approval.`,
      target: "request",
      from: editedDropped.text,
      to: request.text,
    });
  }
  if (reopened && request) {
    next = entry(next, {
      at: now,
      actor: "rule",
      action: "request_reopened",
      detail: `The request changed after it was approved (${because}: ${reopened.because}). It is a draft again; the approved text is kept here and approves nothing else.`,
      target: "request",
      from: reopened.approvedText,
      to: request.text,
    });
  }
  return next;
}

/* ---------- Building the review ---------- */

/** True when the run had no recording to transcribe: the extraction was its only call. */
export function withoutRecording(draft: Draft): boolean {
  return draft.recordings.length === 0;
}

/** Where a draft came from, in words: the recorded run, or a live run, with the transcription called, reused, or not needed. */
export function draftOrigin(draft: Draft): string {
  if (draft.origin !== "live") return "from the recorded run";
  if (withoutRecording(draft)) return "computed live (extraction called; no recording, so no transcription)";
  return draft.transcriptReused ? "computed live (extraction called; transcription reused from an earlier run of the day)" : "computed live (transcription and extraction both called)";
}

export function buildReview(submission: Submission, draft: Draft, now: string = new Date().toISOString()): ReviewState {
  const propositions = buildPropositions(submission, draft, now);
  const { request } = composeRequest(submission, propositions, undefined, now);
  let state: ReviewState = {
    submission,
    draft,
    builtAt: now,
    propositions,
    request,
    version: 1,
    stage: "in_review",
    approvalHistory: [],
    journal: [],
  };
  const receivedMedia = new Set(Object.values(submission.documents).map((slot) => slot.mediaId).filter(Boolean));
  const docs = draft.documents.filter((d) => receivedMedia.has(d.mediaId)).length;
  const recs = draft.recordings.filter((r) => !r.transcript.unusable).length;
  state = entry(state, {
    at: now,
    actor: "ai",
    action: "draft_built",
    detail: `Draft ${draftOrigin(draft)}: ${docs} document${docs === 1 ? "" : "s"}, ${recs} recording${recs === 1 ? "" : "s"}, ${propositions.length} propositions, ${draft.withheld.length} withheld by the source check${draft.withheld.length > 0 ? " (listed as not evaluable)" : ""}.`,
  });
  if (request) {
    state = entry(state, {
      at: now,
      actor: "rule",
      action: "request_prepared",
      detail: `Rule 1: request to the family prepared for ${request.items.length} item${request.items.length === 1 ? "" : "s"}. Not sent.`,
      target: "request",
      to: request.text,
    });
  }
  const conflicts = openConflicts(state);
  state = withStage(
    state,
    now,
    conflicts.length > 0 ? `Rule 2: ${conflicts.map((c) => c.label.toLowerCase()).join(", ")} need${conflicts.length === 1 ? "s" : ""} a reviewer.` : "Draft ready for review.",
  );
  return state;
}

/* ---------- Reviewer actions ---------- */

function find(state: ReviewState, id: string): Proposition {
  const p = state.propositions.find((x) => x.id === id);
  if (!p) throw new Refused("unknown_proposition", "No such proposition in this file.");
  return p;
}

function replace(state: ReviewState, next: Proposition): ReviewState {
  return { ...state, propositions: state.propositions.map((p) => (p.id === next.id ? next : p)) };
}

function detachApproval(state: ReviewState, now: string, because: string): ReviewState {
  if (!state.approval || state.approval.detached) return state;
  const detached = { ...state.approval, detached: { at: now, because } };
  const next: ReviewState = { ...state, approval: undefined, approvalHistory: [...state.approvalHistory, detached] };
  return entry(next, {
    at: now,
    actor: "rule",
    action: "approval_detached",
    detail: `Approval of version ${detached.version} detached: ${because}. The approved version stays in the journal.`,
    target: "file",
  });
}

export function approve(state: ReviewState, id: string, now: string = new Date().toISOString()): ReviewState {
  const p = find(state, id);
  // A disagreement needs a decision: a correction, or the family asked. An item already in the request has that decision.
  if (p.finding === "conflicting" && p.state === "proposed" && !p.inRequest) {
    throw new Refused(
      "disagreement_needs_decision",
      "Two sources disagree and nothing was chosen. Correct the statement with what you confirmed, or ask the family.",
    );
  }
  if (p.state === "approved" && !p.recheck) {
    return entry(state, {
      at: now,
      actor: "reviewer",
      action: "approval_repeated",
      detail: `${p.label}: already approved at ${p.approvedAt ?? "an earlier time"}. No change.`,
      target: p.id,
    });
  }
  const rechecked = p.recheck ? ` Looked at again after ${p.recheck.because}.` : "";
  let next = replace(state, { ...p, state: "approved", approvedAt: now, recheck: undefined });
  next = entry(next, {
    at: now,
    actor: "reviewer",
    action: "approved",
    detail: `${p.label}: ${p.finding === "withheld" ? "acknowledged as not evaluable" : p.inRequest ? "confirmed as asked of the family" : "approved"} as "${p.statement}".${rechecked}`,
    target: p.id,
  });
  // The state of a proposition is part of what a file approval names: a change ends that approval.
  next = detachApproval(next, now, `${p.label} was approved after the file was approved`);
  return withStage(next, now, "Reviewer resolved an open item.");
}

export function correct(state: ReviewState, id: string, statement: string, now: string = new Date().toISOString()): ReviewState {
  const p = find(state, id);
  const trimmed = statement.trim();
  if (!trimmed || trimmed === p.statement) return state;
  const version = state.version + 1;
  const corrected: Proposition = {
    ...p,
    statement: trimmed,
    state: "corrected",
    recheck: undefined,
    approvedAt: undefined,
    history: [...p.history, { statement: trimmed, by: "reviewer", at: now, version }],
    criterion: p.criterion
      ? { ...p.criterion, result: "recheck", note: "Statement corrected by the reviewer. The rule is not re-applied to free text." }
      : undefined,
  };
  let next: ReviewState = { ...replace(state, corrected), version };
  next = entry(next, {
    at: now,
    actor: "reviewer",
    action: "corrected",
    detail: `${p.label}: statement corrected.`,
    target: p.id,
    from: p.statement,
    to: trimmed,
  });
  // Whatever rests on this proposition must be looked at again.
  next = {
    ...next,
    propositions: next.propositions.map((q) =>
      q.dependsOn.includes(p.id) ? { ...q, recheck: { because: `${p.label} was corrected`, at: now } } : q,
    ),
  };
  // The request follows the facts it cites and what they rest on: composed again whenever anything was corrected.
  if (next.request) next = refreshRequest(next, now, `${p.label} was corrected`);
  next = detachApproval(next, now, `${p.label} was corrected after the file was approved`);
  return withStage(next, now, "Content changed.");
}

export function addToRequest(state: ReviewState, id: string, now: string = new Date().toISOString()): ReviewState {
  const p = find(state, id);
  if (!p.requestable) throw new Refused("nothing_to_add", "This proposition cannot go into a request.");
  if (p.inRequest) return state;
  const version = state.version + 1;
  let next: ReviewState = { ...replace(state, { ...p, inRequest: true }), version };
  const wasApproved = next.request?.status === "approved";
  next = refreshRequest(next, now, `${p.label} was added`);
  next = entry(next, {
    at: now,
    actor: "reviewer",
    action: "added_to_request",
    detail: `${p.label}: added to the request to the family.${wasApproved ? " The request goes back to draft." : ""}`,
    target: p.id,
  });
  next = detachApproval(next, now, `the request to the family changed after the file was approved (${p.label} added)`);
  return withStage(next, now, "Request changed.");
}

/** The reviewer corrects the text of the request. The rule's version stays in the journal. */
export function editRequest(state: ReviewState, text: string, now: string = new Date().toISOString()): ReviewState {
  if (!state.request) throw new Refused("nothing_to_add", "There is no request to correct.");
  const trimmed = text.trim();
  if (!trimmed || trimmed === state.request.text) return state;
  const version = state.version + 1;
  const wasApproved = state.request.status === "approved";
  const approvals = state.request.approvals.map((a, index, all) => (wasApproved && index === all.length - 1 && !a.superseded ? { ...a, superseded: { at: now, because: "the reviewer corrected the text" } } : a));
  const request: RequestDraft = { ...state.request, text: trimmed, edited: { at: now }, status: "draft", approvedAt: undefined, approvals };
  let next: ReviewState = { ...state, request, version };
  next = entry(next, {
    at: now,
    actor: "reviewer",
    action: "request_edited",
    detail: `Request to the family: text corrected by the reviewer.${wasApproved ? " The request goes back to draft; the approved text is kept in the journal." : ""}`,
    target: "request",
    from: state.request.text,
    to: trimmed,
  });
  next = detachApproval(next, now, "the request to the family was corrected after the file was approved");
  return withStage(next, now, "Request changed.");
}

/**
 * The reviewer takes an item out of the request: handled outside the message
 * (by phone, by hand), or no longer a question. The only way an item closes
 * without a piece sent by the family. The proposition, if it is still there,
 * leaves the request and is reviewed on its own; the message is composed
 * again, and an approved message is a draft again since its text changes.
 */
export function resolveRequestItem(state: ReviewState, propositionId: string, note: string, now: string = new Date().toISOString()): ReviewState {
  const known = state.request?.items.filter((i) => i.propositionId === propositionId) ?? [];
  if (!state.request || known.length === 0) throw new Refused("unknown_proposition", "No such item in the request.");
  // The open line of the question, the current instance: a line already closed, by the family or by the reviewer, is history and stays as it is.
  const item = known.find((i) => !i.satisfiedAt);
  if (!item) return state;
  const version = state.version + 1;
  // The line remembers the submission it was resolved under: the resolution applies to that submission and to no other.
  const items = state.request.items.map((i) =>
    i === item ? { ...i, satisfiedAt: now, satisfiedBy: "reviewer" as const, basisMissing: undefined, submissionVersion: submissionKey(state.submission) } : i,
  );
  const propositions = state.propositions.map((p) => (p.id === propositionId ? { ...p, inRequest: false } : p));
  const label = state.propositions.find((p) => p.id === propositionId)?.label ?? propositionId;
  let next: ReviewState = { ...state, request: { ...state.request, items }, propositions, version };
  next = refreshRequest(next, now, `${label} was resolved by the reviewer`);
  next = entry(next, {
    at: now,
    actor: "reviewer",
    action: "request_item_resolved",
    detail: `${label}: taken out of the request by the reviewer${note.trim() ? ` (${note.trim()})` : ""}.${item.basisMissing ? " The draft no longer carried it." : ""}${state.propositions.some((p) => p.id === propositionId) ? " The item is reviewed on its own from here." : ""}`,
    target: propositionId,
  });
  next = detachApproval(next, now, `the request to the family changed after the file was approved (${label} resolved)`);
  return withStage(next, now, "Request changed.");
}

export function approveRequest(state: ReviewState, now: string = new Date().toISOString()): ReviewState {
  if (!state.request || state.request.items.every((i) => i.satisfiedAt)) {
    throw new Refused("nothing_to_add", "There is no request to approve.");
  }
  if (state.request.status === "approved") {
    return entry(state, { at: now, actor: "reviewer", action: "approval_repeated", detail: "Request already approved. No change.", target: "request" });
  }
  const request: RequestDraft = {
    ...state.request,
    status: "approved",
    approvedAt: now,
    approvedText: state.request.text,
    approvedContextKey: state.request.contextKey,
    approvals: [...state.request.approvals, { text: state.request.text, at: now, version: state.version, contextKey: state.request.contextKey }],
  };
  let next: ReviewState = { ...state, request };
  const open = request.items.filter((i) => !i.satisfiedAt).length;
  next = entry(next, {
    at: now,
    actor: "reviewer",
    action: "request_approved",
    detail: `Request to the family approved (${open} item${open === 1 ? "" : "s"}). Not sent: this sample sends nothing. The approved text is kept here; it approves the message, not the evidence behind its items.`,
    target: "request",
    to: request.text,
  });
  return withStage(next, now, "Request approved.");
}

export interface FileApprovalCheck {
  ok: boolean;
  reasons: string[];
}

export function canApproveFile(state: ReviewState): FileApprovalCheck {
  const reasons: string[] = [];
  const unreviewed = state.propositions.filter((p) => !isReviewed(p, state.request));
  if (unreviewed.length > 0) reasons.push(`${unreviewed.length} proposition${unreviewed.length === 1 ? "" : "s"} not reviewed yet.`);
  if (state.request && state.request.status !== "approved" && state.request.items.some((i) => !i.satisfiedAt)) {
    reasons.push("The request to the family is still a draft.");
  }
  if (state.approval && !state.approval.detached) reasons.push(`Version ${state.approval.version} is already approved.`);
  return { ok: reasons.length === 0, reasons };
}

export function approveFile(state: ReviewState, version: number, now: string = new Date().toISOString()): ReviewState {
  if (version !== state.version) {
    const refused = entry(state, {
      at: now,
      actor: "reviewer",
      action: "file_approval_refused",
      detail: `Approval named version ${version}; the file is at version ${state.version}. Read the current version before approving.`,
      target: "file",
    });
    throw Object.assign(new Refused("version_changed", "The file changed since it was displayed. Read it again before approving."), { state: refused });
  }
  const check = canApproveFile(state);
  if (!check.ok) {
    const refused = entry(state, {
      at: now,
      actor: "reviewer",
      action: "file_approval_refused",
      detail: check.reasons.join(" "),
      target: "file",
    });
    throw Object.assign(new Refused("not_reviewed", check.reasons.join(" ")), { state: refused });
  }
  const hash = contentFingerprint(state);
  // The snapshot keeps what the fingerprint covers, so the archive restores what the reviewer looked at, the doubts included.
  const snapshot: ApprovedProposition[] = state.propositions.map((p) => ({
    id: p.id,
    label: p.label,
    statement: p.statement,
    state: p.state,
    nature: p.nature,
    finding: p.finding,
    evidence: p.evidence,
    criterion: p.criterion,
    details: p.details,
    inRequest: p.inRequest,
  }));
  const approval = {
    version: state.version,
    hash,
    at: now,
    by: "reviewer" as const,
    snapshot,
    request: state.request ? { text: state.request.text, status: state.request.status } : undefined,
  };
  let next: ReviewState = { ...state, approval };
  next = entry(next, {
    at: now,
    actor: "reviewer",
    action: "file_approved",
    detail: `Rule 3: version ${approval.version} approved (content ${approval.hash.slice(0, 16)}). ${approval.snapshot.length} propositions kept as approved, with their evidence and criteria${approval.request ? ", and the request text" : ""}.`,
    target: "file",
  });
  return withStage(next, now, "Rule 3: reviewer approved the current version.");
}

/* ---------- Changes that arrive after the review started ---------- */

/** True when the reviewer reviewed this proposition: approved or corrected it, or approved the request it is asked through. */
function reviewedThrough(p: Proposition, request: RequestDraft | undefined): boolean {
  return p.state !== "proposed" || (p.inRequest && request?.status === "approved");
}

/**
 * Keeps what the reviewer did on propositions whose source key is unchanged.
 * Any other proposition is proposed again: the old statement and the
 * reviewer's work go to the history, and a reviewed one, reviewed through the
 * request included, is flagged. A question the reviewer resolved, and nobody
 * opened again since, is not asked again by a run, whether its proposition is
 * unchanged, proposed again, or new to this draft: only a new submission, or
 * the reviewer, opens it again. The resolution belongs to the submission it
 * was given under: once the family sends the form again it is spent for good,
 * not only during the rebuild that carried the new submission.
 *
 * A question whose line is still open is asked through that line: a
 * proposition that comes back after a draft that did not carry it is in the
 * request again, with no click, because the line never stopped asking.
 */
function merge(previous: Proposition[], fresh: Proposition[], now: string, because: string, context: { request?: RequestDraft; submissionVersion: string }): Proposition[] {
  const resolved = resolvedQuestions(context.request, context.submissionVersion);
  const open = new Set((context.request?.items ?? []).filter((i) => !i.satisfiedAt).map((i) => slotOf(i.propositionId)));
  const asked = (old: Proposition | undefined, next: Proposition) => {
    const slot = slotOf(next.id);
    if (resolved.has(slot)) return false;
    return open.has(slot) || (old?.inRequest ?? false) || next.inRequest;
  };
  return fresh.map((next) => {
    const old = previous.find((p) => p.id === next.id);
    // A proposition new to this draft can still be the proposition of a resolved question (an unusable recording, usable in
    // between): the resolution applies to it as to any other.
    if (!old) return { ...next, inRequest: next.requestable ? asked(undefined, next) : false };
    if (old.sourceKey === next.sourceKey) {
      return { ...old, dependsOn: next.dependsOn, requestable: next.requestable, inRequest: asked(old, next), checked: next.checked };
    }
    const changed: string[] = [];
    if ((old.history[0]?.statement ?? old.statement) !== (next.history[0]?.statement ?? next.statement)) changed.push("statement");
    if (canonical(old.evidence) !== canonical(next.evidence)) changed.push("source");
    if (old.finding !== next.finding) changed.push(`finding (${FINDING_LABELS[old.finding]} to ${FINDING_LABELS[next.finding]})`);
    if (old.state !== "corrected" && canonical(old.criterion) !== canonical(next.criterion)) changed.push("criterion");
    if (old.nature !== next.nature) changed.push("nature");
    if (canonical(old.details) !== canonical(next.details)) changed.push("structured data");
    if (canonical(old.checked) !== canonical(next.checked)) changed.push("what the code checked");
    const what = changed.length > 0 ? changed.join(", ") : "content";
    const statementChanged = old.statement !== next.statement;
    return {
      ...next,
      history: statementChanged ? [...old.history, ...next.history.map((h) => ({ ...h, at: now }))] : old.history,
      recheck: reviewedThrough(old, context.request) ? { because: `${because}: ${what} changed`, at: now } : undefined,
      // A proposition that can no longer be asked for (the item arrived) leaves the request.
      inRequest: next.requestable ? asked(old, next) : false,
    };
  });
}

/**
 * Rebuilds the propositions and the request for a submission and a draft,
 * keeping the reviewer's work where the source is unchanged. A proposition
 * that changed or vanished flags every reviewed proposition that rests on it,
 * reviewed through the request included, as a direct correction does: a
 * cross-check does not stay reviewed over a statement that was proposed again.
 */
function rebuild(state: ReviewState, submission: Submission, draft: Draft, version: number, now: string, because: string): ReviewState {
  const fresh = buildPropositions(submission, draft, now, version);
  const merged = merge(state.propositions, fresh, now, because, { request: state.request, submissionVersion: submissionKey(submission) });
  const changed = new Map<string, string>();
  for (const old of state.propositions) {
    const next = fresh.find((p) => p.id === old.id);
    if (!next) changed.set(old.id, `${old.label} is no longer in the draft`);
    else if (next.sourceKey !== old.sourceKey) changed.set(old.id, `${old.label} was proposed again`);
  }
  const propositions = merged.map((p) => {
    const old = state.propositions.find((q) => q.id === p.id);
    if (p.recheck || !old || !reviewedThrough(old, state.request)) return p;
    const rests = [...new Set([...p.dependsOn, ...old.dependsOn])].filter((id) => changed.has(id));
    if (rests.length === 0) return p;
    return { ...p, recheck: { because: `${because}: ${rests.map((id) => changed.get(id)).join(", ")}`, at: now } };
  });
  const next: ReviewState = { ...state, submission, draft, propositions, version };
  return refreshRequest(next, now, because);
}

export function receiveDocument(
  state: ReviewState,
  itemId: string,
  mediaId: string,
  extraction: DocumentExtraction | undefined,
  now: string = new Date().toISOString(),
): ReviewState {
  const slot = state.submission.documents[itemId];
  if (slot?.status === "received") throw new Refused("already_received", "This item was already received.");
  const submission: Submission = {
    ...state.submission,
    version: state.submission.version + 1,
    documents: { ...state.submission.documents, [itemId]: { status: "received", mediaId, receivedAt: now } },
  };
  const draft: Draft = extraction
    ? { ...state.draft, documents: [...state.draft.documents.filter((d) => d.mediaId !== mediaId), extraction] }
    : state.draft;
  const version = state.version + 1;
  const label = DOCUMENT_LABELS[itemId] ?? itemId;
  let next = rebuild(state, submission, draft, version, now, `${label} was received`);
  next = entry(next, {
    at: now,
    actor: "parent",
    action: "document_received",
    detail: `${label} received from the family. ${extraction ? `${extraction.fields.length} fields read.` : "Not read yet."}`,
    target: `doc:${itemId}`,
  });
  next = detachApproval(next, now, `${label} was received after the file was approved`);
  return withStage(next, now, "New document received.");
}

export function replaceDraft(state: ReviewState, draft: Draft, now: string = new Date().toISOString()): ReviewState {
  const version = state.version + 1;
  let next = rebuild(state, state.submission, draft, version, now, "the draft was computed again");
  next = entry(next, {
    at: now,
    actor: "ai",
    action: "draft_replaced",
    detail: `Draft ${draft.origin === "live" ? draftOrigin(draft) : "restored from the recorded run"}: ${next.propositions.length} propositions, ${draft.withheld.length} withheld by the source check${draft.withheld.length > 0 ? " (listed as not evaluable)" : ""}.`,
  });
  next = detachApproval(next, now, "the draft was computed again after the file was approved");
  return withStage(next, now, "Draft replaced.");
}

/** What changed between two submissions, in words for the journal. */
export function describeSubmissionChanges(before: Submission, after: Submission): string[] {
  const t = dict("en");
  const changes: string[] = [];
  const text = (value: Submission["answers"][string] | undefined) => (Array.isArray(value) ? value.map((v) => t.options[v] ?? v).join(", ") : value ? (t.options[value] ?? value) : "");
  for (const key of new Set([...Object.keys(before.answers), ...Object.keys(after.answers)])) {
    if (canonical(before.answers[key]) !== canonical(after.answers[key])) {
      changes.push(`${t.fields[key] ?? key}: "${text(before.answers[key]) || "empty"}" to "${text(after.answers[key]) || "empty"}"`);
    }
  }
  for (const item of documentItems(TEMPLATE)) {
    const a = before.documents[item.id];
    const b = after.documents[item.id];
    const label = DOCUMENT_LABELS[item.id] ?? item.id;
    if (a?.status === "received" && b?.status !== "received") changes.push(`${label} removed`);
    else if (a?.status !== "received" && b?.status === "received") changes.push(`${label} received`);
    else if (a?.status === "received" && b?.status === "received" && a.mediaId !== b.mediaId) changes.push(`${label} replaced`);
  }
  for (const prompt of promptQuestions(TEMPLATE)) {
    const a = before.recordings[prompt.id];
    const b = after.recordings[prompt.id];
    const label = PROMPT_LABELS[prompt.id] ?? prompt.id;
    if (a?.status === "received" && b?.status !== "received") changes.push(`${label} removed`);
    else if (a?.status !== "received" && b?.status === "received") changes.push(`${label} received`);
    else if (a?.status === "received" && b?.status === "received" && a.mediaId !== b.mediaId) changes.push(`${label} replaced`);
  }
  if ((before.signature?.name ?? "") !== (after.signature?.name ?? "")) changes.push(`signature name: "${before.signature?.name ?? ""}" to "${after.signature?.name ?? ""}"`);
  if ((before.signature?.signedAt ?? "") !== (after.signature?.signedAt ?? "")) changes.push(`signature date: ${before.signature?.signedAt || "none"} to ${after.signature?.signedAt || "none"}`);
  if (before.language !== after.language) changes.push(`form language: ${before.language} to ${after.language}`);
  if (before.submittedAt !== after.submittedAt) changes.push(`submission date: ${before.submittedAt} to ${after.submittedAt}`);
  if (before.reference !== after.reference) changes.push(`reference: ${before.reference} to ${after.reference}`);
  // Anything the lines above do not name is still a change: it is never ignored.
  if (changes.length === 0 && canonical(before) !== canonical(after)) changes.push("other details of the submission");
  return changes;
}

/**
 * A submission sent again by the family replaces the one under review:
 * answers, documents, recordings, signature, all of it. The draft keeps what
 * was already computed and takes from the fallback draft what the new
 * submission needs and the current draft does not hold. Approvals on
 * unchanged propositions stand; the file approval is detached.
 */
export function applySubmission(state: ReviewState, submission: Submission, fallback: Draft, now: string = new Date().toISOString()): ReviewState {
  const changes = describeSubmissionChanges(state.submission, submission);
  if (changes.length === 0 && submission.version === state.submission.version) return state;
  const documents = [...state.draft.documents];
  const recordings = [...state.draft.recordings];
  const fromFallback: string[] = [];
  for (const mediaId of mediaOfSubmission(submission)) {
    if (!documents.some((d) => d.mediaId === mediaId) && !recordings.some((r) => r.mediaId === mediaId)) {
      const doc = fallback.documents.find((d) => d.mediaId === mediaId);
      const rec = fallback.recordings.find((r) => r.mediaId === mediaId);
      if (doc) documents.push(doc);
      if (rec) recordings.push(rec);
      if (doc || rec) fromFallback.push(mediaId);
    }
  }
  const withheld = [...state.draft.withheld, ...fallback.withheld.filter((w) => fromFallback.includes(w.mediaId) && !state.draft.withheld.some((x) => x.mediaId === w.mediaId && x.key === w.key))];
  const media = [...new Set([...(state.draft.media ?? []), ...fromFallback])];
  const draft: Draft = { ...state.draft, documents, recordings, withheld, media };
  const version = state.version + 1;
  const summary = changes.length > 0 ? changes.join("; ") : `submission version ${submission.version}`;
  let next = rebuild(state, submission, draft, version, now, "the family sent the form again");
  next = entry(next, {
    at: now,
    actor: "parent",
    action: "submission_updated",
    detail: `The family sent the form again (submission version ${submission.version}): ${summary}.${fromFallback.length ? ` ${fromFallback.length === 1 ? "A new item was" : "New items were"} read from the recorded run.` : ""}`,
    target: "submission",
  });
  next = detachApproval(next, now, `the submission changed after the file was approved (${summary})`);
  return withStage(next, now, "Submission updated.");
}

export interface LiveRunExpectation {
  reference: string;
  media: string[];
  /** The build of the file the run was started for: a file reset or rebuilt since is another file. */
  builtAt?: string;
}

/** What a live run is started for: the file, its media, and this build of it. */
export function liveRunExpectation(state: ReviewState): LiveRunExpectation {
  return { reference: state.submission.reference, media: mediaOfSubmission(state.submission), builtAt: state.builtAt };
}

export interface LiveRunResult {
  state: ReviewState;
  applied: boolean;
  reason?: string;
}

/**
 * Applies the result of a live run to the file as it is now, not as it was
 * when the run started: a correction made during the wait stands. A result
 * computed for another file, for other media, or for another build of the
 * same file (reset or rebuilt since the run started) is not applied.
 */
export function applyLiveRun(current: ReviewState, expected: LiveRunExpectation, draft: Draft, now: string = new Date().toISOString()): LiveRunResult {
  const media = [...mediaOfSubmission(current.submission)].sort().join("|");
  if (current.submission.reference !== expected.reference || media !== [...expected.media].sort().join("|")) {
    return { state: current, applied: false, reason: "The file changed while the live run was in progress. Its result was not applied; run it again if you need it." };
  }
  if (expected.builtAt !== current.builtAt) {
    return { state: current, applied: false, reason: "The file was reset while the live run was in progress. Its result was not applied; run it again if you need it." };
  }
  return { state: replaceDraft(current, draft, now), applied: true };
}

/* ---------- Counts for the page ---------- */

export function documentCount(state: ReviewState): { received: number; requested: number } {
  const items = documentItems(TEMPLATE).filter((i) => i.required);
  const received = items.filter((i) => state.submission.documents[i.id]?.status === "received").length;
  return { received, requested: items.length };
}

export function focalProposition(state: ReviewState): Proposition | undefined {
  return (
    state.propositions.find((p) => p.finding === "missing" && p.requestable) ??
    state.propositions.find((p) => p.finding === "unreadable") ??
    state.propositions.find((p) => p.finding === "conflicting") ??
    state.propositions.find((p) => p.finding === "to_confirm") ??
    state.propositions.find((p) => p.finding === "withheld") ??
    state.propositions[0]
  );
}
