/**
 * The fictional sample: the media the page provides, their text layers, and the
 * sample submission a parent would have sent.
 *
 * Everything here is invented. The family, the practice, the plan and the
 * numbers do not exist. The server only ever processes the media listed here.
 */
import documents from "../../sample/documents.json";
import type { Submission } from "./engine/types";

export interface TextBlock {
  id: string;
  style: string;
  text: string;
}

export interface DocumentPage {
  number: number;
  label?: string;
  blocks: TextBlock[];
}

export interface SampleDocument {
  id: string;
  title: string;
  kind: "document";
  file: string;
  pages: DocumentPage[];
}

export interface SampleRecording {
  id: string;
  title: string;
  kind: "recording";
  file: string;
  mimeType: string;
  durationSeconds: number;
}

export type SampleMedia = SampleDocument | SampleRecording;

const DOCUMENTS = documents as Record<string, SampleDocument>;

export const MEDIA: Record<string, SampleMedia> = {
  "referral-letter": DOCUMENTS["referral-letter"],
  "insurance-card": DOCUMENTS["insurance-card"],
  "recording-scheduling": {
    id: "recording-scheduling",
    title: "Recorded answer: scheduling",
    kind: "recording",
    file: "/sample/recording-scheduling.mp3",
    mimeType: "audio/mpeg",
    durationSeconds: 12.6,
  },
};

export const KNOWN_MEDIA_IDS = Object.keys(MEDIA);

export function isKnownMedia(id: unknown): id is string {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(MEDIA, id);
}

export function mediaOf(id: string): SampleMedia {
  const media = MEDIA[id];
  if (!media) throw new Error(`Unknown sample media: ${id}`);
  return media;
}

export function documentOf(id: string): SampleDocument {
  const media = mediaOf(id);
  if (media.kind !== "document") throw new Error(`${id} is not a document`);
  return media;
}

/** The text layer of a document page, block by block, as the page renders it. */
export function pageText(doc: SampleDocument, pageNumber: number): string {
  const page = doc.pages.find((p) => p.number === pageNumber);
  if (!page) return "";
  return page.blocks.map((b) => b.text).join("\n");
}

export const SAMPLE_REFERENCE = "SB-2041";

/** What the sample parent sent. The insurance card was not attached. */
export const SAMPLE_SUBMISSION: Submission = {
  reference: SAMPLE_REFERENCE,
  submittedAt: "2026-09-20T14:12:00.000Z",
  language: "en",
  version: 1,
  answers: {
    child_first_name: "Sam",
    child_last_name: "Bennett",
    child_dob: "2020-03-14",
    home_language: "english",
    guardian_name: "Jordan Bennett",
    relationship: "parent",
    phone: "(718) 555-0142",
    email: "jordan.bennett@example.com",
    contact_language: "en",
    preferred_days: ["tuesday", "thursday"],
    preferred_time: "after_3pm",
    location: "either",
  },
  documents: {
    referral_letter: { status: "received", mediaId: "referral-letter", receivedAt: "2026-09-20T14:09:30.000Z" },
    insurance_card: { status: "missing" },
  },
  recordings: {
    scheduling_prompt: { status: "received", mediaId: "recording-scheduling", durationSeconds: 12.6 },
  },
  signature: { name: "Jordan Bennett", signedAt: "2026-09-20T14:11:40.000Z" },
};
