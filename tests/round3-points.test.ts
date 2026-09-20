/**
 * The passing paths of the fourth pass: what the new guardrails must still
 * let through, and the actions they add. Written with their code, not run red.
 */
import { describe, expect, it } from "vitest";
import type { RawClaim, RawTranscript } from "../src/lib/engine/raw";
import { addToRequest, applySubmission, approveRequest, buildReview, correct, isReviewed, receiveDocument, replaceDraft, resolveRequestItem } from "../src/lib/engine/review";
import type { Draft, ReviewState } from "../src/lib/engine/types";
import { transcriptFromRaw, verifyDraft } from "../src/lib/engine/verify";
import { DURATION_SECONDS, HAND_TRANSCRIPT, NOW, RAW_DRAFT, draft, source, submission } from "./helpers";

const T1 = "2026-09-20T15:01:00.000Z";
const T2 = "2026-09-20T15:02:00.000Z";
const T3 = "2026-09-20T15:03:00.000Z";
const meta = { origin: "recorded" as const, computedAt: NOW };

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

describe("the request closes on a piece from the family or a decision of the reviewer, and on nothing else", () => {
  it("a document the family sends still satisfies its item, by the family", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = approveRequest(s, T1);
    const card = draft().documents.find((d) => d.mediaId === "insurance-card")!;
    s = receiveDocument(s, "insurance_card", "insurance-card", card, T2);
    const item = s.request?.items.find((i) => i.propositionId === "doc:insurance_card");
    expect(item?.satisfiedAt).toBe(T2);
    expect(item?.satisfiedBy).toBe("family");
    expect(item?.basisMissing).toBeUndefined();
    expect(s.request?.items.every((i) => i.satisfiedAt)).toBe(true);
  });

  it("the reviewer resolves an item whose basis is missing: closed by the reviewer, journaled, the message composed again", () => {
    const sub = submission();
    sub.documents.insurance_card = { status: "received", mediaId: "insurance-card", receivedAt: NOW };
    let s = buildReview(sub, draft(), NOW);
    s = addToRequest(s, "xcheck:days", T1);
    s = approveRequest(s, T1);
    const without = recordingDraft(HAND_TRANSCRIPT, [claim({ key: "location_preference", label: "Location preference", quote: "we would rather do the sessions at home", location: "home" })]);
    s = replaceDraft(s, { ...without, origin: "live" }, T2);
    expect(s.request?.items.find((i) => i.propositionId === "xcheck:days")?.basisMissing).toBeDefined();
    expect(s.request?.status).toBe("draft");
    // The question stays readable from the facts it was composed with.
    expect(s.request?.text).toMatch(/Thursday does not work/);
    s = resolveRequestItem(s, "xcheck:days", "confirmed by phone", T3);
    const item = s.request?.items.find((i) => i.propositionId === "xcheck:days");
    expect(item?.satisfiedAt).toBe(T3);
    expect(item?.satisfiedBy).toBe("reviewer");
    expect(item?.basisMissing).toBeUndefined();
    const entry = s.journal.find((e) => e.action === "request_item_resolved");
    expect(entry?.detail).toMatch(/confirmed by phone/);
    expect(entry?.detail).toMatch(/no longer carried it/);
    expect(s.request?.items.every((i) => i.satisfiedAt)).toBe(true);
    // Resolving it twice changes nothing.
    expect(resolveRequestItem(s, "xcheck:days", "", T3)).toBe(s);
  });

  it("the reviewer resolves a live item: it leaves the request, needs its own review, and an approved message is a draft again", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = addToRequest(s, "xcheck:days", T1);
    s = approveRequest(s, T1);
    s = resolveRequestItem(s, "xcheck:days", "", T2);
    const days = find(s, "xcheck:days")!;
    expect(days.inRequest).toBe(false);
    expect(isReviewed(days, s.request)).toBe(false);
    expect(s.request?.status).toBe("draft");
    expect(s.request?.text).not.toMatch(/Which days should we plan on/);
    expect(s.request?.items.find((i) => i.propositionId === "xcheck:days")?.satisfiedBy).toBe("reviewer");
    expect(s.request?.approvals[0]?.superseded?.because).toMatch(/text changed/);
    expect(() => resolveRequestItem(s, "field:referral-letter:patient_name", "", T3)).toThrow(/No such item/);
  });

  it("the reopening names what changed: a corrected fact, or the submission (the recipient's phone is part of it since the fifth pass)", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = addToRequest(s, "xcheck:days", T1);
    s = approveRequest(s, T1);
    const corrected = correct(s, "xcheck:days", "Thursday confirmed by phone.", T2);
    expect(corrected.request?.approvals[0]?.superseded?.because).toMatch(/fact corrected/);
    expect(corrected.request?.approvals[0]?.superseded?.because).not.toMatch(/recipient/);
    const again = submission({ version: 2 });
    again.answers.phone = "(718) 555-0199";
    const moved = applySubmission(s, again, draft(), T2);
    expect(moved.request?.status).toBe("draft");
    expect(moved.request?.approvals[0]?.superseded?.because).toMatch(/submission changed/);
    expect(moved.request?.approvals[0]?.superseded?.because).not.toMatch(/fact corrected/);
  });
});

describe("duplicate keys in the raw output", () => {
  it("the same value proposed twice is one field, with the repeat noted", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields.push({ key: "patient_name", label: "Patient name", value: "Sam Bennett", normalized: null, page: 1, quote: "I am referring Sam Bennett for an evaluation", uncertain: null });
    const d = verifyDraft(raw, { documents: [source("referral-letter"), source("insurance-card")], recordings: [] }, meta);
    const names = d.documents[0].fields.filter((f) => f.key === "patient_name");
    expect(names).toHaveLength(1);
    expect(names[0].conflict).toBeUndefined();
    expect(names[0].checked.join(" ")).toMatch(/proposed again with the same value/);
    const s = buildReview(submission(), d, NOW);
    expect(s.propositions.filter((p) => p.id === "field:referral-letter:patient_name")).toHaveLength(1);
    expect(find(s, "field:referral-letter:patient_name")?.finding).toBe("present");
  });

  it("two different values are one proposition to confirm, with both passages as its sources and no license line", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields.push({ key: "referring_provider", label: "Referring provider", value: "Sam Bennett", normalized: null, page: 1, quote: "Patient: Sam Bennett", uncertain: null });
    const d = verifyDraft(raw, { documents: [source("referral-letter"), source("insurance-card")], recordings: [] }, meta);
    const s = buildReview(submission(), d, NOW);
    const p = find(s, "field:referral-letter:referring_provider")!;
    expect(p.finding).toBe("to_confirm");
    expect(p.criterion?.id).toBe("conflicting_extraction");
    expect(p.evidence).toHaveLength(2);
    expect(p.evidence.map((e) => (e.kind === "document" ? e.quote : ""))).toEqual(["Alice Moreno, MD", "Patient: Sam Bennett"]);
    expect(p.statement).toMatch(/2 values/);
    expect(find(s, "field:referral-letter:referring_provider:license")).toBeUndefined();
  });
});
