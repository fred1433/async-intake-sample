/**
 * Where the draft on screen comes from, in one sentence the header shows: the
 * recorded run served as stored, or a live run, saying which of the two model
 * calls really ran for it. A transcription reused from an earlier run of the
 * day is not a call made for this view.
 */
import type { Draft } from "./engine/types";
import { formatDay, formatWhen } from "./format";

export function draftOriginLabel(draft: Draft): string {
  if (draft.origin !== "live") return `Recorded review of ${formatDay(draft.computedAt)}: served as stored, no model call was made to show it.`;
  const calls = draft.transcriptReused
    ? "the extraction call ran on the sample media for this view; the transcription was reused from an earlier run today, not called again"
    : "the two model calls ran on the sample media for this view";
  return `Live draft, computed ${formatWhen(draft.computedAt)}: ${calls}.`;
}
