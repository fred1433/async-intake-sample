/**
 * The points of the sixth pass that had no scenario of the reviewer's own,
 * written with their code: the instances of a question (a resolution belongs
 * to one instance, a question asked again inherits nothing, a closed line
 * never changes), the label of a note computed from the key the model
 * returned (one per key of the raw schema, and no other), the one convention
 * of equality shared by the deduplication and the criteria, the submission
 * key that carries the date and the version, every block's opinion kept, and
 * a word list that flags a statement instead of establishing what it is.
 * The engine functions this file needs are imported lazily, so on the code
 * before the sixth pass a missing one reads as a red test, not a broken file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RawClaim, type RawTranscript } from "../src/lib/engine/raw";
import { addToRequest, applySubmission, approveRequest, buildReview, replaceDraft, resolveRequestItem, slotOf, submissionKey } from "../src/lib/engine/review";
import type { Draft, RequestItem, ReviewState } from "../src/lib/engine/types";
import { transcriptFromRaw, verifyDraft } from "../src/lib/engine/verify";
import { DURATION_SECONDS, HAND_TRANSCRIPT, NOW, RAW_DRAFT, draft, source, submission } from "./helpers";

const T1 = "2026-09-20T15:01:00.000Z";
const T2 = "2026-09-20T15:02:00.000Z";
const T3 = "2026-09-20T15:03:00.000Z";
const T4 = "2026-09-20T15:04:00.000Z";
const T5 = "2026-09-20T15:05:00.000Z";
const T6 = "2026-09-20T15:06:00.000Z";
const meta = { origin: "recorded" as const, computedAt: NOW };

function spoken(...lines: string[]): RawTranscript {
  return { segments: lines.map((text, i) => ({ start: i * 3, end: i * 3 + 3, text })), complete: true, note: null };
}

function claim(overrides: Partial<RawClaim> & Pick<RawClaim, "key" | "quote">): RawClaim {
  return { label: overrides.key, statement: `The parent states that ${overrides.quote}.`, nature: "rephrase", days: [], earliestHour: null, location: null, uncertain: null, ...overrides };
}

function recordingDraft(raw: RawTranscript, claims: RawClaim[]): Draft {
  const rawDraft = structuredClone(RAW_DRAFT);
  rawDraft.recordings[0].claims = claims;
  return verifyDraft(
    rawDraft,
    {
      documents: [source("referral-letter"), source("insurance-card")],
      recordings: [{ mediaId: "recording-scheduling", transcript: transcriptFromRaw("recording-scheduling", raw, DURATION_SECONDS), durationSeconds: DURATION_SECONDS }],
    },
    meta,
  );
}

const find = (state: ReviewState, id: string) => state.propositions.find((p) => p.id === id);
const lines = (state: ReviewState, slot: string): RequestItem[] => (state.request?.items ?? []).filter((i) => slotOf(i.propositionId) === slot);
const openLine = (state: ReviewState, slot: string) => lines(state, slot).find((i) => !i.satisfiedAt);
const instanceOf = (item: RequestItem | undefined) => item?.instance ?? 1;

describe("instances: a resolution belongs to one opening of a question", () => {
  it("asked again by the reviewer, a resolved question is a new instance with nothing inherited; the same draft again keeps the other resolution; closed lines never change", async () => {
    const { resolvedQuestions } = await import("../src/lib/engine/review");
    let s = buildReview(submission(), draft(), NOW);
    s = addToRequest(s, "xcheck:days", T1);
    s = approveRequest(s, T1);
    s = resolveRequestItem(s, "doc:insurance_card", "by phone", T2);
    s = resolveRequestItem(s, "xcheck:days", "confirmed", T2);
    const closed = structuredClone(s.request!.items);
    expect(closed).toHaveLength(2);
    expect(closed.every((i) => i.satisfiedBy === "reviewer" && i.satisfiedAt === T2 && instanceOf(i) === 1)).toBe(true);
    expect(resolvedQuestions(s.request)).toEqual(new Set(["doc:insurance_card", "xcheck:days"]));

    // The reviewer asks about the days again: instance 2, open, no resolution inherited.
    s = addToRequest(s, "xcheck:days", T3);
    const again = openLine(s, "xcheck:days");
    expect(again).toBeDefined();
    expect(instanceOf(again)).toBe(2);
    expect(again?.satisfiedAt).toBeUndefined();
    expect(again?.reopened?.because).toMatch(/added/);
    expect(find(s, "xcheck:days")?.inRequest).toBe(true);
    expect(resolvedQuestions(s.request)).toEqual(new Set(["doc:insurance_card"]));
    s = approveRequest(s, T3);

    // The same draft run again: the card stays resolved, the days stay asked, on the same instance, its basis there.
    s = replaceDraft(s, draft(RAW_DRAFT, undefined, "live"), T4);
    expect(find(s, "doc:insurance_card")?.inRequest).toBe(false);
    expect(find(s, "xcheck:days")?.inRequest).toBe(true);
    expect(instanceOf(openLine(s, "xcheck:days"))).toBe(2);
    expect(openLine(s, "xcheck:days")?.basisMissing).toBeUndefined();
    expect(s.request?.status).toBe("approved");
    for (const line of closed) expect(s.request?.items).toContainEqual(line);

    // A resolution of the new instance closes that line only: the lines closed at T2 are untouched.
    s = resolveRequestItem(s, "xcheck:days", "again", T5);
    for (const line of closed) expect(s.request?.items).toContainEqual(line);
    expect(lines(s, "xcheck:days").map((i) => [instanceOf(i), i.satisfiedAt])).toEqual([
      [2, T5],
      [1, T2],
    ]);
    expect(resolvedQuestions(s.request)).toEqual(new Set(["doc:insurance_card", "xcheck:days"]));

    // A new submission opens the card again, as instance 2; the days, a cross-check, are only asked again by the reviewer.
    const sent = submission({ version: 2 });
    sent.answers.phone = "(718) 555-0199";
    s = applySubmission(s, sent, draft(), T6);
    expect(instanceOf(openLine(s, "doc:insurance_card"))).toBe(2);
    expect(openLine(s, "doc:insurance_card")?.reopened?.because).toMatch(/the family sent the form again/);
    expect(openLine(s, "xcheck:days")).toBeUndefined();
    for (const line of closed) expect(s.request?.items).toContainEqual(line);
  });

  it("the instance of an open question is part of the context the request text is approved for", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = approveRequest(s, T1);
    const first = s.request!.contextParts!.items;
    s = resolveRequestItem(s, "doc:insurance_card", "", T2);
    const sent = submission({ version: 2 });
    sent.answers.phone = "(718) 555-0199";
    s = applySubmission(s, sent, draft(), T3);
    expect(instanceOf(openLine(s, "doc:insurance_card"))).toBe(2);
    expect(s.request!.contextParts!.items).not.toBe(first);
    expect(s.request?.status).toBe("draft");
  });
});

describe("the note names the key the model returned, and no other", () => {
  const NOT_THURSDAYS = "Not Thursdays, Sam has swimming on Thursdays.";

  it("for each key of the raw schema, a claim with Thursday in its days is noted under that key's label only", async () => {
    const { KEY_LABELS } = await import("../src/lib/engine/verify");
    const keys = RawClaim.shape.key.options.filter((key) => key !== "other");
    expect(keys).toEqual(["days_that_work", "days_that_do_not_work", "time_window", "location_preference"]);
    for (const key of keys) {
      const d = recordingDraft(HAND_TRANSCRIPT, [claim({ key, label: key, quote: NOT_THURSDAYS, days: ["thursday"], statement: "The parent states that Thursdays do not work." })]);
      expect(d.withheld, key).toEqual([]);
      const p = buildReview(submission(), d, NOW).propositions.find((q) => q.id.includes(`:${key}:`))!;
      expect(p.criterion?.note, key).toMatch(`Thursday under ${KEY_LABELS[key]}`);
      for (const other of keys) {
        if (other !== key) expect(p.criterion?.note, `${key} against ${other}`).not.toMatch(`under ${KEY_LABELS[other]}`);
      }
      expect(p.checked?.join(" "), key).toMatch(`listed under ${KEY_LABELS[key]}`);
    }
  });

  it("the label of every key is the same in the source check and in the note: one map, exported by the verifier", async () => {
    const { KEY_LABELS } = await import("../src/lib/engine/verify");
    expect(KEY_LABELS).toEqual({ days_that_work: "days that work", days_that_do_not_work: "days that do not work", time_window: "the time window", location_preference: "the place", other: "a free statement" });
    const review = readFileSync(path.resolve(import.meta.dirname, "../src/lib/engine/review.ts"), "utf8");
    expect(review).not.toMatch(/"days that do not work" : "days that work"/);
    expect(review).toMatch(/under \$\{KEY_LABELS\[claim\.key\]\}/);
  });
});

describe("one convention of equality, shared", () => {
  it("case, runs of spaces and punctuation at the ends of words are ignored; word boundaries are kept", async () => {
    const { sameText, foldText } = await import("../src/lib/engine/text");
    expect(sameText("Mary Ann Lee", "mary  ann lee.")).toBe(true);
    expect(sameText("Alice Moreno, MD", "alice moreno md")).toBe(true);
    expect(sameText("(800) 555-0121", "800 555-0121")).toBe(true);
    expect(sameText("Mary Ann Lee", "Maryann Lee")).toBe(false);
    expect(sameText("Sam Bennett", "Sam Bennet")).toBe(false);
    expect(foldText("  Sam   Bennett. ")).toBe("sam bennett");
  });

  it("the name criterion uses it: a trailing period on the letter is the same text as the form; a joined name is not", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents = [
      {
        mediaId: "referral-letter",
        readable: true,
        unreadableReason: null,
        fields: [{ key: "patient_name", label: "Patient name", value: "Sam Bennett.", normalized: null, page: 1, quote: "Patient: Sam Bennett.", uncertain: null }],
      },
    ];
    const pages = { 1: "Patient: Sam Bennett.\nRe: SamBennett" };
    const d = verifyDraft(raw, { documents: [{ mediaId: "referral-letter", pages }], recordings: [] }, meta);
    const s = buildReview(submission(), d, NOW);
    expect(find(s, "field:referral-letter:patient_name")?.criterion?.result).toBe("met");
    expect(find(s, "field:referral-letter:patient_name")?.criterion?.rule).toMatch(/word boundaries are kept/);
    const joined = structuredClone(raw);
    joined.documents[0].fields[0] = { ...joined.documents[0].fields[0], value: "SamBennett", quote: "Re: SamBennett" };
    const e = verifyDraft(joined, { documents: [{ mediaId: "referral-letter", pages }], recordings: [] }, meta);
    expect(find(buildReview(submission(), e, NOW), "field:referral-letter:patient_name")?.criterion?.result).toBe("not_met");
  });

  it("with two values, met only when one of them is the same text as the form; the other stays visible, to confirm; an uncertain match is not met", () => {
    const pages = { 1: "Patient: Mary Ann Lee\nRe: Maryann Lee, evaluation" };
    const field = (value: string, quote: string, uncertain: string | null = null) => ({ key: "patient_name" as const, label: "Patient name", value, normalized: null, page: 1, quote, uncertain });
    const build = (fields: ReturnType<typeof field>[], first: string) => {
      const raw = structuredClone(RAW_DRAFT);
      raw.documents = [{ mediaId: "referral-letter", readable: true, unreadableReason: null, fields }];
      const sub = submission();
      sub.answers.child_first_name = first;
      sub.answers.child_last_name = "Lee";
      return find(buildReview(sub, verifyDraft(raw, { documents: [{ mediaId: "referral-letter", pages }], recordings: [] }, meta), NOW), "field:referral-letter:patient_name")!;
    };
    const met = build([field("Mary Ann Lee", "Patient: Mary Ann Lee"), field("Maryann Lee", "Re: Maryann Lee, evaluation")], "Mary Ann");
    expect(met.finding).toBe("to_confirm");
    expect(met.criterion?.result).toBe("met");
    expect(met.criterion?.note).toMatch(/"Mary Ann Lee" \(page 1\) is the same text as the form/);
    expect(met.criterion?.note).toMatch(/"Maryann Lee" \(page 1\) is another reading of the same field; it stays visible, to confirm/);
    expect(met.statement).toMatch(/Maryann Lee/);
    const none = build([field("Mary Ann Lee", "Patient: Mary Ann Lee"), field("Maryann Lee", "Re: Maryann Lee, evaluation")], "Marianne");
    expect(none.criterion?.result).toBe("not_met");
    expect(none.finding).toBe("to_confirm");
    const doubtful = build([field("Mary Ann Lee", "Patient: Mary Ann Lee", "the first name may read Marian"), field("Maryann Lee", "Re: Maryann Lee, evaluation")], "Mary Ann");
    expect(doubtful.criterion?.result).toBe("not_assessable");
    expect(doubtful.details?.uncertain).toEqual(['"Mary Ann Lee" (page 1): the first name may read Marian']);
  });
});

describe("the submission key carries the date and the version", () => {
  it("a submission sent again with the same answers is another submission", () => {
    const base = submission();
    expect(submissionKey({ ...base, submittedAt: "2026-09-21T14:12:00.000Z" })).not.toBe(submissionKey(base));
    expect(submissionKey({ ...base, version: 2 })).not.toBe(submissionKey(base));
    expect(submissionKey(structuredClone(base))).toBe(submissionKey(base));
  });
});

describe("every block's opinion is kept", () => {
  it("two blocks that disagree on readability: both readings are on the extraction, the document is readable, the merge names the disagreement", () => {
    const raw = structuredClone(RAW_DRAFT);
    const [letter] = raw.documents;
    raw.documents = [{ mediaId: "referral-letter", readable: false, unreadableReason: "the scan is too dark", fields: [] }, letter];
    const d = verifyDraft(raw, { documents: [source("referral-letter"), source("insurance-card")], recordings: [] }, meta);
    expect(d.documents[0].readings).toEqual([
      { block: 1, readable: false, unreadableReason: "the scan is too dark" },
      { block: 2, readable: true, unreadableReason: null },
    ]);
    const s = buildReview(submission(), d, NOW);
    expect(find(s, "doc:referral_letter")?.statement).toMatch(/One block of the 2 the draft returned called it not readable \(the scan is too dark\)/);
    expect(find(s, "blocks:referral-letter")?.statement).toMatch(/block 1 of 2: not readable \(the scan is too dark\); block 2 of 2: readable/);
  });

  it("one block: no readings, and the recorded fixture is unchanged in shape", () => {
    const d = verifyDraft(RAW_DRAFT, { documents: [source("referral-letter"), source("insurance-card")], recordings: [] }, meta);
    expect(d.documents[0].blocks).toBeUndefined();
    expect(d.documents[0].readings).toBeUndefined();
  });
});

describe("the word list flags a statement for review; it establishes nothing", () => {
  it("whole words only: delayed, delays and healthy pass; autism, developmental and hours a week are flagged, with the matched words", () => {
    const kept = (words: string) => recordingDraft(spoken(`${words}.`), [claim({ key: "days_that_work", label: "Days that work", quote: words, days: ["tuesday"], statement: `The parent states that ${words}.` })]);
    expect(kept("Tuesdays work if the bus is not delayed").withheld).toEqual([]);
    expect(kept("Tuesdays work unless there are delays").withheld).toEqual([]);
    expect(kept("Tuesdays work when Sam is healthy").withheld).toEqual([]);
    const flagged = (statement: string) => recordingDraft(HAND_TRANSCRIPT, [claim({ key: "other", label: "Other", statement, nature: "inference", quote: "we would rather do the sessions at home" })]).withheld;
    expect(flagged("The parent states that Sam's autism is severe.")).toEqual([expect.objectContaining({ reason: "flagged_for_review" })]);
    expect(flagged("The parent states that Sam's autism is severe.")[0].detail).toMatch(/flagged for review \(matched: "autism"\)/);
    expect(flagged("The parent states that Sam has a developmental delay.")[0].detail).toMatch(/matched: "developmental"/);
    expect(flagged("The parent states that Sam needs thirty hours a week.")[0].detail).toMatch(/matched: "hours a week"/);
    expect(flagged("The parent states that Sam's autism is severe.")[0].detail).not.toMatch(/The statement is clinical|goes beyond scheduling/);
    expect(flagged("The parent states that Sam's autism is severe.")[0].detail).toMatch(/not established by the code/);
  });

  it("the reason shown for the flag says review, not clinical", async () => {
    const d = recordingDraft(HAND_TRANSCRIPT, [claim({ key: "other", label: "Other", statement: "The parent states that Sam's autism is severe.", nature: "inference", quote: "we would rather do the sessions at home" })]);
    const s = buildReview(submission(), d, NOW);
    const listed = s.propositions.find((p) => p.finding === "withheld" && p.label === "Other")!;
    expect(listed.criterion?.note).toMatch(/^Flagged for review/);
    expect(listed.criterion?.note).toMatch(/not established/);
    expect(listed.criterion?.note).not.toMatch(/The statement is clinical/);
    const review = readFileSync(path.resolve(import.meta.dirname, "../src/lib/engine/review.ts"), "utf8");
    expect(review).not.toMatch(/clinical_content/);
  });
});
