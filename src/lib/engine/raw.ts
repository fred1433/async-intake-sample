/**
 * The shape the models are asked to answer with. Structured output on the model
 * side, then the code checks every quote and every segment before anything is
 * shown. A raw draft is trusted for nothing.
 */
import { z } from "zod";

export const DAY = z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

export const DOCUMENT_FIELD_KEYS = [
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
] as const;

export const RawExtractedField = z.object({
  key: z.enum(DOCUMENT_FIELD_KEYS),
  label: z.string(),
  value: z.string(),
  normalized: z.string().nullable(),
  page: z.number().int(),
  quote: z.string(),
  uncertain: z.string().nullable(),
});

export const RawDocument = z.object({
  mediaId: z.string(),
  readable: z.boolean(),
  unreadableReason: z.string().nullable(),
  fields: z.array(RawExtractedField),
});

export const RawClaim = z.object({
  key: z.enum(["days_that_work", "days_that_do_not_work", "time_window", "location_preference", "other"]),
  label: z.string(),
  statement: z.string(),
  nature: z.enum(["extraction", "rephrase", "inference"]),
  quote: z.string(),
  days: z.array(DAY),
  earliestHour: z.number().int().nullable(),
  location: z.enum(["home", "center", "either"]).nullable(),
  uncertain: z.string().nullable(),
});

export const RawRecording = z.object({
  mediaId: z.string(),
  claims: z.array(RawClaim),
});

export const RawDraft = z.object({
  documents: z.array(RawDocument),
  recordings: z.array(RawRecording),
});

export type RawDraft = z.infer<typeof RawDraft>;
export type RawClaim = z.infer<typeof RawClaim>;
export type RawExtractedField = z.infer<typeof RawExtractedField>;

/** What the transcription model answers with. */
export const RawTranscript = z.object({
  segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })),
  /** False when the audio ends mid-sentence or holds no usable speech. */
  complete: z.boolean(),
  note: z.string().nullable(),
});

export type RawTranscript = z.infer<typeof RawTranscript>;
