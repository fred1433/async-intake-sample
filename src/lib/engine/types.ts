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
}

export interface DocumentExtraction {
  mediaId: string;
  readable: boolean;
  unreadableReason: string | null;
  fields: ExtractedField[];
}

export type Day = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export interface RecordingClaim {
  key: "days_that_work" | "days_that_do_not_work" | "time_window" | "location_preference" | "other";
  label: string;
  /** Attributed statement: "The parent states that ..." */
  statement: string;
  /** Extraction only when the statement is the quoted words themselves; the code downgrades the rest to rephrase. */
  nature: Nature;
  /** Located by the code from the quoted words, inside the transcription's timestamps, checked against the recording's length. */
  segment: { start: number; end: number };
  /** Verbatim words of the transcript. */
  quote: string;
  /** Days named in the quoted words, with the negation checked. */
  days: Day[];
  /** An hour named in the quoted words, or null. */
  earliestHour: number | null;
  /** A place named in the quoted words, or null. */
  location: "home" | "center" | "either" | null;
  uncertain: string | null;
  /** What the code verified about this claim, in words, and what it leaves to the reviewer. */
  checked: string[];
}

export interface RecordingReview {
  mediaId: string;
  transcript: Transcript;
  claims: RecordingClaim[];
}

export interface Withheld {
  mediaId: string;
  key: string;
  label: string;
  page?: number;
  reason:
    | "no_source"
    | "quote_not_found"
    | "value_not_in_quote"
    | "normalized_mismatch"
    | "segment_not_found"
    | "segment_out_of_range"
    | "structured_not_in_quote"
    | "negation_mismatch"
    | "statement_unsupported"
    | "clinical_content"
    | "unknown_media";
  detail: string;
}

export interface Draft {
  origin: "recorded" | "live";
  computedAt: string;
  documents: DocumentExtraction[];
  recordings: RecordingReview[];
  /** What the models proposed and the code refused. Kept, shown as not evaluable, never applied. */
  withheld: Withheld[];
}

/* ---------- The review ---------- */

export type Finding =
  | "present"
  | "unreadable"
  | "missing"
  | "consistent"
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
  /** Filled when the parent later provides what was asked. */
  satisfiedAt?: string;
}

export interface RequestApproval {
  text: string;
  at: string;
  version: number;
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
  /** Every approval this request received, with its text; a text that changed is marked superseded. */
  approvals: RequestApproval[];
  /** Set when the current text was corrected by the reviewer instead of composed by the rule. */
  edited?: { at: string };
}

export interface ApprovedProposition {
  id: string;
  label: string;
  statement: string;
  state: PropositionState;
  finding: Finding;
  evidence: Evidence[];
  criterion?: Criterion;
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
