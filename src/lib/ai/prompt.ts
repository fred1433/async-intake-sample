/**
 * The two instructions given to the models. Short on purpose: the code does the
 * checking afterwards, so the models are asked for sources, not for judgment.
 */
import type { Transcript } from "../engine/types";

export const TRANSCRIBE_PROMPT =
  "Transcribe this recording word for word. Return segments of a few seconds each with start and end in seconds. " +
  "Set complete to false if the recording ends in the middle of a sentence or holds no usable speech, and say why in note.";

export const EXTRACT_SYSTEM =
  "You read intake documents and a transcript for an administrative check of what was received. " +
  "Return only what the sources say. For each document field, quote the exact passage of the page it comes from. " +
  "For each statement taken from the recording, quote the exact words of the transcript, write the statement as " +
  "\"The parent states that ...\", and mark its nature: extraction (the words themselves), rephrase, or inference. " +
  "When something is uncertain, say so in the uncertain field instead of guessing. " +
  "Do not assess the child, the diagnosis, eligibility or anything clinical. Do not describe tone or manner.";

export function extractInstruction(documents: { mediaId: string; title: string; pages: number }[], transcripts: Transcript[], question: string): string {
  const lines: string[] = [];
  if (documents.length > 0) {
    lines.push("Documents attached above, in order:");
    for (const d of documents) lines.push(`- mediaId "${d.mediaId}": ${d.title}, ${d.pages} page${d.pages === 1 ? "" : "s"}.`);
    lines.push(
      "On a referral letter, look for: patient_name, date_of_birth, guardian_name, referral_date, referring_provider, service_requested, " +
        "diagnosis_reference (only whether one is listed, quoted as written). On an insurance card: member_name, member_id, group_number, " +
        "plan_name, dependent_name, effective_date, member_services_phone. Put dates in ISO form (YYYY-MM-DD) in normalized. " +
        "If a document cannot be read, set readable to false and explain in unreadableReason.",
    );
  }
  for (const t of transcripts) {
    lines.push("", `Transcript of the recorded answer, mediaId "${t.mediaId}". The question asked was: "${question}"`);
    if (t.unusable) lines.push(`The transcription reported: ${t.unusable}`);
    for (const s of t.segments) lines.push(`[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`);
    lines.push(
      "From the recording, return the claims that are there: days_that_work, days_that_do_not_work, time_window (earliestHour as a 24-hour integer), " +
        "location_preference (home, center or either), and other only for something the office needs to know about scheduling.",
    );
  }
  return lines.join("\n");
}
