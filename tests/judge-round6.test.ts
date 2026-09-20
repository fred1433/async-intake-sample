/**
 * Sixth round of the second reviewer (20 September 2026), on commit 666c689:
 * 32 scenarios written from its descriptions, with the inputs it gave.
 * R01 to R12 (a resolution applies to one submission and expires when the
 * family sends the form again; a proposition that comes back while its
 * question is open is asked through that open line), D01 to D06 (every
 * reading of one text is one value, with every doubt declared on any of
 * them, whatever the order the draft returned them in), A01 to A10 (what
 * the source check refuses keeps what the model proposed and the doubt it
 * declared, shown and part of the key; the approved snapshot keeps the
 * doubts the reviewer looked at), S01 to S04 (the label per key, the
 * fixture, the blocks, the word list).
 * The 10 that failed (R02, R03, R05, R05b, D01, A05a, A05b, A06, A07, A08)
 * were run red on 666c689 before the correction; the output of that run is
 * in the correction report. The 22 others were green before and after.
 * One assertion of A08 was written against an engine the reviewer never ran
 * it on (A08 was red on its first line): it read the archived statement as
 * the value alone, while the helper corrects every "to confirm" proposition,
 * A01 of this same round being what makes this one "to confirm". The archive
 * holds the statement as approved, the reviewer's correction included; the
 * assertion says so.
 * Two more tests follow the 32: the six permutations of the reviewer's
 * three readings give one result, and a resolution expires with the version
 * of the submission.
 *
 * What they enforce: a line of the request resolved by the reviewer holds
 * for the submission it was resolved under and for no other; a question
 * whose basis comes back after a new submission is a new instance; a
 * proposition that comes back while an open line of its question exists is
 * asked through that line, without a click; readings that are the same text
 * are one value and a doubt on any of them is the value's; a refused
 * proposition carries its value or statement, its quote and its doubt, and
 * a changed doubt is another proposition; the approved snapshot holds the
 * details the fingerprint covers.
 */
import { describe, expect, it } from "vitest";
import recordedDraft from "../src/lib/fixtures/recorded-draft.json";
import recordedRaw from "../src/lib/fixtures/recorded-raw.json";
import recordedRun from "../src/lib/fixtures/recorded-run.json";
import { verifyRun, type RawRun } from "../src/lib/ai/pipeline";
import type { RawClaim, RawExtractedField, RawTranscript } from "../src/lib/engine/raw";
import {
  addToRequest,
  applySubmission,
  approve,
  approveFile,
  approveRequest,
  buildReview,
  canApproveFile,
  contentFingerprint,
  correct,
  isReviewed,
  receiveDocument,
  replaceDraft,
  resolveRequestItem,
  slotOf,
} from "../src/lib/engine/review";
import type { Draft, Proposition, RequestItem, ReviewState, Submission } from "../src/lib/engine/types";
import { KEY_LABELS, transcriptFromRaw, verifyDraft } from "../src/lib/engine/verify";
import { KNOWN_MEDIA_IDS } from "../src/lib/sample";
import { DURATION_SECONDS, HAND_TRANSCRIPT, NOW, RAW_DRAFT, draft, source, submission } from "./helpers";

const T1 = "2026-09-20T15:01:00.000Z";
const T2 = "2026-09-20T15:02:00.000Z";
const T3 = "2026-09-20T15:03:00.000Z";
const T4 = "2026-09-20T15:04:00.000Z";
const T5 = "2026-09-20T15:05:00.000Z";
const T6 = "2026-09-20T15:06:00.000Z";

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

/** The sample draft without any claim about days: the days cross-check is not in it. */
function draftWithoutDays(origin: Draft["origin"] = "live"): Draft {
  const raw = structuredClone(RAW_DRAFT);
  raw.recordings[0].claims = raw.recordings[0].claims.filter((c) => c.key === "time_window" || c.key === "location_preference");
  return draft(raw, undefined, origin);
}

const find = (state: ReviewState, id: string): Proposition | undefined => state.propositions.find((p) => p.id === id);
const lines = (state: ReviewState, slot: string): RequestItem[] => (state.request?.items ?? []).filter((i) => slotOf(i.propositionId) === slot);
const openLine = (state: ReviewState, slot: string): RequestItem | undefined => lines(state, slot).find((i) => !i.satisfiedAt);
const instanceOf = (item: RequestItem | undefined) => item?.instance ?? 1;
const withheldOf = (state: ReviewState, label: string): Proposition => state.propositions.find((p) => p.finding === "withheld" && p.label === label)!;

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

/** The family sends the form again with another phone number. */
function phoneChanged(state: ReviewState, at = T3, fallback: Draft = draft()): ReviewState {
  const again = submission({ version: state.submission.version + 1 });
  again.answers.phone = state.submission.answers.phone === "(718) 555-0199" ? "(718) 555-0142" : "(718) 555-0199";
  return applySubmission(state, again, fallback, at);
}

/** The unusable recording resolved by the reviewer, then a draft where it is usable. */
function recordingResolvedThenUsable(): ReviewState {
  let s = buildReview(submission(), draft(RAW_DRAFT, TRUNCATED), NOW);
  expect(find(s, "rec:scheduling_prompt:unusable")?.inRequest).toBe(true);
  s = resolveRequestItem(s, "rec:scheduling_prompt:unusable", "the family called back with the answer", T1);
  expect(openLine(s, "rec:scheduling_prompt")).toBeUndefined();
  expect(lines(s, "rec:scheduling_prompt")[0].satisfiedBy).toBe("reviewer");
  s = replaceDraft(s, draft(RAW_DRAFT, undefined, "live"), T2);
  expect(find(s, "rec:scheduling_prompt:unusable")).toBeUndefined();
  expect(openLine(s, "rec:scheduling_prompt")).toBeUndefined();
  return s;
}

/** "Ask the family" on the days, then a draft that no longer carries the days cross-check, then one that carries it again. */
function daysAskedThenGoneThenBack(): ReviewState {
  let s = buildReview(submission(), draft(), NOW);
  s = addToRequest(s, "xcheck:days", T1);
  expect(instanceOf(openLine(s, "xcheck:days"))).toBe(1);
  s = replaceDraft(s, draftWithoutDays(), T2);
  expect(find(s, "xcheck:days")).toBeUndefined();
  expect(openLine(s, "xcheck:days")?.basisMissing?.because).toMatch(/no longer carries/);
  s = replaceDraft(s, draft(RAW_DRAFT, undefined, "live"), T3);
  expect(find(s, "xcheck:days")).toBeDefined();
  return s;
}

/** The recording is transcribed, but no statement about scheduling passes the source check. */
function draftWithoutClaims(origin: Draft["origin"] = "live"): Draft {
  const raw = structuredClone(RAW_DRAFT);
  raw.recordings[0].claims = [];
  return draft(raw, undefined, origin);
}

describe("R7-G. a proposition the family cannot be asked about never enters the request", () => {
  // The seventh round of the reviewer, on 9bf8328: the branch of merge() that keeps a proposition of the same source key
  // did not check next.requestable, while the two other branches did. A second identical draft then put the proposition
  // into the open slot of the question, and the approved request counted it as reviewed.
  it("G01. unusable recording asked, a draft with nothing to read, the request approved, then the same draft again: the proposition stays out of the request and the file stays unapprovable", () => {
    let s = buildReview(submission(), draft(RAW_DRAFT, TRUNCATED), NOW);
    expect(find(s, "rec:scheduling_prompt:unusable")?.inRequest).toBe(true);
    s = replaceDraft(s, draftWithoutClaims(), T1);
    const first = find(s, "rec:scheduling_prompt:noclaims")!;
    expect(first).toBeDefined();
    expect(first.requestable).toBeFalsy();
    expect(first.inRequest).toBe(false);
    // The reviewer approves the request without looking at that proposition.
    s = approveRequest(s, T2);
    expect(s.request?.status).toBe("approved");
    expect(canApproveFile(s).ok).toBe(false);
    // The same draft, a second time, with no reviewer action in between.
    s = replaceDraft(s, draftWithoutClaims(), T3);
    const again = find(s, "rec:scheduling_prompt:noclaims")!;
    expect(again.inRequest).toBe(false);
    expect(again.state).toBe("proposed");
    expect(canApproveFile(s).ok).toBe(false);
  });

  it("G02. the same, for a card that becomes readable again: a proposition nothing can be asked about is not carried by the open line", () => {
    let s = buildReview(submission(), draft(RAW_DRAFT, TRUNCATED), NOW);
    s = replaceDraft(s, draftWithoutClaims(), T1);
    s = replaceDraft(s, draftWithoutClaims(), T2);
    const p = find(s, "rec:scheduling_prompt:noclaims")!;
    expect(p.inRequest).toBe(false);
    expect(s.request?.items.some((i) => i.propositionId === p.id)).toBe(false);
  });
});

describe("R6-R. a resolution holds for one submission; a proposition that comes back is asked through its open line", () => {
  it("R01. card resolved, the same draft run again: the card stays resolved and the request is not approved by reuse", () => {
    let s = cardResolved();
    s = replaceDraft(s, draft(RAW_DRAFT, undefined, "live"), T3);
    expect(lines(s, "doc:insurance_card").every((i) => i.satisfiedAt && i.satisfiedBy === "reviewer")).toBe(true);
    expect(find(s, "doc:insurance_card")?.inRequest).toBe(false);
    expect(s.request?.status).not.toBe("approved");
  });

  it("R02. unusable recording resolved, usable in between, the family sends the form again, then unusable again: the recording is asked again, as a new instance", () => {
    let s = recordingResolvedThenUsable();
    s = phoneChanged(s, T3);
    // The recording is usable at this point: nothing asks for it, the closed line stays.
    expect(openLine(s, "rec:scheduling_prompt")).toBeUndefined();
    expect(lines(s, "rec:scheduling_prompt")).toHaveLength(1);
    s = replaceDraft(s, draft(RAW_DRAFT, TRUNCATED, "live"), T4);
    const p = find(s, "rec:scheduling_prompt:unusable")!;
    expect(p).toBeDefined();
    // The resolution was given under the earlier submission: it does not apply to this one.
    expect(p.inRequest).toBe(true);
    const open = openLine(s, "rec:scheduling_prompt");
    expect(open).toBeDefined();
    expect(instanceOf(open)).toBe(2);
    expect(open?.reopened?.because).toMatch(/the family sent the form again/);
    expect(lines(s, "rec:scheduling_prompt").map((i) => [instanceOf(i), i.satisfiedBy ?? "open"])).toEqual([
      [2, "open"],
      [1, "reviewer"],
    ]);
    expect(s.request?.status).toBe("draft");
    expect(s.request?.text).toMatch(/could not use the recording/);
  });

  it("R03. card missing and resolved, then received and readable, then a draft that finds it not readable: the card is asked again, as a new instance", () => {
    let s = cardResolved();
    const card = draft().documents.find((d) => d.mediaId === "insurance-card")!;
    s = receiveDocument(s, "insurance_card", "insurance-card", card, T3);
    expect(find(s, "doc:insurance_card")?.finding).toBe("present");
    expect(find(s, "doc:insurance_card")?.inRequest).toBe(false);
    expect(openLine(s, "doc:insurance_card")).toBeUndefined();
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[1] = { mediaId: "insurance-card", readable: false, unreadableReason: "the photo is blurred", fields: [] };
    s = replaceDraft(s, draft(raw, undefined, "live"), T4);
    const p = find(s, "doc:insurance_card")!;
    expect(p.finding).toBe("unreadable");
    // The resolution closed the question about the card that was missing, under the earlier submission. The card received since is another question.
    expect(p.inRequest).toBe(true);
    const open = openLine(s, "doc:insurance_card");
    expect(open).toBeDefined();
    expect(open?.kind).toBe("unreadable_item");
    expect(instanceOf(open)).toBe(2);
    expect(lines(s, "doc:insurance_card").find((i) => instanceOf(i) === 1)).toMatchObject({ satisfiedBy: "reviewer", satisfiedAt: T2, kind: "missing_item" });
    expect(s.request?.text).toMatch(/Insurance card, front and back/);
  });

  it("R04. unusable recording resolved, a draft where it is usable, then a draft where it is unusable again, no new submission: the question does not reopen", () => {
    let s = recordingResolvedThenUsable();
    s = replaceDraft(s, draft(RAW_DRAFT, TRUNCATED, "live"), T3);
    expect(find(s, "rec:scheduling_prompt:unusable")).toBeDefined();
    expect(openLine(s, "rec:scheduling_prompt")).toBeUndefined();
    expect(find(s, "rec:scheduling_prompt:unusable")?.inRequest).toBe(false);
    expect(lines(s, "rec:scheduling_prompt")).toHaveLength(1);
  });

  it("R05. days asked by the reviewer, a draft without the days, then a draft with them again: the proposition is asked through the line that stayed open", () => {
    const s = daysAskedThenGoneThenBack();
    const p = find(s, "xcheck:days")!;
    expect(p.inRequest).toBe(true);
    const open = openLine(s, "xcheck:days");
    expect(open).toBeDefined();
    expect(instanceOf(open)).toBe(1);
    expect(open?.propositionId).toBe("xcheck:days");
    expect(lines(s, "xcheck:days")).toHaveLength(1);
  });

  it("R05b. the same sequence: the line no longer says the draft does not carry the item, the question is in the text, and Ask the family has nothing left to do", () => {
    const s = daysAskedThenGoneThenBack();
    const open = openLine(s, "xcheck:days");
    expect(open?.basisMissing).toBeUndefined();
    expect(s.request?.text).toMatch(/which days/);
    expect(addToRequest(s, "xcheck:days", T4)).toBe(s);
    expect(s.journal.filter((e) => e.action === "added_to_request")).toHaveLength(1);
  });

  it("R06. card resolved, new submission (phone changed), card asked again, request approved, the same draft run again: the card stays asked, its basis is there, the request stays approved", () => {
    let s = phoneChanged(cardResolved(), T3);
    expect(instanceOf(openLine(s, "doc:insurance_card"))).toBe(2);
    s = approveRequest(s, T4);
    expect(s.request?.status).toBe("approved");
    s = replaceDraft(s, draft(RAW_DRAFT, undefined, "live"), T5);
    expect(find(s, "doc:insurance_card")?.inRequest).toBe(true);
    const open = openLine(s, "doc:insurance_card");
    expect(open).toBeDefined();
    expect(open?.basisMissing).toBeUndefined();
    expect(s.request?.status).toBe("approved");
  });

  it("R07. a question resolved, then asked again by the reviewer, request approved, the same draft run again: the question stays asked and the request stays approved", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = addToRequest(s, "xcheck:days", T1);
    s = approveRequest(s, T1);
    s = resolveRequestItem(s, "xcheck:days", "confirmed by phone", T2);
    expect(find(s, "xcheck:days")?.inRequest).toBe(false);
    s = addToRequest(s, "xcheck:days", T3);
    expect(find(s, "xcheck:days")?.inRequest).toBe(true);
    const asked = openLine(s, "xcheck:days");
    expect(asked?.reopened).toBeDefined();
    s = approveRequest(s, T3);
    s = replaceDraft(s, draft(RAW_DRAFT, undefined, "live"), T4);
    expect(find(s, "xcheck:days")?.inRequest).toBe(true);
    expect(openLine(s, "xcheck:days")?.basisMissing).toBeUndefined();
    expect(s.request?.status).toBe("approved");
  });

  it("R08. an explicit reopening is a new instance with nothing inherited, and resolving it rewrites none of the earlier lines", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = addToRequest(s, "xcheck:days", T1);
    s = resolveRequestItem(s, "xcheck:days", "by phone", T2);
    const first = structuredClone(lines(s, "xcheck:days"));
    expect(first).toHaveLength(1);
    s = addToRequest(s, "xcheck:days", T3);
    const again = openLine(s, "xcheck:days")!;
    expect(instanceOf(again)).toBe(2);
    expect(again.satisfiedAt).toBeUndefined();
    expect(again.satisfiedBy).toBeUndefined();
    expect(again.reopened?.because).toMatch(/added/);
    s = resolveRequestItem(s, "xcheck:days", "again", T4);
    expect(lines(s, "xcheck:days").map((i) => [instanceOf(i), i.satisfiedAt])).toEqual([
      [2, T4],
      [1, T2],
    ]);
    for (const line of first) expect(s.request?.items).toContainEqual(line);
  });

  it("R09. over 600 deterministic transitions, every line closed at any step is still there, unchanged, at every later step", () => {
    const at = (i: number) => new Date(Date.parse(NOW) + (i + 1) * 60_000).toISOString();
    let s = buildReview(submission(), draft(), NOW);
    const closed = new Map<string, RequestItem>();
    const keyOf = (i: RequestItem) => `${slotOf(i.propositionId)}#${instanceOf(i)}`;
    let version = 1;
    for (let i = 0; i < 600; i++) {
      const now = at(i);
      switch (i % 8) {
        case 0:
          s = find(s, "xcheck:days") && !find(s, "xcheck:days")!.inRequest ? addToRequest(s, "xcheck:days", now) : s;
          break;
        case 1:
          s = openLine(s, "xcheck:days") ? resolveRequestItem(s, "xcheck:days", "by phone", now) : s;
          break;
        case 2:
          s = replaceDraft(s, { ...draftWithoutDays(), computedAt: now }, now);
          break;
        case 3:
          s = replaceDraft(s, { ...draft(RAW_DRAFT, undefined, "live"), computedAt: now }, now);
          break;
        case 4:
          version += 1;
          s = phoneChanged(s, now);
          break;
        case 5:
          s = openLine(s, "doc:insurance_card") ? resolveRequestItem(s, "doc:insurance_card", "the family will bring it", now) : s;
          break;
        case 6:
          s = s.request?.status === "draft" && s.request.items.some((x) => !x.satisfiedAt) ? approveRequest(s, now) : s;
          break;
        default:
          s = replaceDraft(s, { ...draft(RAW_DRAFT, TRUNCATED, "live"), computedAt: now }, now);
      }
      for (const [key, line] of closed) {
        const same = (s.request?.items ?? []).filter((x) => keyOf(x) === key);
        expect(same, `${key} after step ${i}`).toEqual([line]);
      }
      for (const line of s.request?.items ?? []) {
        if (line.satisfiedAt && !closed.has(keyOf(line))) closed.set(keyOf(line), structuredClone(line));
      }
    }
    expect(s.submission.version).toBe(version);
    expect(closed.size).toBeGreaterThan(50);
  });

  it("R11. card missing then received unreadable: resolving the new question leaves the old reception by the family as it was", () => {
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

  it("R12. a second resolution, after the question was asked again, keeps the date of the first", () => {
    let s = phoneChanged(cardResolved(), T3);
    s = resolveRequestItem(s, "doc:insurance_card", "the family will bring it", T4);
    const closed = lines(s, "doc:insurance_card");
    expect(closed.every((i) => i.satisfiedBy === "reviewer")).toBe(true);
    expect(closed.map((i) => i.satisfiedAt).sort()).toEqual([T2, T4]);
    expect(openLine(s, "doc:insurance_card")).toBeUndefined();
  });
});

/* ---------- The reviewer's three readings of one name ---------- */

const LEE_PAGE = { 1: "Referral\nPatient: Mary Ann Lee\nDate of birth: March 14, 2020\nRe: Maryann Lee, evaluation\nStudent: Mary Ann Lee" };
const MARIANNE = "The first name may read Marianne.";

/** The three readings the reviewer gave, all anchored on the page: two are the same text, one of them with a doubt. */
const LEE_READINGS: RawExtractedField[] = [
  { key: "patient_name", label: "Patient name", value: "Maryann Lee", normalized: null, page: 1, quote: "Re: Maryann Lee, evaluation", uncertain: null },
  { key: "patient_name", label: "Patient name", value: "Mary Ann Lee", normalized: null, page: 1, quote: "Patient: Mary Ann Lee", uncertain: null },
  { key: "patient_name", label: "Patient name", value: "Mary Ann Lee", normalized: null, page: 1, quote: "Student: Mary Ann Lee", uncertain: MARIANNE },
];

function leeForm(first = "Mary Ann"): Submission {
  const sub = submission();
  sub.answers.child_first_name = first;
  sub.answers.child_last_name = "Lee";
  return sub;
}

/** The letter with these readings of the patient name, in this order, against a form that says Mary Ann Lee. */
function leeName(fields: RawExtractedField[], form: Submission = leeForm()): { draft: Draft; proposition: Proposition } {
  const raw = structuredClone(RAW_DRAFT);
  raw.documents = [{ mediaId: "referral-letter", readable: true, unreadableReason: null, fields }];
  const d = verifyDraft(raw, { ...sourcesFor(), documents: [{ mediaId: "referral-letter", pages: LEE_PAGE }] }, meta);
  expect(d.withheld).toEqual([]);
  return { draft: d, proposition: find(buildReview(form, d, NOW), "field:referral-letter:patient_name")! };
}

const PERMUTATIONS: number[][] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

describe("R6-D. every reading of one text is one value, with every doubt declared on any of them", () => {
  it("D01. Maryann Lee, Mary Ann Lee, Mary Ann Lee marked uncertain, in that order: two values, the one that matches the form carries the doubt, not assessable", () => {
    const { draft: d, proposition: p } = leeName(LEE_READINGS);
    const names = d.documents[0].fields.filter((f) => f.key === "patient_name");
    expect(names).toHaveLength(1);
    expect(names[0].conflict?.map((v) => v.value)).toEqual(["Mary Ann Lee"]);
    expect(names[0].conflict?.[0]?.uncertain).toBe(MARIANNE);
    expect(p.details?.values).toEqual(["Maryann Lee", "Mary Ann Lee"]);
    expect(p.details?.uncertain).toEqual([`"Mary Ann Lee" (page 1): ${MARIANNE}`]);
    expect(p.criterion?.result).toBe("not_assessable");
    expect(p.finding).toBe("to_confirm");
    expect(p.statement).toMatch(/2 values/);
    expect(p.statement).toMatch(/Marianne/);
  });

  it("D02. the same readings with the value that matches the form first: two values, not assessable", () => {
    const { proposition: p } = leeName([LEE_READINGS[1], LEE_READINGS[2], LEE_READINGS[0]]);
    expect(p.details?.values).toEqual(["Mary Ann Lee", "Maryann Lee"]);
    expect(p.criterion?.result).toBe("not_assessable");
    expect(JSON.stringify(p.details?.uncertain)).toMatch(/Marianne/);
  });

  it("D03. Mary Ann Lee and Maryann Lee, neither uncertain, against a form that says Mary Ann Lee: met, the other reading stays visible, to confirm", () => {
    const { proposition: p } = leeName([LEE_READINGS[1], LEE_READINGS[0]]);
    expect(p.details?.values).toEqual(["Mary Ann Lee", "Maryann Lee"]);
    expect(p.criterion?.result).toBe("met");
    expect(p.criterion?.note).toMatch(/"Maryann Lee" \(page 1\) is another reading of the same field; it stays visible, to confirm/);
    expect(p.finding).toBe("to_confirm");
    expect(p.details?.uncertain).toEqual([]);
    expect(leeName([LEE_READINGS[1], LEE_READINGS[0]], leeForm("Marianne")).proposition.criterion?.result).toBe("not_met");
  });

  it("D04. one convention of equality: case, runs of spaces and punctuation at the ends of words are ignored; word boundaries are kept", async () => {
    const { sameText } = await import("../src/lib/engine/text");
    expect(sameText("Mary Ann Lee", "mary  ann lee.")).toBe(true);
    expect(sameText("Mary Ann Lee", "Maryann Lee")).toBe(false);
    expect(sameText("Alice Moreno, MD", "alice moreno md")).toBe(true);
    expect(sameText("Sam Bennett", "Sam Bennet")).toBe(false);
  });

  it("D05. a doubt declared on a distinct alternative reaches the proposition and its key", () => {
    const with_ = (uncertain: string | null) => {
      const raw = structuredClone(RAW_DRAFT);
      raw.documents[0].fields.push({ key: "referring_provider", label: "Referring provider", value: "Sam Bennett", normalized: null, page: 1, quote: "Patient: Sam Bennett", uncertain });
      return find(buildReview(submission(), verifyDraft(raw, sourcesFor(), meta), NOW), "field:referral-letter:referring_provider")!;
    };
    const doubted = with_("the line may be the patient's name, not the provider's");
    expect([doubted.statement, doubted.criterion?.note ?? "", JSON.stringify(doubted.details ?? {})].join(" ")).toMatch(/patient's name, not the provider's/);
    expect(doubted.sourceKey).not.toBe(with_(null).sourceKey);
    expect(doubted.sourceKey).not.toBe(with_("the line may be the guardian's name").sourceKey);
  });

  it("D06. the same value proposed twice, the repeat marked uncertain: one field, uncertain, to confirm, its criterion not met", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields.push({ key: "patient_name", label: "Patient name", value: "Sam Bennett", normalized: null, page: 1, quote: "I am referring Sam Bennett for an evaluation", uncertain: "the surname may read Bennet" });
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([]);
    const names = d.documents[0].fields.filter((f) => f.key === "patient_name");
    expect(names).toHaveLength(1);
    expect(names[0].conflict).toBeUndefined();
    expect(names[0].uncertain).toMatch(/Bennet/);
    const p = find(buildReview(submission(), d, NOW), "field:referral-letter:patient_name")!;
    expect(p.finding).toBe("to_confirm");
    expect(p.criterion?.result).not.toBe("met");
    expect(p.details?.uncertain).toEqual(["the surname may read Bennet"]);
  });
});

describe("permutations: the six orders of the reviewer's three readings give one result", () => {
  it("whatever the order, two values, the value that matches the form is the one with the doubt, and the criterion is not assessable", () => {
    const results = PERMUTATIONS.map((order) => {
      const { draft: d, proposition: p } = leeName(order.map((i) => LEE_READINGS[i]));
      const names = d.documents[0].fields.filter((f) => f.key === "patient_name");
      expect(names, order.join()).toHaveLength(1);
      expect((names[0].conflict ?? []).length, order.join()).toBe(1);
      const classes = [names[0], ...(names[0].conflict ?? [])];
      expect(classes.find((c) => c.value === "Mary Ann Lee")?.uncertain, order.join()).toBe(MARIANNE);
      expect(classes.find((c) => c.value === "Maryann Lee")?.uncertain, order.join()).toBeNull();
      return {
        result: p.criterion?.result,
        finding: p.finding,
        values: [...(p.details?.values ?? [])].sort(),
        uncertain: p.details?.uncertain,
        evidence: p.evidence.length,
      };
    });
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]).toEqual({ result: "not_assessable", finding: "to_confirm", values: ["Mary Ann Lee", "Maryann Lee"], uncertain: [`"Mary Ann Lee" (page 1): ${MARIANNE}`], evidence: 2 });
  });
});

/* ---------- Doubts on the path of what the source check refuses ---------- */

/** A days claim whose doubt names therapy: the word list sends it to the reviewer, whatever the doubt says. */
function therapyFlagged(uncertain: string): Draft {
  return recordingDraft(HAND_TRANSCRIPT, [
    claim({ key: "days_that_work", label: "Days that work", quote: "Tuesdays work best for us, any time after three", days: ["tuesday"], statement: "The parent states that Tuesdays work best.", uncertain }),
  ]);
}

const THERAPY_BEFORE = "The therapy schedule might differ.";
const THERAPY_AFTER = "The therapy schedule may concern Thursday instead.";

/** A free statement with a doubt: listed for the reviewer, never assessed. */
function freeStatement(uncertain: string): Draft {
  return recordingDraft(HAND_TRANSCRIPT, [
    claim({ key: "other", label: "Scheduling note", quote: "Sam has swimming on Thursdays", nature: "extraction", statement: "The parent states that Sam has swimming on Thursdays.", uncertain }),
  ]);
}

/** The patient name quoted from a passage that is not on the page, with a doubt: refused by the source check. */
function nameNotOnPage(uncertain: string): Draft {
  const raw = structuredClone(RAW_DRAFT);
  raw.documents[0].fields[0] = { ...raw.documents[0].fields[0], quote: "Patient: Samuel Bennett", uncertain };
  return verifyDraft(raw, sourcesFor(), meta);
}

/** The sample with the card received and its member ID marked uncertain by the model, without a criterion. */
function memberIdUncertain(uncertain: string): { submission: Submission; draft: Draft } {
  const sub = submission();
  sub.documents.insurance_card = { status: "received", mediaId: "insurance-card", receivedAt: NOW };
  const raw = structuredClone(RAW_DRAFT);
  raw.documents[1].fields.find((f) => f.key === "member_id")!.uncertain = uncertain;
  return { submission: sub, draft: draft(raw) };
}

const MEMBER_BEFORE = "the second group of digits may read 4471 or 4411";
const MEMBER_AFTER = "the first letters may read SHP or SMP";
const MEMBER_ID = "field:insurance-card:member_id";

describe("R6-A. a doubt is kept on the path of what the source check refuses; the approved snapshot keeps what the reviewer looked at", () => {
  it("A01. a member ID marked uncertain, no criterion: the doubt is shown, on the proposition, and the fingerprint of the file covers it", () => {
    const { submission: sub, draft: d } = memberIdUncertain(MEMBER_BEFORE);
    const s = buildReview(sub, d, NOW);
    const p = find(s, MEMBER_ID)!;
    expect(p.criterion).toBeUndefined();
    expect(p.finding).toBe("to_confirm");
    expect(p.details?.uncertain).toEqual([MEMBER_BEFORE]);
    const other = buildReview(memberIdUncertain(MEMBER_AFTER).submission, memberIdUncertain(MEMBER_AFTER).draft, NOW);
    expect(contentFingerprint(s)).not.toBe(contentFingerprint(other));
    expect(p.sourceKey).not.toBe(find(other, MEMBER_ID)?.sourceKey);
  });

  it("A02. the member ID approved, then another reason for the doubt: the proposition is proposed again and the approval withdrawn", () => {
    const { submission: sub, draft: d } = memberIdUncertain(MEMBER_BEFORE);
    let s = buildReview(sub, d, NOW);
    s = approve(s, MEMBER_ID, T1);
    expect(find(s, MEMBER_ID)?.state).toBe("approved");
    s = replaceDraft(s, { ...memberIdUncertain(MEMBER_AFTER).draft, origin: "live", computedAt: T2 }, T2);
    const p = find(s, MEMBER_ID)!;
    expect(p.state).not.toBe("approved");
    expect(p.recheck).toBeDefined();
    expect(p.details?.uncertain).toEqual([MEMBER_AFTER]);
  });

  it("A03. a file reviewed and approved, then the draft computed again: the file approval is detached, the journal says so", () => {
    let s = reviewed(buildReview(submission(), draft(), NOW));
    s = approveFile(s, s.version, T2);
    expect(s.approval).toBeDefined();
    s = replaceDraft(s, draft(RAW_DRAFT, undefined, "live"), T3);
    expect(s.approval).toBeUndefined();
    expect(s.approvalHistory).toHaveLength(1);
    expect(s.approvalHistory[0].detached?.because).toMatch(/computed again/);
    expect(s.journal.some((e) => e.action === "approval_detached")).toBe(true);
  });

  it("A04. a proposition with two values, approved, then a new doubt on the second reading: shown, key changed, approval withdrawn, file not approvable without another look", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields.push({ key: "referring_provider", label: "Referring provider", value: "Sam Bennett", normalized: null, page: 1, quote: "Patient: Sam Bennett", uncertain: null });
    let s = buildReview(submission(), verifyDraft(raw, sourcesFor(), meta), NOW);
    const id = "field:referral-letter:referring_provider";
    s = reviewed(s, T1);
    expect(find(s, id)?.state).not.toBe("proposed");
    s = approveFile(s, s.version, T1);
    const raw2 = structuredClone(raw);
    raw2.documents[0].fields.at(-1)!.uncertain = "the line may be the patient's name, not the provider's";
    s = replaceDraft(s, verifyDraft(raw2, sourcesFor(), { origin: "live", computedAt: T2 }), T2);
    const p = find(s, id)!;
    expect(JSON.stringify(p.details ?? {})).toMatch(/patient's name, not the provider's/);
    expect(p.state).toBe("proposed");
    expect(p.recheck).toBeDefined();
    expect(s.approval).toBeUndefined();
    expect(canApproveFile(s).ok).toBe(false);
  });

  it("A05a. a flagged claim whose doubt changes from \"might differ\" to \"may concern Thursday instead\": two different verified drafts, two keys, the doubt shown on each", () => {
    const before = therapyFlagged(THERAPY_BEFORE);
    const after = therapyFlagged(THERAPY_AFTER);
    expect(before.withheld).toEqual([expect.objectContaining({ reason: "flagged_for_review" })]);
    expect(after.withheld).toEqual([expect.objectContaining({ reason: "flagged_for_review" })]);
    expect(before.withheld[0].detail).toMatch(/matched: "therapy"/);
    expect(after.withheld[0].detail).toMatch(/matched: "therapy"/);
    expect(JSON.stringify(before.withheld)).not.toBe(JSON.stringify(after.withheld));
    const p1 = withheldOf(buildReview(submission(), before, NOW), "Days that work");
    const p2 = withheldOf(buildReview(submission(), after, NOW), "Days that work");
    expect(p1.details?.uncertain).toEqual([THERAPY_BEFORE]);
    expect(p2.details?.uncertain).toEqual([THERAPY_AFTER]);
    expect(p1.sourceKey).not.toBe(p2.sourceKey);
    expect(p1.finding).toBe("withheld");
    expect(p1.criterion?.result).toBe("not_assessable");
  });

  it("A05b. the flagged claim acknowledged and the file approved, then the doubt changes: another look is needed, and the file cannot be approved as it stands", () => {
    let s = buildReview(submission(), therapyFlagged(THERAPY_BEFORE), NOW);
    const id = withheldOf(s, "Days that work").id;
    s = reviewed(s, T1);
    expect(find(s, id)?.state).toBe("approved");
    expect(canApproveFile(s).ok).toBe(true);
    s = approveFile(s, s.version, T2);
    s = replaceDraft(s, { ...therapyFlagged(THERAPY_AFTER), origin: "live", computedAt: T3 }, T3);
    const p = find(s, id)!;
    expect(p.details?.uncertain).toEqual([THERAPY_AFTER]);
    expect(p.state).not.toBe("approved");
    expect(p.recheck).toBeDefined();
    expect(s.approval).toBeUndefined();
    const check = canApproveFile(s);
    expect(check.ok).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/not reviewed yet/);
  });

  it("A06. a free statement with a doubt: the doubt is shown on the listed proposition, and another doubt is another key", () => {
    const a = freeStatement("The activity may be swimming or skating.");
    const b = freeStatement("The day may be Tuesday.");
    expect(a.withheld).toEqual([expect.objectContaining({ key: "other", reason: "free_statement" })]);
    const pa = withheldOf(buildReview(submission(), a, NOW), "Scheduling note");
    const pb = withheldOf(buildReview(submission(), b, NOW), "Scheduling note");
    expect(pa.statement).toMatch(/Sam has swimming on Thursdays/);
    expect(pa.details?.uncertain).toEqual(["The activity may be swimming or skating."]);
    expect(pb.details?.uncertain).toEqual(["The day may be Tuesday."]);
    expect(pa.sourceKey).not.toBe(pb.sourceKey);
    expect(isReviewed(pa)).toBe(false);
  });

  it("A07. a document field refused for a passage that is not on the page, with a doubt: the proposed value and the doubt are shown, and another doubt is another key", () => {
    const a = nameNotOnPage("The first name may be Samuel.");
    const b = nameNotOnPage("The surname may be Bennet.");
    expect(a.withheld).toEqual([expect.objectContaining({ key: "patient_name", reason: "quote_not_found" })]);
    const pa = find(buildReview(submission(), a, NOW), "withheld:referral-letter:patient_name")!;
    const pb = find(buildReview(submission(), b, NOW), "withheld:referral-letter:patient_name")!;
    expect(pa.statement).toMatch(/"Sam Bennett"/);
    expect(pa.statement).toMatch(/not on page 1/);
    expect(pa.details?.uncertain).toEqual(["The first name may be Samuel."]);
    expect(pb.details?.uncertain).toEqual(["The surname may be Bennet."]);
    expect(pa.sourceKey).not.toBe(pb.sourceKey);
    expect(pa.finding).toBe("withheld");
  });

  it("A08. the approved snapshot keeps the doubt the reviewer looked at, and the archive restores it after the approval is detached", () => {
    const { submission: sub, draft: d } = memberIdUncertain(MEMBER_BEFORE);
    let s = reviewed(buildReview(sub, d, NOW), T1);
    s = approveFile(s, s.version, T2);
    const kept = s.approval?.snapshot.find((p) => p.id === MEMBER_ID);
    expect(kept?.details?.uncertain).toEqual([MEMBER_BEFORE]);
    s = replaceDraft(s, { ...memberIdUncertain(MEMBER_AFTER).draft, origin: "live", computedAt: T3 }, T3);
    expect(s.approval).toBeUndefined();
    expect(find(s, MEMBER_ID)?.details?.uncertain).toEqual([MEMBER_AFTER]);
    const archived = s.approvalHistory[0].snapshot.find((p) => p.id === MEMBER_ID);
    expect(archived?.details?.uncertain).toEqual([MEMBER_BEFORE]);
    // The reviewer corrected this one before approving the file: A01, of this same round, requires a field marked uncertain
    // without a criterion to be "to confirm", and the helper corrects every such proposition. So the archive holds the
    // statement as it was approved, the correction included, which is what the reviewer looked at. The reviewer's own text is
    // not rewritten by the archive: the value read from the card is still the head of it.
    expect(archived?.statement).toBe("SHP 4471 2290 Checked by phone: Tuesdays.");
    expect(archived?.state).toBe("corrected");
  });

  it("A10. a refused proposition is listed as not evaluable, never a finding: the file waits for it to be acknowledged", () => {
    const d = freeStatement("The day may be Tuesday.");
    let s = buildReview(submission(), d, NOW);
    const p = withheldOf(s, "Scheduling note");
    expect(p.finding).toBe("withheld");
    expect(p.criterion?.id).toBe("source_check");
    expect(p.criterion?.result).toBe("not_assessable");
    for (const q of s.propositions) {
      if (q.id === p.id || q.inRequest) continue;
      if (q.finding === "conflicting" || q.finding === "to_confirm") s = correct(s, q.id, `${q.statement} Checked by phone.`, T1);
      else s = approve(s, q.id, T1);
    }
    s = approveRequest(s, T1);
    expect(canApproveFile(s).ok).toBe(false);
    expect(canApproveFile(s).reasons.join(" ")).toMatch(/1 proposition not reviewed yet/);
    s = approve(s, p.id, T2);
    expect(s.journal.find((e) => e.target === p.id && e.action === "approved")?.detail).toMatch(/acknowledged as not evaluable/);
    expect(canApproveFile(s).ok).toBe(true);
  });
});

describe("R6-S. the label per key, the fixture, the blocks, the word list", () => {
  const NOT_THURSDAYS = "Not Thursdays, Sam has swimming on Thursdays.";

  it("S01. a claim with Thursday in its days is noted under the label of its own key, and under no other", () => {
    for (const key of ["days_that_work", "days_that_do_not_work", "time_window", "location_preference"] as const) {
      const d = recordingDraft(HAND_TRANSCRIPT, [claim({ key, label: key, quote: NOT_THURSDAYS, days: ["thursday"], statement: "The parent states that Thursdays do not work." })]);
      expect(d.withheld, key).toEqual([]);
      const p = buildReview(submission(), d, NOW).propositions.find((q) => q.id.includes(`:${key}:`))!;
      expect(p.criterion?.note, key).toMatch(`Thursday under ${KEY_LABELS[key]}`);
      for (const other of ["days_that_work", "days_that_do_not_work", "time_window", "location_preference"] as const) {
        if (other !== key) expect(p.criterion?.note, `${key} against ${other}`).not.toMatch(`under ${KEY_LABELS[other]}`);
      }
    }
  });

  it("S02. the fixture computed again from the recorded model answers, without a call, is the stored draft, byte for byte", () => {
    const again = verifyRun(recordedRaw as RawRun, KNOWN_MEDIA_IDS, { origin: "recorded", computedAt: recordedRun.recordedAt });
    expect(again).toEqual(recordedDraft);
    expect(JSON.stringify(again, null, 2)).toBe(JSON.stringify(recordedDraft, null, 2));
  });

  it("S03. two unreadable blocks: both reasons are kept, and the proposition that names the blocks is there", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents = [
      { mediaId: "referral-letter", readable: false, unreadableReason: "the scan is too dark", fields: [] },
      { mediaId: "referral-letter", readable: false, unreadableReason: "the page is cut off", fields: [] },
    ];
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.documents[0].unreadableReason).toMatch(/too dark/);
    expect(d.documents[0].unreadableReason).toMatch(/cut off/);
    const s = buildReview(submission(), d, NOW);
    expect(find(s, "doc:referral_letter")?.statement).toMatch(/cut off/);
    expect(find(s, "blocks:referral-letter")?.statement).toMatch(/2 blocks/);
  });

  it("S04. \"delayed\" is not on the word list; \"autism\" is, and the flag establishes nothing", () => {
    const kept = recordingDraft(spoken("Tuesdays work if the bus is not delayed."), [
      claim({ key: "days_that_work", label: "Days that work", quote: "Tuesdays work if the bus is not delayed", days: ["tuesday"], statement: "The parent states that Tuesdays work if the bus is not delayed." }),
    ]);
    expect(kept.withheld).toEqual([]);
    const flagged = recordingDraft(HAND_TRANSCRIPT, [claim({ key: "other", label: "Other", statement: "The parent states that Sam's autism is severe.", nature: "inference", quote: "we would rather do the sessions at home" })]);
    expect(flagged.withheld).toEqual([expect.objectContaining({ reason: "flagged_for_review" })]);
    expect(flagged.withheld[0].detail).toMatch(/matched: "autism"/);
    expect(flagged.withheld[0].detail).toMatch(/not established by the code/);
  });
});

describe("a resolution expires with the version of the submission", () => {
  it("the family sends the same form again (version 2, nothing else changed): the resolution no longer applies, and the next draft that asks the question opens a new instance; without that, it stays resolved", () => {
    const s = recordingResolvedThenUsable();
    const closed = structuredClone(lines(s, "rec:scheduling_prompt"));
    expect(closed).toHaveLength(1);
    // Control: the same draft again, unusable, no new submission: resolved, the closed line as it was.
    const control = replaceDraft(s, draft(RAW_DRAFT, TRUNCATED, "live"), T3);
    expect(find(control, "rec:scheduling_prompt:unusable")?.inRequest).toBe(false);
    expect(lines(control, "rec:scheduling_prompt")).toEqual(closed);
    // The same form sent again: version 2, the same answers.
    let again = applySubmission(s, submission({ version: 2 }), draft(), T3);
    expect(again.submission.version).toBe(2);
    expect(lines(again, "rec:scheduling_prompt")).toEqual(closed);
    again = replaceDraft(again, draft(RAW_DRAFT, TRUNCATED, "live"), T4);
    expect(find(again, "rec:scheduling_prompt:unusable")?.inRequest).toBe(true);
    expect(lines(again, "rec:scheduling_prompt").map((i) => [instanceOf(i), i.satisfiedBy ?? "open"])).toEqual([
      [2, "open"],
      [1, "reviewer"],
    ]);
    expect(lines(again, "rec:scheduling_prompt").filter((i) => i.satisfiedAt)).toEqual(closed);
    expect(openLine(again, "rec:scheduling_prompt")?.reopened?.because).toMatch(/the family sent the form again/);
    // Resolved again under version 2, then the same draft: resolved, two closed lines, the first untouched.
    let twice = resolveRequestItem(again, "rec:scheduling_prompt:unusable", "answered by phone again", T5);
    twice = replaceDraft(twice, draft(RAW_DRAFT, TRUNCATED, "live"), T6);
    expect(find(twice, "rec:scheduling_prompt:unusable")?.inRequest).toBe(false);
    expect(lines(twice, "rec:scheduling_prompt").map((i) => [instanceOf(i), i.satisfiedBy, i.satisfiedAt])).toEqual([
      [2, "reviewer", T5],
      [1, "reviewer", T1],
    ]);
  });
});
