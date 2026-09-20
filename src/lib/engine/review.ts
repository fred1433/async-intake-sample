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
 */
import { documentItems, promptQuestions, TEMPLATE } from "../template";
import { dict, optionLabel } from "../i18n";
import type {
  Criterion,
  Day,
  DocumentExtraction,
  Draft,
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
  consistent: "Consistent",
  conflicting: "Sources disagree",
  to_confirm: "To confirm",
  unusable_audio: "Audio not usable",
  negative: "Stated as not working",
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

/* ---------- Small helpers ---------- */

export function hashOf(input: string): string {
  // FNV-1a, 32 bits, twice with different seeds. Enough to tell two versions apart.
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

const fold = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

function answerText(submission: Submission, id: string): string {
  const value = submission.answers[id];
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

function answerList(submission: Submission, id: string): string[] {
  const value = submission.answers[id];
  return Array.isArray(value) ? value : value ? [value] : [];
}

function dayList(days: string[], lang: Lang = "en"): string {
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

function contentHash(submission: Submission, draft: Draft, propositions: Proposition[]): string {
  const content = JSON.stringify([
    submission.version,
    draft.computedAt,
    Object.entries(submission.documents).map(([id, slot]) => [id, slot.status, slot.mediaId ?? null]),
    propositions.map((p) => [p.id, p.statement]),
  ]);
  return hashOf(content);
}

/* ---------- Building propositions from a submission and a draft ---------- */

function documentPropositions(submission: Submission, draft: Draft, now: string): Proposition[] {
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
      out.push({
        ...base,
        statement: item.required ? "Not received. Required for the file." : "Not received. Optional.",
        evidence: [{ kind: "form", questionId: `documents.${item.id}`, value: "Not attached" }],
        finding: "missing",
        history: [{ statement: "Not received.", by: "rule", at: now, version: 1 }],
        requestable: item.required ? "missing_item" : undefined,
        inRequest: item.required,
      });
      continue;
    }
    const extraction = draft.documents.find((d) => d.mediaId === slot.mediaId);
    if (extraction && !extraction.readable) {
      const statement = `Received, not readable: ${extraction.unreadableReason ?? "the copy could not be read"}.`;
      out.push({
        ...base,
        statement,
        evidence: [{ kind: "document", mediaId: slot.mediaId, page: 1, quote: "" }],
        finding: "unreadable",
        history: [{ statement, by: "ai", at: now, version: 1 }],
        requestable: "unreadable_item",
        inRequest: true,
      });
      continue;
    }
    const pages = extraction ? new Set(extraction.fields.map((f) => f.page)).size : 0;
    const statement = extraction
      ? `Received and readable. ${extraction.fields.length} field${extraction.fields.length === 1 ? "" : "s"} read${pages > 1 ? ` across ${pages} pages` : ""}.`
      : "Received. Not read yet.";
    out.push({
      ...base,
      statement,
      evidence: [{ kind: "document", mediaId: slot.mediaId, page: 1, quote: "" }],
      finding: "present",
      history: [{ statement, by: extraction ? "ai" : "rule", at: now, version: 1 }],
    });
  }
  return out;
}

function fieldCriterion(
  key: string,
  field: DocumentExtraction["fields"][number],
  submission: Submission,
): { criterion?: Criterion; finding: Finding } {
  const uncertainFinding: Finding = field.uncertain ? "to_confirm" : "present";
  switch (key) {
    case "patient_name": {
      const expected = fold(`${answerText(submission, "child_first_name")} ${answerText(submission, "child_last_name")}`);
      const met = fold(field.value) === expected;
      return {
        criterion: {
          id: "name_matches_form",
          label: "Name on the referral matches the intake form",
          rule: "Same first and last name, ignoring case and spacing.",
          result: met ? "met" : "not_met",
          note: met ? undefined : `Form: ${answerText(submission, "child_first_name")} ${answerText(submission, "child_last_name")}.`,
        },
        finding: met ? uncertainFinding : "conflicting",
      };
    }
    case "guardian_name": {
      const expected = fold(answerText(submission, "guardian_name"));
      const met = fold(field.value) === expected;
      return {
        criterion: {
          id: "guardian_matches_form",
          label: "Parent or guardian on the referral matches the intake form",
          rule: "Same full name, ignoring case and spacing.",
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
          rule: "Referral date at most 365 days before the submission date, and not after it.",
          result: age === null ? "not_assessable" : met ? "met" : "not_met",
          note: age === null ? "No date could be read in machine form." : `${age} days before the submission.`,
        },
        finding: age === null ? "to_confirm" : met ? uncertainFinding : "conflicting",
      };
    }
    case "referring_provider":
      return {
        criterion: {
          id: "provider_named",
          label: "Referral names a referring provider",
          rule: "A provider name appears on the letter.",
          result: field.value.trim() ? "met" : "not_met",
        },
        finding: uncertainFinding,
      };
    case "service_requested":
      return {
        criterion: {
          id: "service_named",
          label: "Referral names the service requested",
          rule: "The letter states what the child is referred for.",
          result: field.value.trim() ? "met" : "not_met",
        },
        finding: uncertainFinding,
      };
    case "diagnosis_reference":
      return {
        criterion: {
          id: "diagnosis_reference_present",
          label: "Referral includes a diagnosis reference",
          rule: "The letter refers to a diagnosis on file. Nothing about it is assessed here.",
          result: field.value.trim() ? "met" : "not_met",
        },
        finding: uncertainFinding,
      };
    case "dependent_name": {
      const expected = fold(`${answerText(submission, "child_first_name")} ${answerText(submission, "child_last_name")}`);
      const met = fold(field.value) === expected;
      return {
        criterion: {
          id: "dependent_matches_child",
          label: "Dependent on the card matches the child's name",
          rule: "Same first and last name, ignoring case and spacing.",
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
          rule: "Effective date not after the submission date. Eligibility itself is not checked here.",
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

function extractionPropositions(submission: Submission, draft: Draft, now: string): Proposition[] {
  const out: Proposition[] = [];
  for (const item of documentItems(TEMPLATE)) {
    const slot = submission.documents[item.id];
    if (!slot || slot.status !== "received" || !slot.mediaId) continue;
    const extraction = draft.documents.find((d) => d.mediaId === slot.mediaId);
    if (!extraction || !extraction.readable) continue;
    const group: PropositionGroup = item.id === "insurance_card" ? "insurance_card" : "referral_letter";
    const fields = [...extraction.fields].sort((a, b) => FIELD_ORDER.indexOf(a.key) - FIELD_ORDER.indexOf(b.key));
    for (const field of fields) {
      const { criterion, finding } = fieldCriterion(field.key, field, submission);
      const id = `field:${slot.mediaId}:${field.key}`;
      out.push({
        id,
        group,
        label: field.label,
        statement: field.value,
        nature: "extraction",
        evidence: [{ kind: "document", mediaId: slot.mediaId, page: field.page, quote: field.quote }],
        finding,
        criterion: field.uncertain && criterion ? { ...criterion, note: [criterion.note, `Uncertain: ${field.uncertain}`].filter(Boolean).join(" ") } : criterion,
        state: "proposed",
        history: [{ statement: field.value, by: "ai", at: now, version: 1 }],
        dependsOn: [],
        inRequest: false,
      });
      if (field.key === "referring_provider") {
        out.push({
          id: `${id}:license`,
          group,
          label: "Provider license status",
          statement: "Not assessable from the document.",
          nature: "rule",
          evidence: [{ kind: "document", mediaId: slot.mediaId, page: field.page, quote: field.quote }],
          finding: "present",
          criterion: {
            id: "license_status",
            label: "Referring provider holds a current license",
            rule: "Would need a registry lookup. The letter alone cannot answer it.",
            result: "not_assessable",
          },
          state: "proposed",
          history: [{ statement: "Not assessable from the document.", by: "rule", at: now, version: 1 }],
          dependsOn: [id],
          inRequest: false,
        });
      }
    }
  }
  return out;
}

function recordingPropositions(submission: Submission, draft: Draft, now: string): Proposition[] {
  const out: Proposition[] = [];
  for (const prompt of promptQuestions(TEMPLATE)) {
    const label = PROMPT_LABELS[prompt.id] ?? prompt.id;
    const slot = submission.recordings[prompt.id] ?? { status: "missing" as const };
    if (slot.status === "missing" || !slot.mediaId) {
      out.push({
        id: `rec:${prompt.id}`,
        group: "recording",
        label,
        statement: "No recorded answer was received.",
        nature: "rule",
        evidence: [{ kind: "form", questionId: `recordings.${prompt.id}`, value: "Not attached" }],
        finding: "missing",
        state: "proposed",
        history: [{ statement: "No recorded answer was received.", by: "rule", at: now, version: 1 }],
        dependsOn: [],
        requestable: "missing_item",
        inRequest: true,
      });
      continue;
    }
    const review = draft.recordings.find((r) => r.mediaId === slot.mediaId);
    if (!review) continue;
    if (review.transcript.unusable) {
      const statement = `The recording could not be used: ${review.transcript.unusable}`;
      out.push({
        id: `rec:${prompt.id}:unusable`,
        group: "recording",
        label,
        statement,
        nature: "rule",
        evidence: [{ kind: "audio", mediaId: slot.mediaId, start: 0, end: slot.durationSeconds ?? 0, quote: "" }],
        finding: "unusable_audio",
        state: "proposed",
        history: [{ statement, by: "ai", at: now, version: 1 }],
        dependsOn: [],
        requestable: "unreadable_item",
        inRequest: true,
      });
      continue;
    }
    const mediaId = slot.mediaId;
    review.claims.forEach((claim, index) => {
      const finding: Finding = claim.uncertain ? "to_confirm" : claim.key === "days_that_do_not_work" ? "negative" : "present";
      const criterion: Criterion | undefined =
        claim.key === "days_that_work" || claim.key === "time_window"
          ? {
              id: "availability_stated",
              label: "Availability stated",
              rule: "At least one day or time window is stated by the parent.",
              result: claim.days.length > 0 || claim.earliestHour !== null ? "met" : "not_assessable",
              note: claim.uncertain ? `Uncertain: ${claim.uncertain}` : undefined,
            }
          : undefined;
      out.push({
        id: `claim:${mediaId}:${claim.key}:${index}`,
        group: "recording",
        label: claim.label,
        statement: claim.statement,
        nature: claim.nature,
        evidence: [{ kind: "audio", mediaId, start: claim.segment.start, end: claim.segment.end, quote: claim.quote }],
        finding,
        criterion,
        state: "proposed",
        history: [{ statement: claim.statement, by: "ai", at: now, version: 1 }],
        dependsOn: [],
        inRequest: false,
      });
    });
  }
  return out;
}

function crossCheckPropositions(submission: Submission, draft: Draft, recordingProps: Proposition[], now: string): Proposition[] {
  const out: Proposition[] = [];
  const prompt = promptQuestions(TEMPLATE)[0];
  const slot = prompt ? submission.recordings[prompt.id] : undefined;
  const review = slot?.mediaId ? draft.recordings.find((r) => r.mediaId === slot.mediaId) : undefined;
  if (!review || review.transcript.unusable) return out;

  const claimProp = (key: string) => recordingProps.find((p) => p.id.startsWith(`claim:${review.mediaId}:${key}:`));
  const claimsOf = (key: string) => review.claims.filter((c) => c.key === key);

  const formDays = answerList(submission, "preferred_days");
  const works = claimsOf("days_that_work").flatMap((c) => c.days);
  const doesNot = claimsOf("days_that_do_not_work").flatMap((c) => c.days);
  if (works.length > 0 || doesNot.length > 0) {
    const contradicted = formDays.filter((d) => doesNot.includes(d as Day));
    const negative = claimsOf("days_that_do_not_work")[0];
    const positive = claimsOf("days_that_work")[0];
    const evidence: Evidence[] = [{ kind: "form", questionId: "preferred_days", value: dayList(formDays) || "none" }];
    if (negative) evidence.push({ kind: "audio", mediaId: review.mediaId, start: negative.segment.start, end: negative.segment.end, quote: negative.quote });
    if (positive) evidence.push({ kind: "audio", mediaId: review.mediaId, start: positive.segment.start, end: positive.segment.end, quote: positive.quote });
    const dependsOn = [claimProp("days_that_work")?.id, claimProp("days_that_do_not_work")?.id].filter((x): x is string => !!x);
    if (contradicted.length > 0) {
      const statement = `To confirm with the family. The form lists ${dayList(formDays)}; the recorded answer says ${dayList(contradicted)} ${contradicted.length > 1 ? "do" : "does"} not work. No day has been chosen.`;
      out.push({
        id: "xcheck:days",
        group: "cross_checks",
        label: "Preferred days",
        statement,
        nature: "rule",
        evidence,
        finding: "conflicting",
        criterion: {
          id: "sources_agree_days",
          label: "Form and recorded answer agree on days",
          rule: "No day listed on the form is stated as not working in the recording.",
          result: "not_met",
          note: `${dayList(contradicted)} appears in both.`,
        },
        state: "proposed",
        history: [{ statement, by: "rule", at: now, version: 1 }],
        dependsOn,
        requestable: "confirm",
        inRequest: false,
        details: { formDays, contradicted },
      });
    } else {
      const agreed = formDays.length > 0 ? formDays : works;
      const statement = `The form and the recorded answer agree: ${dayList(agreed) || "no day stated"}.`;
      out.push({
        id: "xcheck:days",
        group: "cross_checks",
        label: "Preferred days",
        statement,
        nature: "rule",
        evidence,
        finding: "consistent",
        criterion: {
          id: "sources_agree_days",
          label: "Form and recorded answer agree on days",
          rule: "No day listed on the form is stated as not working in the recording.",
          result: "met",
        },
        state: "proposed",
        history: [{ statement, by: "rule", at: now, version: 1 }],
        dependsOn,
        inRequest: false,
      });
    }
  }

  const time = claimsOf("time_window")[0];
  const formTime = answerText(submission, "preferred_time");
  if (time && formTime) {
    const formHour = FORM_TIME_HOUR[formTime] ?? null;
    const agree = time.earliestHour !== null && formHour !== null && time.earliestHour === formHour;
    const unknown = time.earliestHour === null || formHour === null;
    const statement = unknown
      ? `The form says ${optionLabel("en", formTime).toLowerCase()}; the recorded answer gives no comparable hour.`
      : agree
        ? `The form and the recorded answer agree: ${optionLabel("en", formTime).toLowerCase()}.`
        : `To confirm with the family. The form says ${optionLabel("en", formTime).toLowerCase()}; the recorded answer says from ${time.earliestHour}:00.`;
    out.push({
      id: "xcheck:time",
      group: "cross_checks",
      label: "Time of day",
      statement,
      nature: "rule",
      evidence: [
        { kind: "form", questionId: "preferred_time", value: optionLabel("en", formTime) },
        { kind: "audio", mediaId: review.mediaId, start: time.segment.start, end: time.segment.end, quote: time.quote },
      ],
      finding: unknown ? "to_confirm" : agree ? "consistent" : "conflicting",
      criterion: {
        id: "sources_agree_time",
        label: "Form and recorded answer agree on the time of day",
        rule: "The earliest hour stated in the recording equals the hour the form option starts at.",
        result: unknown ? "not_assessable" : agree ? "met" : "not_met",
      },
      state: "proposed",
      history: [{ statement, by: "rule", at: now, version: 1 }],
      dependsOn: [claimProp("time_window")?.id].filter((x): x is string => !!x),
      requestable: unknown || agree ? undefined : "confirm",
      inRequest: false,
    });
  }

  const location = claimsOf("location_preference")[0];
  const formLocation = answerText(submission, "location");
  if (location && formLocation) {
    const compatible = location.location === null || formLocation === "either" || formLocation === location.location;
    const place = (value: string | null) => (value === "home" ? "sessions at home" : value === "center" ? "sessions at the center" : "either place");
    const statement = compatible
      ? formLocation === "either" && location.location
        ? `The form allows either place; the parent prefers ${place(location.location)}.`
        : `The form and the recorded answer agree: ${place(formLocation)}.`
      : `To confirm with the family. The form says ${place(formLocation)}; the recorded answer prefers ${place(location.location)}.`;
    out.push({
      id: "xcheck:location",
      group: "cross_checks",
      label: "Where sessions take place",
      statement,
      nature: "rule",
      evidence: [
        { kind: "form", questionId: "location", value: optionLabel("en", formLocation) },
        { kind: "audio", mediaId: review.mediaId, start: location.segment.start, end: location.segment.end, quote: location.quote },
      ],
      finding: compatible ? "consistent" : "conflicting",
      criterion: {
        id: "sources_agree_location",
        label: "Form and recorded answer are compatible on the place",
        rule: "The recorded preference is allowed by the form answer.",
        result: compatible ? "met" : "not_met",
      },
      state: "proposed",
      history: [{ statement, by: "rule", at: now, version: 1 }],
      dependsOn: [claimProp("location_preference")?.id].filter((x): x is string => !!x),
      requestable: compatible ? undefined : "confirm",
      inRequest: false,
    });
  }
  return out;
}

export function buildPropositions(submission: Submission, draft: Draft, now: string): Proposition[] {
  const docs = documentPropositions(submission, draft, now);
  const fields = extractionPropositions(submission, draft, now);
  const recording = recordingPropositions(submission, draft, now);
  const cross = crossCheckPropositions(submission, draft, recording, now);
  return [...docs, ...fields, ...recording, ...cross];
}

/* ---------- The request to the family (rule 1) ---------- */

export function requestText(submission: Submission, propositions: Proposition[], items: RequestItem[], code: string): string {
  const lang = submission.language;
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
    if (id.startsWith("rec:")) return lang === "es" ? "Su respuesta grabada" : "Your recorded answer";
    return id;
  };
  if (missing.length > 0) {
    lines.push("", missing.length > 1 ? t.missingIntroPlural : t.missingIntro);
    for (const item of missing) {
      const label = labelOf(item.propositionId);
      lines.push(item.kind === "unreadable_item" ? `- ${t.unreadableItem(label)}` : `- ${t.missingItem(label)}`);
    }
  }
  if (confirms.length > 0) {
    lines.push("", t.confirmIntro);
    for (const item of confirms) {
      const prop = propositions.find((p) => p.id === item.propositionId);
      if (item.propositionId === "xcheck:days" && prop?.details) {
        const formDays = dayList(prop.details.formDays ?? [], lang);
        const recordedDay = dayList(prop.details.contradicted ?? [], lang);
        lines.push(`- ${t.confirmDays(formDays, recordedDay)}`);
      } else {
        lines.push(`- ${prop?.statement ?? item.propositionId}`);
      }
    }
  }
  lines.push("", t.resume(code), "", t.closing, t.signature);
  return lines.join("\n");
}

function prepareRequest(submission: Submission, propositions: Proposition[], previous?: RequestDraft): RequestDraft | undefined {
  const items: RequestItem[] = [];
  for (const p of propositions) {
    if (p.inRequest && p.requestable) {
      const kept = previous?.items.find((i) => i.propositionId === p.id);
      items.push(kept ?? { propositionId: p.id, kind: p.requestable });
    }
  }
  // Items answered since stay in the record, marked satisfied.
  for (const item of previous?.items ?? []) {
    if (!items.some((i) => i.propositionId === item.propositionId)) items.push(item);
  }
  if (items.length === 0) return undefined;
  return {
    language: submission.language,
    items,
    text: requestText(submission, propositions, items, submission.reference),
    status: previous?.status ?? "draft",
    approvedAt: previous?.approvedAt,
    approvedText: previous?.approvedText,
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
      (p.finding === "conflicting" || p.finding === "to_confirm" || p.finding === "unusable_audio") &&
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

/* ---------- Building the review ---------- */

export function buildReview(submission: Submission, draft: Draft, now: string = new Date().toISOString()): ReviewState {
  const propositions = buildPropositions(submission, draft, now);
  const request = prepareRequest(submission, propositions);
  let state: ReviewState = {
    submission,
    draft,
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
    detail: `Draft ${draft.origin === "live" ? "computed just now" : "from the recorded run"}: ${docs} document${docs === 1 ? "" : "s"}, ${recs} recording${recs === 1 ? "" : "s"}, ${propositions.length} propositions, ${draft.withheld.length} withheld by the source check.`,
  });
  if (request) {
    state = entry(state, {
      at: now,
      actor: "rule",
      action: "request_prepared",
      detail: `Rule 1: request to the family prepared for ${request.items.length} item${request.items.length === 1 ? "" : "s"}. Not sent.`,
      target: "request",
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
  if (p.finding === "conflicting" && p.state === "proposed") {
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
  let next = replace(state, { ...p, state: "approved", approvedAt: now, recheck: undefined });
  next = entry(next, {
    at: now,
    actor: "reviewer",
    action: "approved",
    detail: `${p.label}: approved as "${p.statement}".`,
    target: p.id,
  });
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
  if (next.request?.items.some((i) => i.propositionId === p.id)) {
    const request = prepareRequest(next.submission, next.propositions, next.request);
    next = { ...next, request };
  }
  next = detachApproval(next, now, `${p.label} was corrected after the file was approved`);
  return withStage(next, now, "Content changed.");
}

export function addToRequest(state: ReviewState, id: string, now: string = new Date().toISOString()): ReviewState {
  const p = find(state, id);
  if (!p.requestable) throw new Refused("nothing_to_add", "This proposition cannot go into a request.");
  if (p.inRequest) return state;
  let next = replace(state, { ...p, inRequest: true });
  const previous = next.request;
  const request = prepareRequest(next.submission, next.propositions, previous);
  const reopened = previous?.status === "approved";
  next = { ...next, request: request ? { ...request, status: "draft", approvedAt: undefined } : request };
  next = entry(next, {
    at: now,
    actor: "reviewer",
    action: "added_to_request",
    detail: `${p.label}: added to the request to the family.${reopened ? " The request goes back to draft." : ""}`,
    target: p.id,
  });
  return withStage(next, now, "Request changed.");
}

export function approveRequest(state: ReviewState, now: string = new Date().toISOString()): ReviewState {
  if (!state.request || state.request.items.every((i) => i.satisfiedAt)) {
    throw new Refused("nothing_to_add", "There is no request to approve.");
  }
  if (state.request.status === "approved") {
    return entry(state, { at: now, actor: "reviewer", action: "approval_repeated", detail: "Request already approved. No change.", target: "request" });
  }
  const request: RequestDraft = { ...state.request, status: "approved", approvedAt: now, approvedText: state.request.text };
  let next: ReviewState = { ...state, request };
  next = entry(next, {
    at: now,
    actor: "reviewer",
    action: "request_approved",
    detail: `Request to the family approved (${request.items.filter((i) => !i.satisfiedAt).length} item${request.items.length === 1 ? "" : "s"}). Not sent: this sample sends nothing.`,
    target: "request",
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
  const hash = contentHash(state.submission, state.draft, state.propositions);
  const approval = {
    version: state.version,
    hash,
    at: now,
    by: "reviewer" as const,
    snapshot: state.propositions.map((p) => ({ id: p.id, statement: p.statement, state: p.state })),
  };
  let next: ReviewState = { ...state, approval };
  next = entry(next, {
    at: now,
    actor: "reviewer",
    action: "file_approved",
    detail: `Rule 3: version ${approval.version} approved (content ${approval.hash}). ${approval.snapshot.length} propositions kept as approved.`,
    target: "file",
  });
  return withStage(next, now, "Rule 3: reviewer approved the current version.");
}

/* ---------- Changes that arrive after the review started ---------- */

/** Keeps what the reviewer did on propositions that still exist unchanged. */
function merge(previous: Proposition[], fresh: Proposition[], now: string, because: string): Proposition[] {
  return fresh.map((next) => {
    const old = previous.find((p) => p.id === next.id);
    if (!old) return next;
    const sourceStatement = next.history[0]?.statement ?? next.statement;
    const oldSource = old.history[0]?.statement ?? old.statement;
    if (sourceStatement === oldSource) {
      // Same source, same statement: the reviewer's work stands.
      return { ...old, evidence: next.evidence, dependsOn: next.dependsOn, requestable: next.requestable, inRequest: old.inRequest || next.inRequest };
    }
    // The source produced something else: a new proposed statement, the old one kept in history.
    return {
      ...next,
      history: [...old.history, ...next.history.map((h) => ({ ...h, at: now }))],
      recheck: old.state !== "proposed" ? { because, at: now } : undefined,
      inRequest: old.inRequest || next.inRequest,
    };
  });
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
  const fresh = buildPropositions(submission, draft, now);
  const propositions = merge(state.propositions, fresh, now, `${label} was received`);
  let next: ReviewState = { ...state, submission, draft, propositions, version };
  const previous = state.request
    ? {
        ...state.request,
        items: state.request.items.map((i) => (i.propositionId === `doc:${itemId}` && !i.satisfiedAt ? { ...i, satisfiedAt: now } : i)),
      }
    : undefined;
  next = { ...next, request: prepareRequest(submission, propositions, previous) };
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
  const fresh = buildPropositions(state.submission, draft, now);
  const propositions = merge(state.propositions, fresh, now, "the draft was computed again");
  let next: ReviewState = { ...state, draft, propositions, version };
  next = { ...next, request: prepareRequest(next.submission, propositions, state.request) };
  next = entry(next, {
    at: now,
    actor: "ai",
    action: "draft_replaced",
    detail: `Draft ${draft.origin === "live" ? "computed just now" : "restored from the recorded run"}: ${propositions.length} propositions, ${draft.withheld.length} withheld by the source check.`,
  });
  next = detachApproval(next, now, "the draft was computed again after the file was approved");
  return withStage(next, now, "Draft replaced.");
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
    state.propositions[0]
  );
}
