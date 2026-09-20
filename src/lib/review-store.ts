/**
 * Where the reviewer's state comes from in the browser.
 *
 * The draft is the recorded run unless the reviewer asks for a live one. The
 * submission is the sample, or the one the visitor completed in the intake
 * flow. What the reviewer did is kept in this browser between page loads; a
 * submission that gained a document since is fed through receiveDocument, so
 * approvals are detached the way the rules say, not wiped.
 */
import recordedDraft from "./fixtures/recorded-draft.json";
import { buildReview, receiveDocument } from "./engine/review";
import type { Draft, ReviewState, Submission } from "./engine/types";
import { SAMPLE_SUBMISSION } from "./sample";
import { loadJSON, removeKey, REVIEW_KEY, saveJSON, SUBMISSION_KEY } from "./storage";
import { documentItems, TEMPLATE } from "./template";

export const RECORDED_DRAFT = recordedDraft as Draft;

export function currentSubmission(): Submission {
  return loadJSON<Submission>(SUBMISSION_KEY) ?? SAMPLE_SUBMISSION;
}

export function isSampleSubmission(submission: Submission): boolean {
  return submission.reference === SAMPLE_SUBMISSION.reference;
}

export function loadReview(now: string = new Date().toISOString()): ReviewState {
  const submission = currentSubmission();
  const stored = loadJSON<ReviewState>(REVIEW_KEY);
  if (stored && stored.submission.reference === submission.reference && stored.draft && stored.propositions) {
    let state = stored;
    if (submission.version > stored.submission.version) {
      for (const item of documentItems(TEMPLATE)) {
        const slot = submission.documents[item.id];
        if (slot?.status === "received" && slot.mediaId && state.submission.documents[item.id]?.status !== "received") {
          const extraction = state.draft.documents.find((d) => d.mediaId === slot.mediaId) ?? RECORDED_DRAFT.documents.find((d) => d.mediaId === slot.mediaId);
          state = receiveDocument(state, item.id, slot.mediaId, extraction, now);
        }
      }
      saveJSON(REVIEW_KEY, state);
    }
    return state;
  }
  const fresh = buildReview(submission, RECORDED_DRAFT, now);
  saveJSON(REVIEW_KEY, fresh);
  return fresh;
}

export function persistReview(state: ReviewState): void {
  saveJSON(REVIEW_KEY, state);
}

/** Back to the sample file and the recorded draft, as a first visitor sees it. */
export function resetToSample(now: string = new Date().toISOString()): ReviewState {
  removeKey(REVIEW_KEY);
  removeKey(SUBMISSION_KEY);
  const fresh = buildReview(SAMPLE_SUBMISSION, RECORDED_DRAFT, now);
  saveJSON(REVIEW_KEY, fresh);
  return fresh;
}

/** The media a live run has to read for this submission. */
export function mediaForLiveRun(submission: Submission): string[] {
  const ids: string[] = [];
  for (const slot of Object.values(submission.documents)) if (slot.status === "received" && slot.mediaId) ids.push(slot.mediaId);
  for (const slot of Object.values(submission.recordings)) if (slot.status === "received" && slot.mediaId) ids.push(slot.mediaId);
  return ids;
}
