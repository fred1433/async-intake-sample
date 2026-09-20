/**
 * Types of the review engine. Every record is synthetic.
 *
 * Vocabulary: a parent sends a Submission. Models read the media and return a
 * raw draft, which the code verifies into a Draft (every claim tied to a passage
 * or an audio segment that exists). The Draft and the Submission become a list
 * of Propositions the reviewer works through. Rules move the file along; the
 * journal keeps every step, including the version an approval named.
 */

export type Lang = "en" | "es";

export type FieldValue = string | string[];

export interface DocumentSlot {
  status: "received" | "missing";
  mediaId?: string;
  receivedAt?: string;
}

export interface RecordingSlot {
  status: "received" | "missing";
  mediaId?: string;
  durationSeconds?: number;
}

export interface Submission {
  reference: string;
  submittedAt: string;
  /** Language the parent used for the form. The request follows the contact language answer, then this. */
  language: Lang;
  answers: Record<string, FieldValue>;
  documents: Record<string, DocumentSlot>;
  recordings: Record<string, RecordingSlot>;
  signature?: { name: string; signedAt: string };
  /** Increases when the parent sends again after the first submission. */
  version: number;
}

/* ---------- What the models return, once verified ---------- */

export type Nature = "extraction" | "rephrase" | "inference";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  mediaId: string;
  segments: TranscriptSegment[];
  /** Set when the recording stops before the answer does, or holds no usable speech. Reported by the transcription model. */
  unusable: string | null;
  /** Segments the transcription placed outside the length of the recording, dropped by the code. */
  outOfRange?: number;
}

/** Another value the draft proposed for the same key, which passed the source check too. Neither is chosen by the code. */
export interface ConflictingValue {
  value: string;
  normalized: string | null;
  page: number;
  quote: string;
  uncertain: string | null;
  checked: string[];
}

export interface ExtractedField {
  key: string;
  label: string;
  /** As written in the document. Checked to be in the quoted passage. */
  value: string;
  /** Machine form when one exists (ISO date), checked against the dates written in the passage. Otherwise null. */
  normalized: string | null;
  page: number;
  /** Verbatim passage of the document. Checked against the text layer. */
  quote: string;
  uncertain: string | null;
  /** What the code verified about this field, in words. */
  checked: string[];
  /** Set when the draft proposed other values for the same key: the field is then to confirm, and the reviewer picks. */
  conflict?: ConflictingValue[];
}

/** What one block of the draft said about the readability of a document, kept when the document came back in several blocks. */
export interface BlockReading {
  block: number;
  readable: boolean;
  unreadableReason: string | null;
}

export interface DocumentExtraction {
  mediaId: string;
  /** True when at least one block read the document. */
  readable: boolean;
  /** When no block read it: every reason the blocks gave, none dropped. */
  unreadableReason: string | null;
  fields: ExtractedField[];
  /** Set when the draft returned this document in several blocks: all were read and merged, none ignored. */
  blocks?: number;
  /** Every block's opinion on readability, when there were several blocks: a disagreement between them is shown, not decided. */
  readings?: BlockReading[];
}

export type Day = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export type Place = "home" | "center" | "either";

export interface RecordingClaim {
  key: "days_that_work" | "days_that_do_not_work" | "time_window" | "location_preference" | "other";
  label: string;
  /** Attributed statement: "The parent states that ..." The model's wording, never the code's. */
  statement: string;
  /** Extraction only when the statement is the quoted words themselves; the code downgrades the rest to rephrase. */
  nature: Nature;
  /** Located by the code from the quoted words, inside the transcription's timestamps, checked against the recording's length. */
  segment: { start: number; end: number };
  /** Verbatim words of the transcript. */
  quote: string;
  /** Days as the model extracted them, each checked to be in the quoted words. Listed, not established by the code. */
  days: Day[];
  /** The earliest hour as the model extracted it (24-hour), checked to be an hour of the day. Not read from the words by the code. */
  earliestHour: number | null;
  /** The place as the model extracted it, checked to be in the quoted words. Listed, not established by the code. */
  location: Place | null;
  /** What the model itself said it was unsure of. */
  uncertain: string | null;
  /** What the code verified about this claim, in words, and what it leaves to the reviewer. */
  checked: string[];
}

export interface RecordingReview {
  mediaId: string;
  transcript: Transcript;
  claims: RecordingClaim[];
  /** Set when the draft returned this recording in several blocks: all were read and merged, none ignored. */
  blocks?: number;
}

/**
 * What the model proposed and the code refused, kept as it came so the
 * reviewer reads what was refused: the value or the statement, the passage or
 * the words it cited, and the doubt it declared. Nothing in it is
 * established; all of it is part of the proposition's key, so a refused
 * proposal that changes, its doubt included, is proposed again.
 */
export interface WithheldProposal {
  /** A document field: the value as the model read it, and the machine form it gave, if any. */
  value?: string;
  normalized?: string | null;
  /** A recording claim: the attributed statement, and what the model structured from the words. */
  statement?: string;
  nature?: Nature;
  days?: Day[];
  earliestHour?: number | null;
  location?: Place | null;
  /** The passage or the words the model cited, as it gave them. */
  quote: string;
  /** True when the code found the citation in the source (the passage on the page it names, the words in the transcript). */
  anchored: boolean;
  /** The audio window the code located from the quoted words, when it found them. */
  segment?: { start: number; end: number };
  /** What the model itself said it was unsure of. */
  uncertain: string | null;
}

export interface Withheld {
  mediaId: string;
  key: string;
  label: string;
  page?: number;
  /** Absent for a whole block the draft named wrongly; present for every field or claim the check refused. */
  proposed?: WithheldProposal;
  reason:
    | "no_source"
    | "quote_not_found"
    | "value_not_in_quote"
    | "normalized_mismatch"
    | "segment_not_found"
    | "segment_out_of_range"
    | "structured_not_in_quote"
    | "free_statement"
    | "flagged_for_review"
    | "unknown_media";
  detail: string;
}

export interface Draft {
  origin: "recorded" | "live";
  computedAt: string;
  /** The media the run was given. A received document absent from documents[] was given and came back with nothing. */
  media?: string[];
  /** Set when the transcription was reused from an earlier run of the day instead of being called again. */
  transcriptReused?: boolean;
  documents: DocumentExtraction[];
  recordings: RecordingReview[];
  /** What the models proposed and the code refused. Kept, shown as not evaluable, never applied. */
  withheld: Withheld[];
}

/* ---------- The review ---------- */

/** No "consistent": the code never affirms an agreement between two sources. A cross-check is conflicting (as extracted) or to confirm. */
export type Finding =
  | "present"
  | "unreadable"
  | "missing"
  | "conflicting"
  | "to_confirm"
  | "unusable_audio"
  | "negative"
  | "withheld"
  | "not_checked";

export type PropositionState = "proposed" | "corrected" | "approved";

export type Evidence =
  | { kind: "document"; mediaId: string; page: number; quote: string }
  | { kind: "audio"; mediaId: string; start: number; end: number; quote: string }
  | { kind: "form"; questionId: string; value: string };

export interface Criterion {
  id: string;
  label: string;
  /** The rule in words, the one the code applied. */
  rule: string;
  result: "met" | "not_met" | "not_assessable" | "recheck";
  note?: string;
}

export type Author = "ai" | "rule" | "reviewer";

export interface StatementVersion {
  statement: string;
  by: Author;
  at: string;
  /** File version at the time. */
  version: number;
}

export type PropositionGroup = "documents" | "referral_letter" | "insurance_card" | "recording" | "cross_checks";

export interface Proposition {
  id: string;
  group: PropositionGroup;
  label: string;
  /** The current statement. Editable by the reviewer. */
  statement: string;
  /** Who wrote the current statement. */
  nature: Nature | "rule";
  evidence: Evidence[];
  finding: Finding;
  criterion?: Criterion;
  state: PropositionState;
  history: StatementVersion[];
  /** Set when something this proposition rests on changed after it was reviewed. */
  recheck?: { because: string; at: string };
  dependsOn: string[];
  /** A missing or unreadable item, or a conflict, can go into the request to the family. */
  requestable?: "missing_item" | "unreadable_item" | "confirm";
  inRequest: boolean;
  approvedAt?: string;
  /** Structured facts behind a rule-made statement, for the request text in either language. */
  details?: Record<string, string[]>;
  /** What the code verified, in words, and what it leaves to the reviewer. */
  checked?: string[];
  /**
   * Digest of everything the source gave this proposition: first statement,
   * nature, finding, evidence, criterion, details. A proposition whose key
   * changes on a new draft or a new submission is a new proposition: the
   * reviewer's work on the old one goes to the history, not to the new one.
   */
  sourceKey: string;
}

export interface RequestItem {
  propositionId: string;
  kind: "missing_item" | "unreadable_item" | "confirm";
  /**
   * Which opening of the question this line is: 1 the first time it was asked, 2 when it was asked again after a resolution or a
   * reception, and so on. A resolution by the reviewer belongs to one instance; a question asked again is a new instance,
   * with nothing inherited. Absent on lines stored before this field existed: read as 1.
   */
  instance?: number;
  /** Filled when the family provides what was asked (a new submission), or when the reviewer resolves the item. Never by a draft that stops carrying it. */
  satisfiedAt?: string;
  satisfiedBy?: "family" | "reviewer";
  /** What the item rested on when it was composed: the document or recording slot, or the source key of the proposition. */
  basis?: string;
  /** The structured facts the question was composed from, kept so the question stays readable when its proposition is gone. */
  facts?: Record<string, string[]>;
  /** Set when the current draft no longer carries the proposition this item came from. The item stays open: the reviewer reviews it. */
  basisMissing?: { at: string; because: string };
  /** Set when the item was resolved by the reviewer and is asked again: only a new submission, or the reviewer, reopens it. */
  reopened?: { at: string; because: string };
  /**
   * The submission the reviewer resolved this line under: its key (date and version included). The resolution applies to that
   * submission and to no other: once the family sends the form again, a proposition that asks the question is a new instance.
   * Set by the resolution, on the line it closes; never on a line the family closed.
   */
  submissionVersion?: string;
}

export interface RequestApproval {
  text: string;
  at: string;
  version: number;
  /** Digest of the context the text was approved for: the whole submission, the items and their kinds, the facts asked about. */
  contextKey?: string;
  /** Set when the text changed after this approval. */
  superseded?: { at: string; because: string };
}

export interface RequestDraft {
  language: Lang;
  items: RequestItem[];
  /** The current text: composed by rule 1, or corrected by the reviewer. */
  text: string;
  status: "draft" | "approved";
  approvedAt?: string;
  /** Message content at the last approval, so a later change is visible. */
  approvedText?: string;
  /** Digest of the context of the current text (see RequestApproval.contextKey); an approval holds only for the same context. */
  contextKey: string;
  /** The parts of the context, digested apart, so a change can be named: the whole submission, the items, and the facts of each item by id. */
  contextParts?: { submission: string; items: string; facts: Record<string, string> };
  approvedContextKey?: string;
  /** Every approval this request received, with its text; a text that changed is marked superseded. */
  approvals: RequestApproval[];
  /** Set when the current text was corrected by the reviewer instead of composed by the rule. */
  edited?: { at: string };
}

/** A proposition as it was when the file was approved: everything the fingerprint covers, the doubts the model declared included. */
export interface ApprovedProposition {
  id: string;
  label: string;
  statement: string;
  state: PropositionState;
  nature: Nature | "rule";
  finding: Finding;
  evidence: Evidence[];
  criterion?: Criterion;
  /** The structured facts and the uncertainties the reviewer looked at, as they were. */
  details?: Record<string, string[]>;
  inRequest: boolean;
}

export interface FileApproval {
  version: number;
  /** SHA-256 of the content approved: submission, propositions with their evidence and criteria, request. */
  hash: string;
  at: string;
  by: "reviewer";
  snapshot: ApprovedProposition[];
  request?: { text: string; status: RequestDraft["status"] };
  detached?: { at: string; because: string };
}

export type Stage = "in_review" | "waiting_for_review" | "waiting_on_family" | "ready_for_scheduling";

export type JournalAction =
  | "draft_built"
  | "draft_replaced"
  | "submission_updated"
  | "request_prepared"
  | "request_updated"
  | "request_edited"
  | "request_reopened"
  | "request_approved"
  | "corrected"
  | "approved"
  | "approval_repeated"
  | "added_to_request"
  | "request_item_resolved"
  | "file_approved"
  | "file_approval_refused"
  | "approval_detached"
  | "document_received"
  | "stage_changed";

export interface JournalEntry {
  at: string;
  actor: "ai" | "rule" | "reviewer" | "parent";
  action: JournalAction;
  detail: string;
  /** File version after the action. */
  version: number;
  target?: string;
  from?: string;
  to?: string;
}

export interface ReviewState {
  submission: Submission;
  draft: Draft;
  /** When this file was built (opened or reset). A live run started on another build is not applied to this one. */
  builtAt: string;
  propositions: Proposition[];
  request?: RequestDraft;
  /** File version: content changes increment it. */
  version: number;
  stage: Stage;
  approval?: FileApproval;
  approvalHistory: FileApproval[];
  journal: JournalEntry[];
}

export class Refused extends Error {
  constructor(
    public code: "version_changed" | "not_reviewed" | "unknown_proposition" | "nothing_to_add" | "already_received" | "disagreement_needs_decision",
    message: string,
  ) {
    super(message);
    this.name = "Refused";
  }
}
