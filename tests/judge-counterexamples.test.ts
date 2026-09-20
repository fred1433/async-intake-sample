/**
 * Counter-examples executed by the second reviewer on the finished result
 * (20 September 2026), each with the inputs it used. Every one of them was
 * red before the corresponding correction. They stay here so the defects
 * cannot come back unnoticed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RawTranscript } from "../src/lib/engine/raw";
import {
  addToRequest,
  applyLiveRun,
  applySubmission,
  approve,
  approveFile,
  approveRequest,
  buildReview,
  canApproveFile,
  contentFingerprint,
  correct,
  liveRunExpectation,
  replaceDraft,
} from "../src/lib/engine/review";
import type { ReviewState, Submission } from "../src/lib/engine/types";
import { transcriptFromRaw, verifyDraft } from "../src/lib/engine/verify";
import { loadReview, mediaForLiveRun, RECORDED_DRAFT } from "../src/lib/review-store";
import { REVIEW_KEY, SUBMISSION_KEY } from "../src/lib/storage";
import { HAND_TRANSCRIPT, NOW, RAW_DRAFT, draft, source, submission } from "./helpers";

const T1 = "2026-09-20T15:01:00.000Z";
const T2 = "2026-09-20T15:02:00.000Z";
const T3 = "2026-09-20T15:03:00.000Z";

const DURATION = 12.6;

const sources = (raw: RawTranscript = HAND_TRANSCRIPT) => ({
  documents: [source("referral-letter"), source("insurance-card")],
  recordings: [{ mediaId: "recording-scheduling", transcript: transcriptFromRaw("recording-scheduling", raw, DURATION), durationSeconds: DURATION }],
});

/** Approves or corrects everything, then approves the request, as a reviewer would. */
function reviewed(state: ReviewState, at = T1): ReviewState {
  let s = state;
  for (const p of s.propositions) {
    if (p.inRequest) continue;
    if (p.finding === "conflicting" || p.finding === "to_confirm") s = correct(s, p.id, `${p.statement} Checked by phone: Tuesdays.`, at);
    else s = approve(s, p.id, at);
  }
  if (s.request && s.request.items.some((i) => !i.satisfiedAt)) s = approveRequest(s, at);
  return s;
}

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

describe("A. integrity of approvals and of the resume", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("1. a new submission where the first name changed and the letter was removed replaces the old file and detaches its approval (loadReview)", () => {
    // An approved file, stored the way the page stores it.
    let state = reviewed(buildReview(submission(), draft(), NOW));
    state = approveFile(state, state.version, T2);
    expect(state.approval).toBeDefined();
    window.localStorage.setItem(REVIEW_KEY, JSON.stringify(state));
    // The parent sends again: first name Alex, no letter.
    const again: Submission = submission({ version: 2 });
    again.answers.child_first_name = "Alex";
    again.documents.referral_letter = { status: "missing" };
    window.localStorage.setItem(SUBMISSION_KEY, JSON.stringify(again));

    const loaded = loadReview(T3);
    expect(loaded.submission.answers.child_first_name).toBe("Alex");
    expect(loaded.submission.documents.referral_letter.status).toBe("missing");
    expect(loaded.propositions.find((p) => p.id === "doc:referral_letter")?.finding).toBe("missing");
    expect(loaded.propositions.some((p) => p.group === "referral_letter")).toBe(false);
    expect(loaded.approval).toBeUndefined();
    expect(loaded.approvalHistory.at(-1)?.detached?.because).toMatch(/submission/i);
    expect(loaded.journal.some((e) => e.action === "submission_updated")).toBe(true);
    expect(loaded.version).toBeGreaterThan(state.version);
  });

  it("1b. applySubmission reconciles changed answers, a removed document and a changed recording, not only additions", () => {
    let state = reviewed(buildReview(submission(), draft(), NOW));
    state = approveFile(state, state.version, T2);
    const again = submission({ version: 2 });
    again.answers.preferred_days = ["monday"];
    again.recordings.scheduling_prompt = { status: "missing" };
    const next = applySubmission(state, again, RECORDED_DRAFT, T3);
    expect(next.submission.answers.preferred_days).toEqual(["monday"]);
    expect(next.propositions.find((p) => p.id === "rec:scheduling_prompt")?.finding).toBe("missing");
    expect(next.propositions.some((p) => p.id === "xcheck:days")).toBe(false);
    expect(next.approval).toBeUndefined();
    const entry = next.journal.find((e) => e.action === "submission_updated");
    expect(entry?.detail).toMatch(/preferred_days|Days that usually work/);
    expect(entry?.detail).toMatch(/recorded answer/i);
  });

  it("2a. an approved proposition whose quote changes is no longer approved", () => {
    let state = buildReview(submission(), draft(), NOW);
    const id = "field:referral-letter:patient_name";
    state = approve(state, id, T1);
    const raw = structuredClone(RAW_DRAFT);
    // Same value, another passage of the same page.
    raw.documents[0].fields[0].quote = "I am referring Sam Bennett for an evaluation";
    state = replaceDraft(state, draft(raw, undefined, "live"), T2);
    const p = state.propositions.find((x) => x.id === id)!;
    expect(p.state).toBe("proposed");
    expect(p.approvedAt).toBeUndefined();
    expect(p.recheck?.because).toMatch(/source/i);
    expect(p.evidence[0]).toMatchObject({ kind: "document", quote: "I am referring Sam Bennett for an evaluation" });
  });

  it("2b. an approved extraction that becomes uncertain on the new run is not approved any more, and is shown as to confirm", () => {
    let state = buildReview(submission(), draft(), NOW);
    const id = "field:referral-letter:referral_date";
    state = approve(state, id, T1);
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields[3].uncertain = "the day could be 26 or 28";
    state = replaceDraft(state, draft(raw, undefined, "live"), T2);
    const p = state.propositions.find((x) => x.id === id)!;
    expect(p.finding).toBe("to_confirm");
    expect(p.state).toBe("proposed");
    expect(p.approvedAt).toBeUndefined();
    expect(p.recheck).toBeDefined();
    expect(p.criterion?.note).toMatch(/Uncertain/);
  });

  it("3a. an approved request that gains an item goes back to draft, and the approved text stays readable", () => {
    let state = buildReview(submission(), draft(), NOW);
    state = approveRequest(state, T1);
    const approvedText = state.request!.text;
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0] = { mediaId: "referral-letter", readable: false, unreadableReason: "the scan is too dark to read", fields: [] };
    state = replaceDraft(state, draft(raw, undefined, "live"), T2);
    expect(state.request?.items.filter((i) => !i.satisfiedAt).length).toBe(2);
    expect(state.request?.status).toBe("draft");
    expect(state.request?.text).not.toBe(approvedText);
    expect(state.request?.approvals?.[0]?.text).toBe(approvedText);
    expect(state.request?.approvals?.[0]?.superseded).toBeDefined();
    expect(state.journal.some((e) => e.action === "request_reopened")).toBe(true);
  });

  it("3b. adding an item to the request after the file was approved detaches that approval and moves the version", () => {
    let state = reviewed(buildReview(submission(), draft(), NOW));
    state = approveFile(state, state.version, T2);
    const version = state.version;
    state = addToRequest(state, "xcheck:days", T3);
    expect(state.version).toBe(version + 1);
    expect(state.approval).toBeUndefined();
    expect(state.approvalHistory.at(-1)?.detached?.because).toMatch(/request/i);
    expect(state.request?.status).toBe("draft");
  });

  it("4. a live result is applied to the current file, so a correction made during the wait is kept; a result for another file is discarded", () => {
    const s0 = buildReview(submission(), draft(), NOW);
    const expected = liveRunExpectation(s0);
    expect(expected.media).toEqual(mediaForLiveRun(s0.submission));
    const id = s0.propositions.find((p) => p.id.includes("days_that_work"))!.id;
    const s1 = correct(s0, id, "The parent states that Tuesdays work best, after 4 pm.", T1);
    const result = applyLiveRun(s1, expected, draft(RAW_DRAFT, undefined, "live"), T2);
    expect(result.applied).toBe(true);
    expect(result.state.propositions.find((p) => p.id === id)?.statement).toMatch(/after 4 pm/);
    expect(result.state.propositions.find((p) => p.id === id)?.state).toBe("corrected");
    expect(result.state.draft.origin).toBe("live");

    const other = applyLiveRun(s1, { reference: "SB-OTHER", media: expected.media }, draft(RAW_DRAFT, undefined, "live"), T2);
    expect(other.applied).toBe(false);
    expect(other.state).toBe(s1);
  });

  it("5. the content fingerprint covers evidence, criteria and the request text", () => {
    const state = buildReview(submission(), draft(), NOW);
    const base = contentFingerprint(state);
    const id = "field:referral-letter:patient_name";
    const evidenceChanged = {
      ...state,
      propositions: state.propositions.map((p) => (p.id === id ? { ...p, evidence: [{ kind: "document" as const, mediaId: "referral-letter", page: 1, quote: "Sam Bennett" }] } : p)),
    };
    expect(contentFingerprint(evidenceChanged)).not.toBe(base);
    const criterionChanged = {
      ...state,
      propositions: state.propositions.map((p) => (p.id === id && p.criterion ? { ...p, criterion: { ...p.criterion, result: "not_met" as const } } : p)),
    };
    expect(contentFingerprint(criterionChanged)).not.toBe(base);
    const requestChanged = { ...state, request: { ...state.request!, text: state.request!.text + " Please call us." } };
    expect(contentFingerprint(requestChanged)).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it("6. the journal keeps the approved request text itself, and the file approval keeps a readable snapshot", () => {
    let state = buildReview(submission(), draft(), NOW);
    state = approveRequest(state, T1);
    const entry = state.journal.find((e) => e.action === "request_approved")!;
    expect(entry.to).toBe(state.request!.text);
    state = reviewed(state, T2);
    state = approveFile(state, state.version, T3);
    expect(state.approval?.request?.text).toBe(state.request!.text);
    const snap = state.approval!.snapshot.find((s) => s.id === "field:referral-letter:patient_name")!;
    expect(snap.evidence).toBeDefined();
    expect(snap.finding).toBe("present");
  });
});

describe("B. verification that must not produce false agreements", () => {
  it("7a. a value that is not in the quoted passage is withheld: January 1, 1900 quoted as August 28, 2026", () => {
    const raw = structuredClone(RAW_DRAFT);
    const field = raw.documents[0].fields.find((f) => f.key === "referral_date")!;
    field.value = "January 1, 1900";
    field.quote = "August 28, 2026";
    field.normalized = "2026-08-28";
    const verified = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    expect(verified.documents[0].fields.some((f) => f.key === "referral_date")).toBe(false);
    expect(verified.withheld).toEqual([expect.objectContaining({ key: "referral_date", reason: "value_not_in_quote" })]);
  });

  it("7b. a machine-form date that does not match the passage is withheld", () => {
    const raw = structuredClone(RAW_DRAFT);
    const field = raw.documents[0].fields.find((f) => f.key === "referral_date")!;
    field.normalized = "2026-08-27";
    const verified = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    expect(verified.withheld).toEqual([expect.objectContaining({ key: "referral_date", reason: "normalized_mismatch" })]);
  });

  it("7c. \"Thursdays work\" quoting \"Not Thursdays\" is kept as extracted, attributed to the extraction, never established (adapted in the fifth pass)", () => {
    // Until the fifth pass the code read the negation and withheld this claim. Since then it reads no polarity: the claim is kept
    // as the model extracted it, its quote ("Not Thursdays, ...") stands next to it, and the cross-check attributes it to the
    // extraction, "as extracted", to confirm; nothing is established.
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[0] = {
      key: "days_that_work",
      label: "Days that work",
      statement: "The parent states that Thursdays work.",
      nature: "rephrase",
      quote: "Not Thursdays, Sam has swimming on Thursdays.",
      days: ["thursday"],
      earliestHour: null,
      location: null,
      uncertain: null,
    };
    const verified = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    const kept = verified.recordings[0].claims.find((c) => c.key === "days_that_work");
    expect(kept?.days).toEqual(["thursday"]);
    expect(kept?.quote).toBe("Not Thursdays, Sam has swimming on Thursdays.");
    expect(verified.withheld).toEqual([]);
    const s = submission();
    s.answers.preferred_days = ["thursday"];
    const cross = buildReview(s, verified, NOW).propositions.find((p) => p.id === "xcheck:days")!;
    expect(cross.statement).toMatch(/^As extracted from the recording \("Not Thursdays, Sam has swimming on Thursdays\."\)/);
    expect(cross.criterion?.result).not.toBe("met");
  });

  it("7d. a day that is not in the quoted words is withheld, and what the code did check is listed on the claim", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[0].days = ["wednesday"];
    const verified = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    expect(verified.withheld).toEqual([expect.objectContaining({ key: "days_that_work", reason: "structured_not_in_quote" })]);
    const negative = verified.recordings[0].claims.find((c) => c.key === "days_that_do_not_work")!;
    expect(negative.checked.join(" ")).toMatch(/thursday/i);
    // Fifth pass: the code lists the day as extracted and says it establishes nothing; it reads no negation.
    expect(negative.checked.join(" ")).toMatch(/as extracted, not established/i);
  });

  it("7e. a statement labelled extraction whose words are not the quoted words is shown as a rephrase", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[0].nature = "extraction";
    const verified = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    expect(verified.recordings[0].claims.find((c) => c.key === "days_that_work")?.nature).toBe("rephrase");
  });

  it("8. a transcript segment at 500 to 510 seconds of a 12.6-second recording is never tied to a proposition", () => {
    const rawTranscript: RawTranscript = {
      segments: [
        { start: 0.0, end: 1.2, text: "Hi, so," },
        { start: 500, end: 510, text: "Tuesdays work best for us, any time after three." },
        { start: 4.4, end: 7.9, text: "Not Thursdays, Sam has swimming on Thursdays." },
        { start: 7.9, end: 12.4, text: "And if it's possible, we would rather do the sessions at home." },
      ],
      complete: true,
      note: null,
    };
    const verified = verifyDraft(RAW_DRAFT, sources(rawTranscript), { origin: "recorded", computedAt: NOW });
    for (const claim of verified.recordings[0].claims) {
      expect(claim.segment.start).toBeGreaterThanOrEqual(0);
      expect(claim.segment.end).toBeLessThanOrEqual(DURATION);
      expect(claim.segment.end).toBeGreaterThan(claim.segment.start);
    }
    expect(verified.recordings[0].claims.some((c) => c.key === "days_that_work")).toBe(false);
    expect(verified.withheld.map((w) => w.key)).toContain("days_that_work");
    expect(verified.recordings[0].transcript.segments.every((s) => s.end <= DURATION)).toBe(true);
  });

  it("9a. a form that says Monday against a recording that says Tuesdays is not an agreement", () => {
    const s = submission();
    s.answers.preferred_days = ["monday"];
    const state = buildReview(s, draft(), NOW);
    const days = state.propositions.find((p) => p.id === "xcheck:days")!;
    expect(days.finding).toBe("to_confirm");
    expect(days.statement).not.toMatch(/agree/);
    expect(days.statement).toMatch(/Monday/);
    expect(days.statement).toMatch(/Tuesday/);
    expect(days.criterion?.result).not.toBe("met");
    expect(days.requestable).toBe("confirm");
    expect(state.stage).toBe("waiting_for_review");
  });

  it("9b. a form that lists no day is not an agreement either", () => {
    const s = submission();
    s.answers.preferred_days = [];
    const state = buildReview(s, draft(), NOW);
    const days = state.propositions.find((p) => p.id === "xcheck:days")!;
    expect(days.finding).toBe("to_confirm");
    expect(days.statement).not.toMatch(/agree/);
  });

  it("9c. a recorded place that is null is not consistent with the form", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[3].location = null;
    const state = buildReview(submission(), draft(raw), NOW);
    const place = state.propositions.find((p) => p.id === "xcheck:location")!;
    expect(place.finding).toBe("to_confirm");
    expect(place.criterion?.result).toBe("not_assessable");
  });

  it("10. fields the verification rejected stay visible as not evaluable, and the file cannot be approved by approving two lines", () => {
    const raw = structuredClone(RAW_DRAFT);
    for (const doc of raw.documents) for (const f of doc.fields) f.quote = `${f.quote} zzz`;
    raw.recordings[0].claims = [];
    const s = submission();
    s.documents.insurance_card = { status: "received", mediaId: "insurance-card", receivedAt: NOW };
    const state = buildReview(s, draft(raw), NOW);
    expect(state.draft.withheld).toHaveLength(14);
    const notEvaluable = state.propositions.filter((p) => p.finding === "withheld");
    expect(notEvaluable).toHaveLength(14);
    expect(notEvaluable.every((p) => p.statement.match(/not on page|withheld|could not be verified/i))).toBe(true);
    for (const id of ["doc:referral_letter", "doc:insurance_card"]) {
      const doc = state.propositions.find((p) => p.id === id)!;
      expect(doc.finding).toBe("to_confirm");
      expect(doc.statement).toMatch(/0 fields/);
      expect(doc.statement).toMatch(/withheld/i);
    }
    expect(state.propositions.some((p) => p.id.startsWith("rec:") && p.finding === "to_confirm")).toBe(true);
    let next = state;
    for (const id of ["doc:referral_letter", "doc:insurance_card"]) next = correct(next, id, "Checked by hand.", T1);
    const check = canApproveFile(next);
    expect(check.ok).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/not reviewed yet/);
    expect(next.stage).not.toBe("ready_for_scheduling");
  });

  it("11. a clinical assertion in the free field is withheld by an output control, whatever the prompt said (flagged for review since the sixth pass)", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims.push({
      key: "other",
      label: "Other",
      statement: "The parent states that Sam's autism is severe and that he needs thirty hours of therapy a week.",
      nature: "inference",
      quote: "we would rather do the sessions at home",
      days: [],
      earliestHour: null,
      location: null,
      uncertain: null,
    });
    const verified = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    expect(verified.recordings[0].claims.some((c) => c.key === "other")).toBe(false);
    // Sixth pass: the reason is a flag ("autism", "therapy" are on the list), never a finding that the statement is clinical.
    expect(verified.withheld).toEqual([expect.objectContaining({ key: "other", reason: "flagged_for_review" })]);
    expect(verified.withheld[0].detail).toMatch(/flagged for review \(matched: "autism"\)/);
  });

  it("11b. a free-field statement its quote does not support is withheld too (since the second round, every free statement is: it is listed, never assessed)", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims.push({
      key: "other",
      label: "Other",
      statement: "The parent states that a sibling will attend every session.",
      nature: "inference",
      quote: "we would rather do the sessions at home",
      days: [],
      earliestHour: null,
      location: null,
      uncertain: null,
    });
    const verified = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    expect(verified.withheld).toEqual([expect.objectContaining({ key: "other", reason: "free_statement" })]);
  });
});
