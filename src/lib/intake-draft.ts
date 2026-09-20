/**
 * The parent's form in progress, as it is kept in this browser under a resume
 * code, and how it becomes a Submission when the parent saves it for review.
 * The sample file has a draft too, so its code resumes the form the reviewer
 * is looking at.
 */
import type { DocumentSlot, FieldValue, Lang, RecordingSlot, Submission } from "./engine/types";
import { SAMPLE_REFERENCE, SAMPLE_SUBMISSION } from "./sample";

export interface IntakeDraft {
  code: string;
  lang: Lang;
  step: number;
  answers: Record<string, FieldValue>;
  documents: Record<string, DocumentSlot>;
  recordings: Record<string, RecordingSlot>;
  signature?: { name: string; signedAt: string; ink: boolean };
  startedAt: string;
  submittedVersion?: number;
  submittedAt?: string;
}

export const STEPS = ["child", "guardian", "scheduling", "documents", "recorded", "signature", "review"] as const;
export type StepId = (typeof STEPS)[number];

/** The sample parent's form, saved for review, open on the documents step where the insurance card is still missing. */
export function sampleIntakeDraft(): IntakeDraft {
  return {
    code: SAMPLE_REFERENCE,
    lang: SAMPLE_SUBMISSION.language,
    step: STEPS.indexOf("documents"),
    answers: structuredClone(SAMPLE_SUBMISSION.answers),
    documents: structuredClone(SAMPLE_SUBMISSION.documents),
    recordings: structuredClone(SAMPLE_SUBMISSION.recordings),
    signature: SAMPLE_SUBMISSION.signature ? { ...SAMPLE_SUBMISSION.signature, ink: true } : undefined,
    startedAt: SAMPLE_SUBMISSION.submittedAt,
    submittedVersion: SAMPLE_SUBMISSION.version,
    submittedAt: SAMPLE_SUBMISSION.submittedAt,
  };
}

/**
 * The parent changes the language of the screen. The language of the messages
 * (contact_language) is a separate answer on the form: it is not rewritten.
 */
export function switchDraftLanguage(draft: IntakeDraft, lang: Lang): IntakeDraft {
  return { ...draft, lang };
}

/**
 * The submission a saved form becomes. A form saved again keeps its first
 * submission date and moves the version; the sample form continues from the
 * sample submission.
 */
export function submissionFromDraft(draft: IntakeDraft, previous: Submission | null, now: string): Submission {
  const continues = previous && previous.reference === draft.code ? previous : draft.code === SAMPLE_REFERENCE ? SAMPLE_SUBMISSION : null;
  return {
    reference: draft.code,
    submittedAt: continues ? continues.submittedAt : now,
    language: draft.lang,
    answers: draft.answers,
    documents: draft.documents,
    recordings: draft.recordings,
    signature: draft.signature ? { name: draft.signature.name, signedAt: draft.signature.signedAt } : undefined,
    version: continues ? continues.version + 1 : 1,
  };
}
