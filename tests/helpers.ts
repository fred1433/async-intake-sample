/**
 * Synthetic drafts for the engine tests, built from the sample text layers so
 * that every quote is real. The transcript is written by hand here: the tests
 * must not depend on a model answer.
 */
import type { RawDraft, RawTranscript } from "../src/lib/engine/raw";
import type { Draft, Submission, Transcript } from "../src/lib/engine/types";
import { transcriptFromRaw, verifyDraft, type DocumentSource } from "../src/lib/engine/verify";
import { documentOf, pageText, SAMPLE_SUBMISSION } from "../src/lib/sample";

export const NOW = "2026-09-20T15:00:00.000Z";

export const HAND_TRANSCRIPT: RawTranscript = {
  segments: [
    { start: 0.0, end: 1.2, text: "Hi, so," },
    { start: 1.2, end: 4.4, text: "Tuesdays work best for us, any time after three." },
    { start: 4.4, end: 7.9, text: "Not Thursdays, Sam has swimming on Thursdays." },
    { start: 7.9, end: 12.4, text: "And if it's possible, we would rather do the sessions at home." },
  ],
  complete: true,
  note: null,
};

export function source(id: string): DocumentSource {
  const doc = documentOf(id);
  const pages: Record<number, string> = {};
  for (const page of doc.pages) pages[page.number] = pageText(doc, page.number);
  return { mediaId: id, pages };
}

export function transcript(raw: RawTranscript = HAND_TRANSCRIPT): Transcript {
  return transcriptFromRaw("recording-scheduling", raw);
}

export const RAW_DRAFT: RawDraft = {
  documents: [
    {
      mediaId: "referral-letter",
      readable: true,
      unreadableReason: null,
      fields: [
        { key: "patient_name", label: "Patient name", value: "Sam Bennett", normalized: null, page: 1, quote: "Patient: Sam Bennett", uncertain: null },
        { key: "date_of_birth", label: "Date of birth", value: "March 14, 2020", normalized: "2020-03-14", page: 1, quote: "Date of birth: March 14, 2020", uncertain: null },
        { key: "guardian_name", label: "Parent or guardian", value: "Jordan Bennett", normalized: null, page: 1, quote: "Parent or guardian: Jordan Bennett", uncertain: null },
        { key: "referral_date", label: "Referral date", value: "August 28, 2026", normalized: "2026-08-28", page: 1, quote: "August 28, 2026", uncertain: null },
        { key: "referring_provider", label: "Referring provider", value: "Alice Moreno, MD, Pediatrics", normalized: null, page: 1, quote: "Alice Moreno, MD", uncertain: null },
        {
          key: "service_requested",
          label: "Service requested",
          value: "Evaluation for applied behavior analysis (ABA) services",
          normalized: null,
          page: 1,
          quote: "I am referring Sam Bennett for an evaluation for applied behavior analysis (ABA) services.",
          uncertain: null,
        },
        {
          key: "diagnosis_reference",
          label: "Diagnosis reference",
          value: "Listed: autism spectrum disorder (F84.0), evaluation dated June 2, 2026",
          normalized: null,
          page: 1,
          quote: "A diagnostic evaluation dated June 2, 2026 is on file at our office; the diagnosis listed on that evaluation is autism spectrum disorder (F84.0).",
          uncertain: null,
        },
      ],
    },
    {
      mediaId: "insurance-card",
      readable: true,
      unreadableReason: null,
      fields: [
        { key: "member_name", label: "Member name", value: "Jordan Bennett", normalized: null, page: 1, quote: "Member: Jordan Bennett", uncertain: null },
        { key: "member_id", label: "Member ID", value: "SHP 4471 2290", normalized: null, page: 1, quote: "Member ID: SHP 4471 2290", uncertain: null },
        { key: "group_number", label: "Group number", value: "88213", normalized: null, page: 1, quote: "Group: 88213", uncertain: null },
        { key: "plan_name", label: "Plan", value: "Family Plus PPO", normalized: null, page: 1, quote: "Plan: Family Plus PPO", uncertain: null },
        { key: "dependent_name", label: "Dependent", value: "Sam Bennett", normalized: null, page: 1, quote: "Dependent 01: Sam Bennett", uncertain: null },
        { key: "effective_date", label: "Effective date", value: "01/01/2026", normalized: "2026-01-01", page: 1, quote: "Effective: 01/01/2026", uncertain: null },
        { key: "member_services_phone", label: "Member services phone", value: "(800) 555-0121", normalized: null, page: 2, quote: "Member services: (800) 555-0121", uncertain: null },
      ],
    },
  ],
  recordings: [
    {
      mediaId: "recording-scheduling",
      claims: [
        {
          key: "days_that_work",
          label: "Days that work",
          statement: "The parent states that Tuesdays work best, any time after 3 pm.",
          nature: "rephrase",
          quote: "Tuesdays work best for us, any time after three.",
          days: ["tuesday"],
          earliestHour: 15,
          location: null,
          uncertain: null,
        },
        {
          key: "days_that_do_not_work",
          label: "Days that do not work",
          statement: "The parent states that Thursdays do not work because of swimming.",
          nature: "rephrase",
          quote: "Not Thursdays, Sam has swimming on Thursdays.",
          days: ["thursday"],
          earliestHour: null,
          location: null,
          uncertain: null,
        },
        {
          key: "time_window",
          label: "Time of day",
          statement: "The parent states that any time after 3 pm works.",
          nature: "rephrase",
          quote: "any time after three",
          days: [],
          earliestHour: 15,
          location: null,
          uncertain: null,
        },
        {
          key: "location_preference",
          label: "Where sessions take place",
          statement: "The parent states a preference for sessions at home, if possible.",
          nature: "rephrase",
          quote: "we would rather do the sessions at home",
          days: [],
          earliestHour: null,
          location: "home",
          uncertain: null,
        },
      ],
    },
  ],
};

export function draft(raw: RawDraft = RAW_DRAFT, rawTranscript: RawTranscript = HAND_TRANSCRIPT, origin: Draft["origin"] = "recorded"): Draft {
  return verifyDraft(
    raw,
    {
      documents: [source("referral-letter"), source("insurance-card")],
      recordings: [{ mediaId: "recording-scheduling", transcript: transcript(rawTranscript) }],
    },
    { origin, computedAt: NOW },
  );
}

export function submission(overrides: Partial<Submission> = {}): Submission {
  return structuredClone({ ...SAMPLE_SUBMISSION, ...overrides });
}
