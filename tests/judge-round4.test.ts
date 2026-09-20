/**
 * Fourth round of the second reviewer (20 September 2026), on commit a95d316:
 * 31 scenarios written from its descriptions, with the inputs it gave.
 * A01 to A08 (a request approved for a context that changed under it),
 * B02 and B03 (a false "received", a resolution undone by a run), C01 to C06
 * (conclusions the code still drew from words or from a non-empty value),
 * D01 to D04 (duplicates handled locally, not over the whole raw output),
 * E01 (two false rejections), then ten positive controls (P01 to P10).
 * The 21 that failed were run red on a95d316 before the correction; the
 * output of that run is in the correction report. The ten controls were
 * green before and after.
 *
 * The decision they enforce: the code reads no polarity from words. What the
 * recording says is the model's extraction, shown as extracted next to its
 * quote and compared field by field with the form; a request follows the
 * whole submission, its items and the current statements it cites; a
 * resolution by the reviewer survives a run; duplicates are handled over the
 * whole batch.
 */
import { describe, expect, it } from "vitest";
import type { RawClaim, RawTranscript } from "../src/lib/engine/raw";
import {
  addToRequest,
  applySubmission,
  approve,
  approveRequest,
  buildReview,
  canApproveFile,
  correct,
  isReviewed,
  openConflicts,
  receiveDocument,
  replaceDraft,
  resolveRequestItem,
} from "../src/lib/engine/review";
import type { Draft, Proposition, ReviewState } from "../src/lib/engine/types";
import { Refused } from "../src/lib/engine/types";
import { transcriptFromRaw, verifyDraft } from "../src/lib/engine/verify";
import { RECORDED_DRAFT } from "../src/lib/review-store";
import { SAMPLE_SUBMISSION } from "../src/lib/sample";
import { DURATION_SECONDS, HAND_TRANSCRIPT, NOW, RAW_DRAFT, draft, source, submission } from "./helpers";

const T1 = "2026-09-20T15:01:00.000Z";
const T2 = "2026-09-20T15:02:00.000Z";
const T3 = "2026-09-20T15:03:00.000Z";
const T4 = "2026-09-20T15:04:00.000Z";

const meta = { origin: "recorded" as const, computedAt: NOW };

/** A hand-written transcript: one segment per line, three seconds each. */
function spoken(...lines: string[]): RawTranscript {
  return { segments: lines.map((text, i) => ({ start: i * 3, end: i * 3 + 3, text })), complete: true, note: null };
}

function sourcesFor(raw: RawTranscript = HAND_TRANSCRIPT) {
  return {
    documents: [source("referral-letter"), source("insurance-card")],
    recordings: [{ mediaId: "recording-scheduling", transcript: transcriptFromRaw("recording-scheduling", raw, DURATION_SECONDS), durationSeconds: DURATION_SECONDS }],
  };
}

function claim(overrides: Partial<RawClaim> & Pick<RawClaim, "key" | "quote">): RawClaim {
  return {
    label: overrides.key,
    statement: `The parent states that ${overrides.quote}.`,
    nature: "rephrase",
    days: [],
    earliestHour: null,
    location: null,
    uncertain: null,
    ...overrides,
  };
}

/** A draft whose recording holds exactly these claims over this transcript. */
function recordingDraft(raw: RawTranscript, claims: RawClaim[]): Draft {
  const rawDraft = structuredClone(RAW_DRAFT);
  rawDraft.recordings[0].claims = claims;
  return verifyDraft(rawDraft, sourcesFor(raw), meta);
}

const find = (state: ReviewState, id: string): Proposition | undefined => state.propositions.find((p) => p.id === id);
const claimId = (state: ReviewState, key: string) => state.propositions.find((p) => p.id.includes(`:${key}:`))!.id;

/** Approves or corrects everything outside the request, then approves the request. */
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

/** The days cross-check in an approved request, on the sample file. */
function daysAsked(): ReviewState {
  let s = buildReview(submission(), draft(), NOW);
  s = addToRequest(s, "xcheck:days", T1);
  s = approveRequest(s, T1);
  expect(s.request?.status).toBe("approved");
  expect(find(s, "xcheck:days")?.inRequest).toBe(true);
  expect(isReviewed(find(s, "xcheck:days")!, s.request)).toBe(true);
  return s;
}

/**
 * A05 to A08 share one path: the days are asked, a new draft no longer
 * extracts them (the item stays open, its basis missing), the reviewer
 * approves the request again, then the family sends a form that lists Friday.
 */
function basisMissingThenFriday(): ReviewState {
  const sub = submission();
  sub.documents.insurance_card = { status: "received", mediaId: "insurance-card", receivedAt: NOW };
  let s = buildReview(sub, draft(), NOW);
  expect(s.request).toBeUndefined();
  s = addToRequest(s, "xcheck:days", T1);
  s = approveRequest(s, T1);
  const without = recordingDraft(HAND_TRANSCRIPT, [
    claim({ key: "time_window", label: "Time window", quote: "any time after three", earliestHour: 15 }),
    claim({ key: "location_preference", label: "Location preference", quote: "we would rather do the sessions at home", location: "home" }),
  ]);
  s = replaceDraft(s, { ...without, origin: "live" }, T2);
  const item = s.request?.items.find((i) => i.propositionId === "xcheck:days");
  expect(item?.satisfiedAt).toBeUndefined();
  expect(item?.basisMissing).toBeDefined();
  expect(s.request?.status).toBe("draft");
  s = approveRequest(s, T3);
  expect(s.request?.status).toBe("approved");
  const again = { ...sub, version: 2, answers: { ...sub.answers, preferred_days: ["friday"] } };
  s = applySubmission(s, again, draft(), T4);
  expect(s.submission.answers.preferred_days).toEqual(["friday"]);
  return s;
}

describe("R4-A. a request approved for a context that changed under it", () => {
  it("R4-A01. a statement the cross-check rests on, proposed again with another wording by a new draft, sends the approved request back to draft and flags the cross-check", () => {
    let s = daysAsked();
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[1].statement = "The parent states that Thursdays are out because of swimming.";
    s = replaceDraft(s, draft(raw, undefined, "live"), T2);
    const negative = s.propositions.find((p) => p.id.includes(":days_that_do_not_work:"))!;
    expect(negative.statement).toMatch(/Thursdays are out/);
    const cross = find(s, "xcheck:days")!;
    // The cross-check was reviewed through the request, in state "proposed": the propagation must reach it too.
    expect(cross.recheck).toBeDefined();
    expect(isReviewed(cross, s.request)).toBe(false);
    expect(s.request?.status).toBe("draft");
    expect(s.request?.approvals.at(-1)?.superseded).toBeDefined();
  });

  it("R4-A02. a new uncertainty on the negative statement, in a new draft, sends the approved request back to draft", () => {
    let s = daysAsked();
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[1].uncertain = "the day may be Tuesday or Thursday: the audio is unclear";
    s = replaceDraft(s, draft(raw, undefined, "live"), T2);
    const negative = s.propositions.find((p) => p.id.includes(":days_that_do_not_work:"))!;
    expect(negative.finding).toBe("to_confirm");
    expect(s.request?.status).toBe("draft");
    expect(isReviewed(find(s, "xcheck:days")!, s.request)).toBe(false);
  });

  it("R4-A03. a direct correction of a statement the cross-check rests on sends the approved request back to draft, not only the recheck", () => {
    let s = daysAsked();
    s = correct(s, claimId(s, "days_that_work"), "The parent states that Tuesdays and Wednesdays work.", T2);
    expect(find(s, "xcheck:days")?.recheck).toBeDefined();
    expect(s.request?.status).toBe("draft");
    const reopened = s.journal.filter((e) => e.action === "request_reopened").at(-1);
    expect(reopened?.detail).toMatch(/fact/i);
  });

  it("R4-A04. with everything else reviewed, a contributor replaced by a new draft leaves the file unapprovable: the cross-check is not reviewed and the request is a draft", () => {
    let s = reviewed(daysAsked(), T1);
    expect(canApproveFile(s).ok).toBe(true);
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[1].statement = "The parent states that Thursdays are out because of swimming.";
    s = replaceDraft(s, draft(raw, undefined, "live"), T2);
    // The contributor itself is looked at again and approved: only the cross-check and the request are left to judge.
    const negative = s.propositions.find((p) => p.id.includes(":days_that_do_not_work:"))!;
    s = approve(s, negative.id, T3);
    expect(isReviewed(find(s, "xcheck:days")!, s.request)).toBe(false);
    const check = canApproveFile(s);
    expect(check.ok).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/not reviewed yet|still a draft/);
  });

  it("R4-A05. an item whose basis is missing, approved again, does not stay approved when the family sends a form that lists Friday", () => {
    const s = basisMissingThenFriday();
    expect(s.request?.status).toBe("draft");
  });

  it("R4-A06. after the Friday form, the question follows the current form: it no longer says the form lists Tuesday and Thursday", () => {
    const s = basisMissingThenFriday();
    expect(s.request?.text).not.toMatch(/form lists Tuesday and Thursday/);
    expect(s.request?.text).toMatch(/Friday/);
  });

  it("R4-A07. after the Friday form, with everything else reviewed, the file cannot be approved on the stale request", () => {
    let s = basisMissingThenFriday();
    for (const p of s.propositions) {
      if (p.inRequest) continue;
      if (p.finding === "conflicting" || p.finding === "to_confirm") s = correct(s, p.id, `${p.statement} Checked by phone.`, T4);
      else s = approve(s, p.id, T4);
    }
    const check = canApproveFile(s);
    expect(check.ok).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/still a draft/);
  });

  it("R4-A08. after the Friday form, the last approval is superseded and the reason names the submission", () => {
    const s = basisMissingThenFriday();
    const last = s.request?.approvals.at(-1);
    expect(last?.superseded).toBeDefined();
    expect(last?.superseded?.because).toMatch(/submission/i);
  });
});

describe("R4-B. a false received, and a resolution undone by a run", () => {
  it("R4-B02. a recording removed by the family is not a recording received: the old question is not satisfied by the family, the recording is asked for as missing", () => {
    const truncated = draft(RAW_DRAFT, { segments: [{ start: 0, end: 1.5, text: "Tuesdays work best for" }], complete: false, note: "The audio stops after 1.5 seconds." });
    let s = buildReview(submission(), truncated, NOW);
    expect(s.request?.items.map((i) => i.kind)).toEqual(["missing_item", "unreadable_item"]);
    s = approveRequest(s, T1);
    const again = submission({ version: 2 });
    again.recordings.scheduling_prompt = { status: "missing" };
    s = applySubmission(s, again, RECORDED_DRAFT, T2);
    expect(s.submission.recordings.scheduling_prompt.status).toBe("missing");
    const received = s.request?.items.filter((i) => i.satisfiedBy === "family") ?? [];
    expect(received).toEqual([]);
    const open = s.request?.items.filter((i) => !i.satisfiedAt && i.propositionId.startsWith("rec:")) ?? [];
    expect(open).toHaveLength(1);
    expect(open[0].kind).toBe("missing_item");
    expect(s.request?.text).toMatch(/recorded answer/i);
  });

  it("R4-B03. approve the request, resolve the card, run the same draft again: the card stays resolved and the request is not approved by reuse", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = approveRequest(s, T1);
    s = resolveRequestItem(s, "doc:insurance_card", "handled by phone", T2);
    expect(s.request?.items.find((i) => i.propositionId === "doc:insurance_card")?.satisfiedBy).toBe("reviewer");
    s = replaceDraft(s, draft(RAW_DRAFT, undefined, "live"), T3);
    const items = s.request?.items.filter((i) => i.propositionId === "doc:insurance_card") ?? [];
    expect(items.every((i) => i.satisfiedAt && i.satisfiedBy === "reviewer")).toBe(true);
    expect(find(s, "doc:insurance_card")?.inRequest).toBe(false);
    expect(s.request?.status).not.toBe("approved");
  });
});

describe("R4-C. conclusions the code still drew from words or from a non-empty value", () => {
  it("R4-C01. the patient's name placed in service_requested does not meet \"names the service requested\"", () => {
    const raw = structuredClone(RAW_DRAFT);
    const field = raw.documents[0].fields.find((f) => f.key === "service_requested")!;
    field.value = "Sam Bennett";
    field.quote = "Patient: Sam Bennett";
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([]);
    const s = buildReview(submission(), d, NOW);
    const p = find(s, "field:referral-letter:service_requested")!;
    expect(p.statement).toBe("Sam Bennett");
    expect(p.criterion?.result).not.toBe("met");
  });

  it("R4-C02. the patient's name placed in diagnosis_reference does not meet \"includes a diagnosis reference\"", () => {
    const raw = structuredClone(RAW_DRAFT);
    const field = raw.documents[0].fields.find((f) => f.key === "diagnosis_reference")!;
    field.value = "Sam Bennett";
    field.quote = "Patient: Sam Bennett";
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([]);
    const s = buildReview(submission(), d, NOW);
    const p = find(s, "field:referral-letter:diagnosis_reference")!;
    expect(p.criterion?.result).not.toBe("met");
  });

  it("R4-C03. \"Copy to: Alice Moreno, MD\" as the referring provider does not meet \"names a referring provider\": MD is a credential, not a role", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents = [
      {
        mediaId: "referral-letter",
        readable: true,
        unreadableReason: null,
        fields: [{ key: "referring_provider", label: "Referring provider", value: "Alice Moreno, MD", normalized: null, page: 1, quote: "Copy to: Alice Moreno, MD", uncertain: null }],
      },
    ];
    const sources = { ...sourcesFor(), documents: [{ mediaId: "referral-letter", pages: { 1: "Re: Referral\nCopy to: Alice Moreno, MD" } }] };
    const d = verifyDraft(raw, sources, meta);
    expect(d.withheld).toEqual([]);
    const s = buildReview(submission(), d, NOW);
    const p = find(s, "field:referral-letter:referring_provider")!;
    expect(p.statement).toBe("Alice Moreno, MD");
    expect(p.criterion?.result).not.toBe("met");
  });

  it("R4-C04. \"We can do sessions after 3 pm without a break\" with earliestHour 15 is not a disagreement with a form that says after 3 pm", () => {
    const raw = spoken("We can do sessions after 3 pm without a break.");
    const d = recordingDraft(raw, [claim({ key: "time_window", label: "Time window", quote: "We can do sessions after 3 pm without a break", earliestHour: 15 })]);
    expect(d.withheld).toEqual([]);
    const s = buildReview(submission(), d, NOW);
    expect(s.submission.answers.preferred_time).toBe("after_3pm");
    const cross = find(s, "xcheck:time")!;
    expect(cross.finding).toBe("to_confirm");
    expect(cross.criterion?.result).not.toBe("met");
  });

  it("R4-C05. \"Tuesdays work and Thursdays do not\", extracted as Thursday not working, never becomes \"Tuesday does not work\", in the review or in the message to the family", () => {
    const raw = spoken("Tuesdays work and Thursdays do not.");
    const d = recordingDraft(raw, [
      claim({ key: "days_that_work", label: "Days that work", quote: "Tuesdays work", days: ["tuesday"], statement: "The parent states that Tuesdays work." }),
      claim({ key: "days_that_do_not_work", label: "Days that do not work", quote: "Thursdays do not", days: ["thursday"], statement: "The parent states that Thursdays do not work." }),
    ]);
    const negative = d.recordings[0].claims.find((c) => c.key === "days_that_do_not_work");
    expect(negative?.days).toEqual(["thursday"]);
    const sub = submission();
    sub.answers.preferred_days = ["tuesday"];
    let s = buildReview(sub, d, NOW);
    const cross = find(s, "xcheck:days")!;
    expect(cross.statement).not.toMatch(/Tuesday does not work/);
    expect(cross.finding).not.toBe("conflicting");
    s = addToRequest(s, "xcheck:days", T1);
    expect(s.request?.text).not.toMatch(/Tuesday does not work/);
  });

  it("R4-C06. \"Sam has swimming on Thursdays\" extracted as Thursday working is not written as \"names Thursday as working\": the statement is attributed to the extraction", () => {
    const d = recordingDraft(HAND_TRANSCRIPT, [claim({ key: "days_that_work", label: "Days that work", quote: "Sam has swimming on Thursdays", days: ["thursday"] })]);
    expect(d.withheld).toEqual([]);
    const sub = submission();
    sub.answers.preferred_days = ["thursday"];
    const s = buildReview(sub, d, NOW);
    const cross = find(s, "xcheck:days")!;
    expect(cross.statement).not.toMatch(/as working/);
    expect(cross.statement).not.toMatch(/recorded answer (says|names)/);
    expect(cross.statement).toMatch(/^As extracted/);
    expect(cross.finding).toBe("to_confirm");
  });
});

describe("R4-D. duplicates handled over the whole raw output", () => {
  it("R4-D01. an unknown document and an unknown recording with the same mediaId are two propositions with two ids, and approving one leaves the other alone", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents.push({ mediaId: "unknown-sample", readable: true, unreadableReason: null, fields: [] });
    raw.recordings.push({ mediaId: "unknown-sample", claims: [] });
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld.filter((w) => w.mediaId === "unknown-sample")).toHaveLength(2);
    const s = buildReview(submission(), d, NOW);
    const listed = s.propositions.filter((p) => p.finding === "withheld" && p.label.includes("unknown-sample"));
    expect(listed).toHaveLength(2);
    expect(new Set(listed.map((p) => p.id)).size).toBe(2);
    const approved = approve(s, listed[0].id, T1);
    const after = approved.propositions.filter((p) => p.finding === "withheld" && p.label.includes("unknown-sample"));
    expect(after.filter((p) => p.state === "approved")).toHaveLength(1);
    expect(after.find((p) => p.id === listed[1].id)?.state).toBe("proposed");
    expect(after.find((p) => p.id === listed[1].id)?.statement).toBe(listed[1].statement);
  });

  it("R4-D02. two documents blocks for the referral letter: the second value of the provider does not disappear from the review", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents.push({
      mediaId: "referral-letter",
      readable: true,
      unreadableReason: null,
      fields: [{ key: "referring_provider", label: "Referring provider", value: "Sam Bennett", normalized: null, page: 1, quote: "Patient: Sam Bennett", uncertain: null }],
    });
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([]);
    const s = buildReview(submission(), d, NOW);
    const providers = s.propositions.filter((p) => p.id.startsWith("field:referral-letter:referring_provider") && !p.id.endsWith(":license"));
    const shown = providers.map((p) => p.statement).join(" | ");
    expect(shown).toMatch(/Alice Moreno, MD/);
    expect(shown).toMatch(/Sam Bennett/);
    expect(providers.every((p) => p.criterion?.result !== "met")).toBe(true);
  });

  it("R4-D03. two recordings blocks for the same recording: the \"Not Thursdays\" statement of the second block is read by the cross-check", () => {
    const raw = structuredClone(RAW_DRAFT);
    const [days, negative] = raw.recordings[0].claims;
    expect(negative.key).toBe("days_that_do_not_work");
    raw.recordings = [
      { mediaId: "recording-scheduling", claims: [days] },
      { mediaId: "recording-scheduling", claims: [negative] },
    ];
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([]);
    const s = buildReview(submission(), d, NOW);
    expect(s.submission.answers.preferred_days).toEqual(["tuesday", "thursday"]);
    const cross = find(s, "xcheck:days")!;
    expect(cross.statement).toMatch(/Thursday/);
    expect(cross.statement).not.toMatch(/nothing about Thursday/);
    expect(cross.finding).toBe("conflicting");
    expect(s.propositions.some((p) => p.id.includes(":days_that_do_not_work:"))).toBe(true);
  });

  it("R4-D04. two fields with the same value where the second is uncertain: the merged field is uncertain, to confirm, and its criterion is not met", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields.push({ key: "patient_name", label: "Patient name", value: "Sam Bennett", normalized: null, page: 1, quote: "I am referring Sam Bennett for an evaluation", uncertain: "the surname may read Bennet" });
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([]);
    const names = d.documents[0].fields.filter((f) => f.key === "patient_name");
    expect(names).toHaveLength(1);
    expect(names[0].uncertain).toBeTruthy();
    const s = buildReview(submission(), d, NOW);
    const p = find(s, "field:referral-letter:patient_name")!;
    expect(p.finding).toBe("to_confirm");
    expect(p.criterion?.result).not.toBe("met");
  });
});

describe("R4-E. false rejections that read a negation where there is none", () => {
  it("R4-E01. \"I don't mind Tuesdays\" and \"Tuesdays work because Sam does not have swimming\" are kept as days that work: nothing says the opposite", () => {
    const first = recordingDraft(spoken("I don't mind Tuesdays."), [claim({ key: "days_that_work", label: "Days that work", quote: "I don't mind Tuesdays", days: ["tuesday"] })]);
    expect(first.withheld).toEqual([]);
    expect(first.recordings[0].claims.find((c) => c.key === "days_that_work")?.days).toEqual(["tuesday"]);
    const second = recordingDraft(spoken("Tuesdays work because Sam does not have swimming."), [
      claim({ key: "days_that_work", label: "Days that work", quote: "Tuesdays work because Sam does not have swimming", days: ["tuesday"] }),
    ]);
    expect(second.withheld).toEqual([]);
    expect(second.recordings[0].claims.find((c) => c.key === "days_that_work")?.days).toEqual(["tuesday"]);
  });
});

describe("R4-P. positive controls of the fourth round: what already held, and must keep holding", () => {
  it("P01. the recorded review: days in disagreement, time and place to confirm, the missing card as the focal point, waiting for review", () => {
    const s = buildReview(SAMPLE_SUBMISSION, RECORDED_DRAFT, NOW);
    expect(find(s, "xcheck:days")?.finding).toBe("conflicting");
    expect(find(s, "xcheck:time")?.finding).toBe("to_confirm");
    expect(find(s, "xcheck:location")?.finding).toBe("to_confirm");
    expect(find(s, "doc:insurance_card")?.finding).toBe("missing");
    expect(s.request?.status).toBe("draft");
    expect(s.stage).toBe("waiting_for_review");
  });

  it("P02. the three cross-checks wait for the reviewer, and a disagreement cannot simply be approved", () => {
    const s = buildReview(submission(), draft(), NOW);
    const open = openConflicts(s).map((p) => p.id);
    expect(open).toEqual(expect.arrayContaining(["xcheck:days", "xcheck:time", "xcheck:location"]));
    expect(() => approve(s, "xcheck:days", T1)).toThrow(Refused);
  });

  it("P03. a fact asked of the family that the reviewer corrects sends the approved message back to draft", () => {
    let s = daysAsked();
    s = correct(s, "xcheck:days", "Thursday confirmed by phone with the family: do not ask about days.", T2);
    expect(s.request?.status).toBe("draft");
    expect(s.request?.approvals[0]?.superseded?.because).toMatch(/fact corrected/);
  });

  it("P04. Spanish asked for after the approval reopens the request in Spanish", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = approveRequest(s, T1);
    const again = submission({ version: 2 });
    again.answers.contact_language = "es";
    s = applySubmission(s, again, draft(), T2);
    expect(s.request?.status).toBe("draft");
    expect(s.request?.language).toBe("es");
    expect(s.request?.text).toMatch(/^Hola Jordan:/);
  });

  it("P05. a card the family sends satisfies its item, by the family", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = approveRequest(s, T1);
    const card = draft().documents.find((d) => d.mediaId === "insurance-card")!;
    s = receiveDocument(s, "insurance_card", "insurance-card", card, T2);
    const item = s.request?.items.find((i) => i.propositionId === "doc:insurance_card");
    expect(item?.satisfiedAt).toBe(T2);
    expect(item?.satisfiedBy).toBe("family");
    expect(find(s, "doc:insurance_card")?.finding).toBe("present");
  });

  it("P06. the reviewer resolves an item: closed by the reviewer, journaled, the proposition reviewed on its own", () => {
    let s = daysAsked();
    s = resolveRequestItem(s, "xcheck:days", "confirmed by phone", T2);
    const item = s.request?.items.find((i) => i.propositionId === "xcheck:days");
    expect(item?.satisfiedBy).toBe("reviewer");
    expect(find(s, "xcheck:days")?.inRequest).toBe(false);
    expect(isReviewed(find(s, "xcheck:days")!, s.request)).toBe(false);
    expect(s.journal.find((e) => e.action === "request_item_resolved")?.detail).toMatch(/confirmed by phone/);
  });

  it("P07. words that are not in the transcript, and a value that is not one run of words in its passage, are withheld", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[0].quote = "Mondays work best for us";
    const provider = raw.documents[0].fields.find((f) => f.key === "referring_provider")!;
    provider.value = "Sam Moreno, MD";
    provider.quote = "I am referring Sam Bennett for an evaluation for applied behavior analysis (ABA) services. A diagnostic evaluation dated June 2, 2026 is on file at our office; the diagnosis listed on that evaluation is autism spectrum disorder (F84.0). The family has asked that services be considered for the fall. Please contact our office if any additional information is required for your intake. Sincerely, Alice Moreno, MD";
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "referring_provider", reason: "value_not_in_quote" }), expect.objectContaining({ key: "days_that_work", reason: "segment_not_found" })]),
    );
    expect(d.withheld).toHaveLength(2);
  });

  it("P08. a machine-form date that is not the date written in the value is withheld, and February 31 is not a date", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields.find((f) => f.key === "referral_date")!.normalized = "2026-08-27";
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([expect.objectContaining({ key: "referral_date", reason: "normalized_mismatch" })]);
    const feb = structuredClone(RAW_DRAFT);
    feb.documents = [
      {
        mediaId: "referral-letter",
        readable: true,
        unreadableReason: null,
        fields: [{ key: "referral_date", label: "Referral date", value: "February 31, 2026", normalized: "2026-02-31", page: 1, quote: "Referral date: February 31, 2026", uncertain: null }],
      },
    ];
    const sources = { ...sourcesFor(), documents: [{ mediaId: "referral-letter", pages: { 1: "Referral date: February 31, 2026" } }] };
    const e = verifyDraft(feb, sources, meta);
    expect(e.documents[0]?.fields.find((f) => f.key === "referral_date")?.normalized ?? null).toBeNull();
    expect(find(buildReview(submission(), e, NOW), "field:referral-letter:referral_date")?.criterion?.result ?? "absent").not.toBe("met");
  });

  it("P09. a name the model reads as uncertain is to confirm, with the criterion not assessable", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields[0].uncertain = "the surname may read Bennet or Bennett";
    const s = buildReview(submission(), verifyDraft(raw, sourcesFor(), meta), NOW);
    const name = find(s, "field:referral-letter:patient_name")!;
    expect(name.finding).toBe("to_confirm");
    expect(name.criterion?.result).toBe("not_assessable");
  });

  it("P10. a free statement is listed for the reviewer and never assessed; one with a word on the list is withheld, flagged for review (adapted in the sixth pass)", () => {
    const free = recordingDraft(HAND_TRANSCRIPT, [claim({ key: "other", label: "Scheduling note", quote: "Sam has swimming on Thursdays", nature: "extraction", statement: "The parent states that Sam has swimming on Thursdays." })]);
    expect(free.withheld).toEqual([expect.objectContaining({ key: "other", reason: "free_statement" })]);
    const s = buildReview(submission(), free, NOW);
    const listed = s.propositions.find((p) => p.finding === "withheld" && p.label === "Scheduling note")!;
    expect(listed.criterion?.result).toBe("not_assessable");
    const clinical = recordingDraft(HAND_TRANSCRIPT, [
      claim({ key: "other", label: "Other", statement: "The parent states that Sam's autism is severe.", nature: "inference", quote: "we would rather do the sessions at home" }),
    ]);
    // Sixth pass: "clinical_content" became "flagged_for_review": the list flags, it establishes nothing (R5-S07).
    expect(clinical.withheld).toEqual([expect.objectContaining({ key: "other", reason: "flagged_for_review" })]);
  });
});
