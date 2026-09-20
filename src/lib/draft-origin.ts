/**
 * Where the draft on screen comes from, in one sentence the header shows: the
 * recorded run served as stored, or a live run, saying which of the two model
 * calls really ran for it. A transcription reused from an earlier run of the
 * day is not a call made for this view.
 */
import { withoutRecording } from "./engine/review";
import type { Draft } from "./engine/types";
import { formatDay, formatWhen } from "./format";

/** What ran for a live draft, for the notice shown when it is applied: one call, two calls, or one call with a reused transcription. */
export function liveRunCalls(draft: Draft): string {
  return withoutRecording(draft)
    ? "one model call ran, the extraction; there was no recording, so no transcription was called"
    : draft.transcriptReused
      ? "the extraction call ran; the transcription was reused from an earlier run today, not called again"
      : "the two model calls ran, the transcription and the extraction";
}

/** The notice shown when a live draft is applied, exact about what ran. */
export function liveRunNotice(draft: Draft, propositions: number): string {
  return `Live draft computed ${formatWhen(draft.computedAt)}: ${liveRunCalls(draft)}. ${propositions} propositions, ${draft.withheld.length} withheld by the source check${draft.withheld.length > 0 ? ", listed as not evaluable" : ""}.`;
}

/** What "Run again" would call for these media: the transcription and the extraction, or the extraction alone. */
export function runAgainTitle(hasRecording: boolean): string {
  return hasRecording
    ? "Run the model calls again on the sample media: the transcription (reused when it already ran today) and the extraction"
    : "Run the extraction again on the sample documents: there is no recording, so no transcription is called";
}

export function draftOriginLabel(draft: Draft): string {
  if (draft.origin !== "live") return `Recorded review of ${formatDay(draft.computedAt)}: served as stored, no model call was made to show it.`;
  const calls = withoutRecording(draft)
    ? "one model call ran, the extraction, on the sample documents for this view; there was no recording, so no transcription was called"
    : draft.transcriptReused
      ? "the extraction call ran on the sample media for this view; the transcription was reused from an earlier run today, not called again"
      : "the two model calls ran on the sample media for this view";
  return `Live draft, computed ${formatWhen(draft.computedAt)}: ${calls}.`;
}
