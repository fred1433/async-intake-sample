/**
 * Where the reviewer's state comes from in the browser.
 *
 * The draft is the recorded run unless the reviewer asks for a live one. The
 * submission is the sample, or the one the visitor saved in the intake flow.
 * What the reviewer did is kept in this browser between page loads; a
 * submission that changed since (any answer, document, recording or
 * signature, not only an added document) is fed through applySubmission, so
 * approvals are detached the way the rules say, not wiped and not kept by
 * mistake.
 */
import recordedDraft from "./fixtures/recorded-draft.json";
import { applySubmission, buildReview, mediaOfSubmission } from "./engine/review";
import type { Draft, ReviewState, Submission } from "./engine/types";
import { sampleIntakeDraft } from "./intake-draft";
import { SAMPLE_SUBMISSION } from "./sample";
import { INTAKE_PREFIX, loadJSON, removeKey, REVIEW_KEY, saveJSON, SUBMISSION_KEY } from "./storage";

export const RECORDED_DRAFT = recordedDraft as Draft;

export function currentSubmission(): Submission {
  return loadJSON<Submission>(SUBMISSION_KEY) ?? SAMPLE_SUBMISSION;
}

export function isSampleSubmission(submission: Submission): boolean {
  return submission.reference === SAMPLE_SUBMISSION.reference;
}

function usable(stored: ReviewState | null): stored is ReviewState {
  return Boolean(
    stored &&
      stored.submission &&
      stored.draft &&
      typeof stored.builtAt === "string" &&
      Array.isArray(stored.propositions) &&
      stored.propositions.every((p) => typeof p.sourceKey === "string") &&
      (!stored.request || (typeof stored.request.contextKey === "string" && stored.request.items.every((i) => typeof i.instance === "number"))) &&
      Array.isArray(stored.journal),
  );
}

/** The sample parent's form is kept under its code, so the resume code shown in the request works. */
export function ensureSampleIntakeDraft(): void {
  if (!loadJSON(INTAKE_PREFIX + SAMPLE_SUBMISSION.reference)) saveJSON(INTAKE_PREFIX + SAMPLE_SUBMISSION.reference, sampleIntakeDraft());
}

export function loadReview(now: string = new Date().toISOString()): ReviewState {
  const submission = currentSubmission();
  const stored = loadJSON<ReviewState>(REVIEW_KEY);
  if (usable(stored) && stored.submission.reference === submission.reference) {
    let state = stored;
    if (JSON.stringify(stored.submission) !== JSON.stringify(submission)) {
      state = applySubmission(stored, submission, RECORDED_DRAFT, now);
      saveJSON(REVIEW_KEY, state);
    }
    return state;
  }
  const fresh = buildReview(submission, RECORDED_DRAFT, now);
  saveJSON(REVIEW_KEY, fresh);
  if (isSampleSubmission(submission)) ensureSampleIntakeDraft();
  return fresh;
}

export function persistReview(state: ReviewState): void {
  saveJSON(REVIEW_KEY, state);
}

/** Back to the sample file and the recorded draft, as a first visitor sees it. */
export function resetToSample(now: string = new Date().toISOString()): ReviewState {
  removeKey(REVIEW_KEY);
  removeKey(SUBMISSION_KEY);
  removeKey(INTAKE_PREFIX + SAMPLE_SUBMISSION.reference);
  const fresh = buildReview(SAMPLE_SUBMISSION, RECORDED_DRAFT, now);
  saveJSON(REVIEW_KEY, fresh);
  ensureSampleIntakeDraft();
  return fresh;
}

/** The media a live run has to read for this submission. */
export function mediaForLiveRun(submission: Submission): string[] {
  return mediaOfSubmission(submission);
}
