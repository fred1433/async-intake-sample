/**
 * Fifth round of the second reviewer (20 September 2026), on commit e0d287b:
 * 35 scenarios written from its descriptions, with the inputs it gave.
 * R01 to R09 (a resolution attached to the right instance of a question,
 * and closed lines that stay closed), A01 to A07 (uncertainties that must
 * reach the fingerprint, whatever the criterion and the merge), D01 to D08
 * (one convention of equality for the deduplication and the criteria, every
 * block's opinion kept), S01 to S11 (a computed label that names the key the
 * model returned, a lexical filter that flags instead of establishing).
 * The 14 that failed (R02 to R06, A03 to A05, D01, D03 to D05, S02, S07)
 * were run red on e0d287b before the correction; the output of that run is
 * in the correction report. The 21 others were green before and after.
 *
 * What they enforce: a resolution by the reviewer belongs to one instance of
 * a question and survives every run until a new submission or the reviewer
 * reopens it, as a new instance; a closed line of the request is never
 * rewritten; every uncertainty the model declares is shown and is part of the
 * source key; two texts that differ under one shared convention stay two
 * values; a note names the key the model used; a word list flags a statement
 * for review and establishes nothing about it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { liveRunCalls, liveRunNotice, runAgainTitle } from "../src/lib/draft-origin";
import type { RawClaim, RawTranscript } from "../src/lib/engine/raw";
import {
  addToRequest,
  applySubmission,
  approve,
  approveFile,
  approveRequest,
  buildReview,
  canApproveFile,
  correct,
  editRequest,
  receiveDocument,
  replaceDraft,
  resolveRequestItem,
  slotOf,
} from "../src/lib/engine/review";
import type { Draft, Proposition, RequestItem, ReviewState } from "../src/lib/engine/types";
import { Refused } from "../src/lib/engine/types";
import { transcriptFromRaw, verifyDraft } from "../src/lib/engine/verify";
import { RECORDED_DRAFT } from "../src/lib/review-store";
import { SAMPLE_SUBMISSION } from "../src/lib/sample";
import { DURATION_SECONDS, HAND_TRANSCRIPT, NOW, RAW_DRAFT, draft, source, submission } from "./helpers";

const T1 = "2026-09-20T15:01:00.000Z";
const T2 = "2026-09-20T15:02:00.000Z";
const T3 = "2026-09-20T15:03:00.000Z";
const T4 = "2026-09-20T15:04:00.000Z";
const T5 = "2026-09-20T15:05:00.000Z";

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

/** The recorded answer cut off after 1.5 seconds: an unusable recording. */
const TRUNCATED: RawTranscript = { segments: [{ start: 0, end: 1.5, text: "Tuesdays work best for" }], complete: false, note: "The audio stops after 1.5 seconds." };

const find = (state: ReviewState, id: string): Proposition | undefined => state.propositions.find((p) => p.id === id);
const lines = (state: ReviewState, slot: string): RequestItem[] => (state.request?.items ?? []).filter((i) => slotOf(i.propositionId) === slot);
const openLine = (state: ReviewState, slot: string): RequestItem | undefined => lines(state, slot).find((i) => !i.satisfiedAt);

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

/** The sample file with the card resolved by the reviewer after the request was approved. */
function cardResolved(): ReviewState {
  let s = buildReview(submission(), draft(), NOW);
  s = approveRequest(s, T1);
  s = resolveRequestItem(s, "doc:insurance_card", "handled by phone", T2);
  expect(openLine(s, "doc:insurance_card")).toBeUndefined();
  expect(lines(s, "doc:insurance_card")[0].satisfiedBy).toBe("reviewer");
  expect(find(s, "doc:insurance_card")?.inRequest).toBe(false);
  return s;
}

/** The family sends the form again with another phone number: the card, still missing, is asked again. */
function phoneChanged(state: ReviewState, at = T3): ReviewState {
  const again = submission({ version: 2 });
  again.answers.phone = "(718) 555-0199";
  const s = applySubmission(state, again, draft(), at);
  const open = openLine(s, "doc:insurance_card");
  expect(open).toBeDefined();
  expect(open?.reopened?.because).toMatch(/the family sent the form again/);
  expect(find(s, "doc:insurance_card")?.inRequest).toBe(true);
  return s;
}

describe("R5-R. a resolution attached to the right instance of a question, closed lines that stay closed", () => {
  it("R01. card resolved, the same draft run again: the card stays resolved and the request is not approved by reuse", () => {
    let s = cardResolved();
    s = replaceDraft(s, draft(RAW_DRAFT, undefined, "live"), T3);
    expect(lines(s, "doc:insurance_card").every((i) => i.satisfiedAt && i.satisfiedBy === "reviewer")).toBe(true);
    expect(find(s, "doc:insurance_card")?.inRequest).toBe(false);
    expect(s.request?.status).not.toBe("approved");
  });

  it("R02. unusable recording resolved, a draft where it is usable, then a draft where it is unusable again: the question does not reopen, the submission did not change", () => {
    let s = buildReview(submission(), draft(RAW_DRAFT, TRUNCATED), NOW);
    expect(find(s, "rec:scheduling_prompt:unusable")?.inRequest).toBe(true);
    s = resolveRequestItem(s, "rec:scheduling_prompt:unusable", "the family called back with the answer", T1);
    expect(openLine(s, "rec:scheduling_prompt")).toBeUndefined();
    expect(lines(s, "rec:scheduling_prompt")[0].satisfiedBy).toBe("reviewer");
    s = replaceDraft(s, draft(RAW_DRAFT, undefined, "live"), T2);
    expect(find(s, "rec:scheduling_prompt:unusable")).toBeUndefined();
    expect(openLine(s, "rec:scheduling_prompt")).toBeUndefined();
    s = replaceDraft(s, draft(RAW_DRAFT, TRUNCATED, "live"), T3);
    expect(find(s, "rec:scheduling_prompt:unusable")).toBeDefined();
    // Resolved by the reviewer, no new submission since: the question stays resolved, whatever the draft carries.
    expect(openLine(s, "rec:scheduling_prompt")).toBeUndefined();
    expect(find(s, "rec:scheduling_prompt:unusable")?.inRequest).toBe(false);
    expect(lines(s, "rec:scheduling_prompt")).toHaveLength(1);
  });

  it("R03. card resolved, new submission (phone changed), card asked again, request approved, the same draft run again: the card stays asked, its basis is there, the request stays approved", () => {
    let s = phoneChanged(cardResolved(), T3);
    s = approveRequest(s, T4);
    expect(s.request?.status).toBe("approved");
    s = replaceDraft(s, draft(RAW_DRAFT, undefined, "live"), T5);
    expect(find(s, "doc:insurance_card")?.inRequest).toBe(true);
    const open = openLine(s, "doc:insurance_card");
    expect(open).toBeDefined();
    expect(open?.basisMissing).toBeUndefined();
    expect(s.request?.status).toBe("approved");
  });

  it("R04. a question resolved, then asked again by the reviewer (Ask the family), request approved, the same draft run again: the question stays asked and the request stays approved", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = addToRequest(s, "xcheck:days", T1);
    s = approveRequest(s, T1);
    s = resolveRequestItem(s, "xcheck:days", "confirmed by phone", T2);
    expect(find(s, "xcheck:days")?.inRequest).toBe(false);
    s = addToRequest(s, "xcheck:days", T3);
    expect(find(s, "xcheck:days")?.inRequest).toBe(true);
    const asked = openLine(s, "xcheck:days");
    expect(asked).toBeDefined();
    expect(asked?.reopened).toBeDefined();
    s = approveRequest(s, T3);
    expect(s.request?.status).toBe("approved");
    s = replaceDraft(s, draft(RAW_DRAFT, undefined, "live"), T4);
    expect(find(s, "xcheck:days")?.inRequest).toBe(true);
    expect(openLine(s, "xcheck:days")?.basisMissing).toBeUndefined();
    expect(s.request?.status).toBe("approved");
  });

  it("R05. card missing then received unreadable: resolving the new question leaves the old reception by the family as it was", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = approveRequest(s, T1);
    s = receiveDocument(s, "insurance_card", "insurance-card", { mediaId: "insurance-card", readable: false, unreadableReason: "the photo is blurred", fields: [] }, T2);
    expect(lines(s, "doc:insurance_card").map((i) => [i.kind, i.satisfiedBy ?? "open"])).toEqual([
      ["unreadable_item", "open"],
      ["missing_item", "family"],
    ]);
    s = resolveRequestItem(s, "doc:insurance_card", "called the family", T3);
    expect(lines(s, "doc:insurance_card").map((i) => [i.kind, i.satisfiedBy, i.satisfiedAt])).toEqual([
      ["unreadable_item", "reviewer", T3],
      ["missing_item", "family", T2],
    ]);
  });

  it("R06. a second resolution, after the question was asked again, keeps the date of the first", () => {
    let s = phoneChanged(cardResolved(), T3);
    s = resolveRequestItem(s, "doc:insurance_card", "the family will bring it", T4);
    const closed = lines(s, "doc:insurance_card");
    expect(closed.every((i) => i.satisfiedBy === "reviewer")).toBe(true);
    expect(closed.map((i) => i.satisfiedAt).sort()).toEqual([T2, T4]);
    expect(openLine(s, "doc:insurance_card")).toBeUndefined();
  });

  it("R07. a new submission asks a resolved question again, with the reason on the line and in the journal, and the request is a draft", () => {
    const s = phoneChanged(cardResolved(), T3);
    expect(lines(s, "doc:insurance_card").some((i) => i.satisfiedBy === "reviewer")).toBe(true);
    expect(s.journal.some((e) => e.action === "request_updated" && /asked again/.test(e.detail))).toBe(true);
    expect(s.request?.status).toBe("draft");
    expect(s.request?.text).toMatch(/Insurance card, front and back/);
  });

  it("R08. resolving a question twice changes nothing, and resolving what is not a question is refused", () => {
    const s = cardResolved();
    expect(resolveRequestItem(s, "doc:insurance_card", "again", T3)).toBe(s);
    expect(() => resolveRequestItem(s, "field:referral-letter:patient_name", "", T3)).toThrow(Refused);
  });

  it("R09. the only question resolved: nothing left to ask, the request is a draft, and it cannot be approved", () => {
    const s = cardResolved();
    expect(s.request?.items.every((i) => i.satisfiedAt)).toBe(true);
    expect(s.request?.status).toBe("draft");
    expect(() => approveRequest(s, T3)).toThrow(Refused);
  });
});

describe("R5-A. every uncertainty the model declares reaches the fingerprint", () => {
  it("A01. a second reading of the same value marked uncertain: the merged field is uncertain, to confirm, its criterion not met", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields.push({ key: "patient_name", label: "Patient name", value: "Sam Bennett", normalized: null, page: 1, quote: "I am referring Sam Bennett for an evaluation", uncertain: "the surname may read Bennet" });
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([]);
    const names = d.documents[0].fields.filter((f) => f.key === "patient_name");
    expect(names).toHaveLength(1);
    expect(names[0].uncertain).toMatch(/Bennet/);
    const p = find(buildReview(submission(), d, NOW), "field:referral-letter:patient_name")!;
    expect(p.finding).toBe("to_confirm");
    expect(p.criterion?.result).not.toBe("met");
  });

  it("A02. an approved date field that becomes uncertain on a new run is not approved any more", () => {
    let s = buildReview(submission(), draft(), NOW);
    const id = "field:referral-letter:referral_date";
    s = approve(s, id, T1);
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields[3].uncertain = "the day could be 26 or 28";
    s = replaceDraft(s, draft(raw, undefined, "live"), T2);
    const p = find(s, id)!;
    expect(p.state).not.toBe("approved");
    expect(p.recheck).toBeDefined();
    expect(p.finding).toBe("to_confirm");
  });

  it("A03. a request corrected to name the date of the submission and approved is a draft again when the submission date becomes the 21st", () => {
    let s = buildReview(submission(), draft(), NOW);
    const dated = s.request!.text.replace("Thank you for sending Sam's intake form.", "Thank you for the intake submitted on September 20 for Sam.");
    expect(dated).not.toBe(s.request!.text);
    s = editRequest(s, dated, T1);
    s = approveRequest(s, T1);
    expect(s.request?.status).toBe("approved");
    const moved = submission();
    moved.submittedAt = "2026-09-21T14:12:00.000Z";
    s = applySubmission(s, moved, draft(), T2);
    expect(s.submission.submittedAt).toBe("2026-09-21T14:12:00.000Z");
    expect(s.request?.status).toBe("draft");
    expect(s.request?.approvals.at(-1)?.superseded?.because).toMatch(/submission/i);
  });

  it("A04. a field without a criterion (member ID), uncertain then approved: another reason for the uncertainty is a new key, the approval is withdrawn", () => {
    const sub = submission();
    sub.documents.insurance_card = { status: "received", mediaId: "insurance-card", receivedAt: NOW };
    const raw = structuredClone(RAW_DRAFT);
    const member = raw.documents[1].fields.find((f) => f.key === "member_id")!;
    member.uncertain = "the second group of digits may read 4471 or 4411";
    let s = buildReview(sub, draft(raw), NOW);
    const id = "field:insurance-card:member_id";
    expect(find(s, id)?.finding).toBe("to_confirm");
    expect(find(s, id)?.criterion).toBeUndefined();
    s = approve(s, id, T1);
    expect(find(s, id)?.state).toBe("approved");
    const raw2 = structuredClone(raw);
    raw2.documents[1].fields.find((f) => f.key === "member_id")!.uncertain = "the first letters may read SHP or SMP";
    s = replaceDraft(s, draft(raw2, undefined, "live"), T2);
    const p = find(s, id)!;
    expect(p.state).not.toBe("approved");
    expect(p.recheck).toBeDefined();
    expect(JSON.stringify(p.details ?? {})).toMatch(/SHP or SMP/);
  });

  it("A05. a proposition with two values, approved: a new uncertainty on the second reading is shown, changes the key, withdraws the approval, and the file cannot be approved without another look", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields.push({ key: "referring_provider", label: "Referring provider", value: "Sam Bennett", normalized: null, page: 1, quote: "Patient: Sam Bennett", uncertain: null });
    let s = buildReview(submission(), verifyDraft(raw, sourcesFor(), meta), NOW);
    const id = "field:referral-letter:referring_provider";
    expect(find(s, id)?.statement).toMatch(/2 values/);
    // The reviewer approves the two-value proposition as it stands, reviews the rest, approves the request and the file.
    s = approve(s, id, T1);
    for (const p of s.propositions) {
      if (p.id === id || p.inRequest) continue;
      if (p.finding === "conflicting" || p.finding === "to_confirm") s = correct(s, p.id, `${p.statement} Checked by phone: Tuesdays.`, T1);
      else s = approve(s, p.id, T1);
    }
    s = approveRequest(s, T1);
    expect(find(s, id)?.state).toBe("approved");
    expect(canApproveFile(s).ok).toBe(true);
    s = approveFile(s, s.version, T1);
    const raw2 = structuredClone(raw);
    raw2.documents[0].fields.at(-1)!.uncertain = "the line may be the patient's name, not the provider's";
    s = replaceDraft(s, verifyDraft(raw2, sourcesFor(), { origin: "live", computedAt: T2 }), T2);
    const p = find(s, id)!;
    const shown = [p.statement, p.criterion?.note ?? "", JSON.stringify(p.details ?? {})].join(" ");
    expect(shown).toMatch(/patient's name, not the provider's/);
    expect(p.state).not.toBe("approved");
    expect(p.recheck).toBeDefined();
    expect(s.approval).toBeUndefined();
    const check = canApproveFile(s);
    expect(check.ok).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/not reviewed yet/);
  });

  it("A06. an approved field whose passage changes is proposed again, with the source named as what changed", () => {
    let s = buildReview(submission(), draft(), NOW);
    const id = "field:referral-letter:patient_name";
    s = approve(s, id, T1);
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields[0].quote = "I am referring Sam Bennett for an evaluation";
    s = replaceDraft(s, draft(raw, undefined, "live"), T2);
    const p = find(s, id)!;
    expect(p.state).toBe("proposed");
    expect(p.recheck?.because).toMatch(/source/);
  });

  it("A07. a file reviewed and approved, then a statement proposed again by a new draft: the approval is detached and the file cannot be approved as it stands", () => {
    let s = reviewed(buildReview(submission(), draft(), NOW));
    s = approveFile(s, s.version, T2);
    expect(s.approval).toBeDefined();
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[0].statement = "The parent states that Tuesdays are best, any time after 3 pm.";
    s = replaceDraft(s, draft(raw, undefined, "live"), T3);
    expect(s.approval).toBeUndefined();
    const check = canApproveFile(s);
    expect(check.ok).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/not reviewed yet/);
  });
});

describe("R5-D. one convention of equality, every block's opinion kept", () => {
  const LEE_PAGE = { 1: "Referral\nPatient: Mary Ann Lee\nDate of birth: March 14, 2020\nRe: Maryann Lee, evaluation" };

  it("D01. Mary Ann Lee and Maryann Lee, both anchored, against a form that says Mary Ann Lee: two values shown, the second stays visible as an alternative", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents = [
      {
        mediaId: "referral-letter",
        readable: true,
        unreadableReason: null,
        fields: [
          { key: "patient_name", label: "Patient name", value: "Mary Ann Lee", normalized: null, page: 1, quote: "Patient: Mary Ann Lee", uncertain: null },
          { key: "patient_name", label: "Patient name", value: "Maryann Lee", normalized: null, page: 1, quote: "Re: Maryann Lee, evaluation", uncertain: null },
        ],
      },
    ];
    const d = verifyDraft(raw, { ...sourcesFor(), documents: [{ mediaId: "referral-letter", pages: LEE_PAGE }] }, meta);
    expect(d.withheld).toEqual([]);
    const names = d.documents[0].fields.filter((f) => f.key === "patient_name");
    expect(names).toHaveLength(1);
    // Two different texts are two values: word boundaries are kept by the convention of equality.
    expect(names[0].conflict?.map((v) => v.value) ?? []).toEqual(["Maryann Lee"]);
    const sub = submission();
    sub.answers.child_first_name = "Mary Ann";
    sub.answers.child_last_name = "Lee";
    const p = find(buildReview(sub, d, NOW), "field:referral-letter:patient_name")!;
    expect(p.statement).toMatch(/Mary Ann Lee/);
    expect(p.statement).toMatch(/Maryann Lee/);
    expect(p.finding).toBe("to_confirm");
    expect(p.evidence).toHaveLength(2);
  });

  it("D02. the same value proposed twice, with a trailing period, is one field with the repeat noted, and no alternative", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields.push({ key: "patient_name", label: "Patient name", value: "Sam Bennett", normalized: null, page: 1, quote: "I am referring Sam Bennett for an evaluation", uncertain: null });
    const d = verifyDraft(raw, sourcesFor(), meta);
    const names = d.documents[0].fields.filter((f) => f.key === "patient_name");
    expect(names).toHaveLength(1);
    expect(names[0].conflict).toBeUndefined();
    expect(names[0].checked.join(" ")).toMatch(/proposed again with the same value/);
    const p = find(buildReview(submission(), d, NOW), "field:referral-letter:patient_name")!;
    expect(p.finding).toBe("present");
    expect(p.criterion?.result).toBe("met");
  });

  it("D03. two unreadable blocks: both reasons are kept, and the proposition that names the blocks is there", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents = [
      { mediaId: "referral-letter", readable: false, unreadableReason: "the scan is too dark", fields: [] },
      { mediaId: "referral-letter", readable: false, unreadableReason: "the page is cut off", fields: [] },
    ];
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.documents).toHaveLength(1);
    expect(d.documents[0].readable).toBe(false);
    expect(d.documents[0].blocks).toBe(2);
    expect(d.documents[0].unreadableReason).toMatch(/too dark/);
    expect(d.documents[0].unreadableReason).toMatch(/cut off/);
    const s = buildReview(submission(), d, NOW);
    expect(find(s, "doc:referral_letter")?.finding).toBe("unreadable");
    expect(find(s, "doc:referral_letter")?.statement).toMatch(/cut off/);
    const merge = find(s, "blocks:referral-letter");
    expect(merge).toBeDefined();
    expect(merge?.statement).toMatch(/2 blocks/);
  });

  it("D04. one readable block and one unreadable: the fields are read, and the reason of the unreadable block is not lost", () => {
    const raw = structuredClone(RAW_DRAFT);
    const [letter] = raw.documents;
    raw.documents = [{ mediaId: "referral-letter", readable: false, unreadableReason: "the scan is too dark", fields: [] }, letter];
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([]);
    expect(d.documents[0].readable).toBe(true);
    expect(d.documents[0].fields).toHaveLength(7);
    const s = buildReview(submission(), d, NOW);
    expect(find(s, "doc:referral_letter")?.finding).toBe("present");
    const merge = find(s, "blocks:referral-letter")!;
    expect(merge).toBeDefined();
    expect(`${merge.statement} ${merge.criterion?.note ?? ""}`).toMatch(/too dark/);
  });

  it("D05. a proposition with two values keeps the uncertainty declared on the second reading: shown on the proposition, not only in the extraction", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields.push({
      key: "referring_provider",
      label: "Referring provider",
      value: "Sam Bennett",
      normalized: null,
      page: 1,
      quote: "Patient: Sam Bennett",
      uncertain: "the line may be the patient's name, not the provider's",
    });
    const d = verifyDraft(raw, sourcesFor(), meta);
    const field = d.documents[0].fields.find((f) => f.key === "referring_provider")!;
    expect(field.conflict?.[0]?.uncertain).toMatch(/patient's name/);
    const p = find(buildReview(submission(), d, NOW), "field:referral-letter:referring_provider")!;
    const shown = [p.statement, p.criterion?.note ?? "", JSON.stringify(p.details ?? {})].join(" ");
    expect(shown).toMatch(/patient's name, not the provider's/);
  });

  it("D06. a document returned in two readable blocks: every field of both is read, one proposition names the merge", () => {
    const raw = structuredClone(RAW_DRAFT);
    const [letter] = raw.documents;
    raw.documents = [
      { ...letter, fields: letter.fields.slice(0, 3) },
      { ...letter, fields: letter.fields.slice(3) },
    ];
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([]);
    expect(d.documents[0].blocks).toBe(2);
    expect(d.documents[0].fields).toHaveLength(7);
    const s = buildReview(submission(), d, NOW);
    expect(find(s, "blocks:referral-letter")?.criterion?.id).toBe("conflicting_extraction");
    expect(s.propositions.filter((p) => p.group === "referral_letter" && p.nature === "extraction")).toHaveLength(7);
  });

  it("D07. a recording returned in two blocks: every statement of both is listed, the days cross-check reads the second block", () => {
    const raw = structuredClone(RAW_DRAFT);
    const [days, negative, time, location] = raw.recordings[0].claims;
    raw.recordings = [
      { mediaId: "recording-scheduling", claims: [days, time] },
      { mediaId: "recording-scheduling", claims: [negative, location] },
    ];
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([]);
    expect(d.recordings[0].blocks).toBe(2);
    expect(d.recordings[0].claims).toHaveLength(4);
    const s = buildReview(submission(), d, NOW);
    expect(find(s, "blocks:recording-scheduling")).toBeDefined();
    expect(find(s, "xcheck:days")?.finding).toBe("conflicting");
  });

  it("D08. an unknown document and an unknown recording with one mediaId are two propositions with two ids", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents.push({ mediaId: "unknown-sample", readable: true, unreadableReason: null, fields: [] });
    raw.recordings.push({ mediaId: "unknown-sample", claims: [] });
    const d = verifyDraft(raw, sourcesFor(), meta);
    const s = buildReview(submission(), d, NOW);
    const listed = s.propositions.filter((p) => p.finding === "withheld" && p.label.includes("unknown-sample"));
    expect(listed).toHaveLength(2);
    expect(new Set(listed.map((p) => p.id)).size).toBe(2);
  });
});

describe("R5-S. a computed label names the key the model returned; a word list flags, it establishes nothing", () => {
  const NOT_THURSDAYS = "Not Thursdays, Sam has swimming on Thursdays.";

  it("S01. \"I don't mind Tuesdays\" extracted as a day that works is kept", () => {
    const d = recordingDraft(spoken("I don't mind Tuesdays."), [claim({ key: "days_that_work", label: "Days that work", quote: "I don't mind Tuesdays", days: ["tuesday"] })]);
    expect(d.withheld).toEqual([]);
    expect(d.recordings[0].claims[0]?.days).toEqual(["tuesday"]);
  });

  it("S02. a time window with Thursday in its days: the note says Thursday is under the time window, never under days that work", () => {
    const d = recordingDraft(HAND_TRANSCRIPT, [
      claim({ key: "time_window", label: "Time window", quote: NOT_THURSDAYS, days: ["thursday"], earliestHour: null, statement: "The parent states that Thursdays do not work." }),
    ]);
    expect(d.withheld).toEqual([]);
    const kept = d.recordings[0].claims[0];
    expect(kept.checked.join(" ")).toMatch(/listed under the time window/);
    const s = buildReview(submission(), d, NOW);
    const p = s.propositions.find((q) => q.id.includes(":time_window:"))!;
    expect(p.criterion?.note).toMatch(/Thursday under the time window/);
    expect(p.criterion?.note).not.toMatch(/days that work/);
  });

  it("S03. the notice after a live run says what ran: one call, two calls, or one call with the transcription reused", () => {
    const live: Draft = { ...draft(RAW_DRAFT, undefined, "live"), computedAt: T1 };
    expect(liveRunCalls(live)).toMatch(/two model calls ran, the transcription and the extraction/);
    expect(liveRunCalls({ ...live, transcriptReused: true })).toMatch(/transcription was reused/);
    const alone: Draft = { ...live, recordings: [] };
    expect(liveRunCalls(alone)).toMatch(/one model call ran, the extraction/);
    expect(liveRunNotice(alone, 12)).toMatch(/no transcription was called/);
  });

  it("S04. the wording of Run again follows the media of the submission", () => {
    expect(runAgainTitle(true)).toMatch(/transcription .* and the extraction/);
    expect(runAgainTitle(false)).toMatch(/no transcription/);
  });

  it("S05. a recording removed by the family is not a recording received: the question continues as a missing item", () => {
    let s = buildReview(submission(), draft(RAW_DRAFT, TRUNCATED), NOW);
    s = approveRequest(s, T1);
    const again = submission({ version: 2 });
    again.recordings.scheduling_prompt = { status: "missing" };
    s = applySubmission(s, again, RECORDED_DRAFT, T2);
    expect(s.request?.items.filter((i) => i.satisfiedBy === "family")).toEqual([]);
    const open = openLine(s, "rec:scheduling_prompt");
    expect(open?.kind).toBe("missing_item");
  });

  it("S06. the guidance after the request is approved distinguishes a disagreement as extracted from a plain confirmation", () => {
    const app = readFileSync(path.resolve(import.meta.dirname, "../src/components/review/ReviewApp.tsx"), "utf8");
    expect(app).toMatch(/where the form and the extraction disagree, as extracted/);
    expect(app).toMatch(/the days to confirm against the recording/);
    expect(app).not.toMatch(/the recorded answer says/);
  });

  it("S07. \"Tuesdays work if the bus is not delayed\" is kept: delayed is not a clinical word", () => {
    const d = recordingDraft(spoken("Tuesdays work if the bus is not delayed."), [
      claim({ key: "days_that_work", label: "Days that work", quote: "Tuesdays work if the bus is not delayed", days: ["tuesday"], statement: "The parent states that Tuesdays work if the bus is not delayed." }),
    ]);
    expect(d.withheld).toEqual([]);
    expect(d.recordings[0].claims[0]?.days).toEqual(["tuesday"]);
  });

  it("S08. \"Sam's autism is severe\" in the free field is withheld with the matched word, and the reason says nothing clinical is assessed", () => {
    const d = recordingDraft(HAND_TRANSCRIPT, [claim({ key: "other", label: "Other", statement: "The parent states that Sam's autism is severe.", nature: "inference", quote: "we would rather do the sessions at home" })]);
    expect(d.recordings[0].claims).toHaveLength(0);
    expect(d.withheld).toHaveLength(1);
    expect(d.withheld[0].key).toBe("other");
    expect(d.withheld[0].detail).toMatch(/"autism"/);
    expect(d.withheld[0].detail).toMatch(/Nothing clinical is assessed here/);
  });

  it("S09. \"Tuesdays work because Sam does not have swimming\" is kept as a day that works", () => {
    const d = recordingDraft(spoken("Tuesdays work because Sam does not have swimming."), [
      claim({ key: "days_that_work", label: "Days that work", quote: "Tuesdays work because Sam does not have swimming", days: ["tuesday"] }),
    ]);
    expect(d.withheld).toEqual([]);
    expect(d.recordings[0].claims[0]?.days).toEqual(["tuesday"]);
  });

  it("S10. days that work and days that do not work are labelled by their own key, in the check and in the note", () => {
    const s = buildReview(submission(), draft(), NOW);
    const works = s.propositions.find((p) => p.id.includes(":days_that_work:"))!;
    expect(works.checked?.join(" ")).toMatch(/listed under days that work/);
    expect(works.criterion?.note).toMatch(/Tuesday under days that work/);
    const doesNot = s.propositions.find((p) => p.id.includes(":days_that_do_not_work:"))!;
    expect(doesNot.checked?.join(" ")).toMatch(/listed under days that do not work/);
    expect(doesNot.checked?.join(" ")).not.toMatch(/under days that work/);
  });

  it("S11. on the recorded review, every cross-check opens with As extracted, and every question that cites the recording says as we read it", () => {
    let s = buildReview(SAMPLE_SUBMISSION, RECORDED_DRAFT, NOW);
    const crosses = s.propositions.filter((p) => p.id.startsWith("xcheck:"));
    expect(crosses).toHaveLength(3);
    for (const p of crosses) expect(p.statement).toMatch(/^As extracted/);
    for (const p of crosses) s = addToRequest(s, p.id, T1);
    const questions = s.request!.text.split("\n").filter((line) => line.startsWith("- ") && /recorded answer/.test(line));
    expect(questions.length).toBeGreaterThan(0);
    for (const line of questions) expect(line).toMatch(/as we read it/);
  });
});
