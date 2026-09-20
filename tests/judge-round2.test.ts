/**
 * Second round of the second reviewer (20 September 2026), on commit 1498107:
 * 27 tests written from its descriptions, with the inputs it gave. A01 to A09,
 * B01 to B13 (B08 was its own positive control and is not repeated here), C01,
 * C02 and C05. Every test in this file was run red on 1498107 before the
 * correction it names; the output of that run is in the correction report.
 * Two lines were adapted in the fourth pass, each marked where it stands: A04
 * (a cross-check is to confirm, never consistent) and the end of A06 (a
 * corrected fact sends the message back to draft, R3-A06). The fifth pass
 * adapted A06 again and B01, B02, B03, B04, B06, B07, B13 and C05, each marked
 * where it stands: the code reads no polarity from words, so a claim whose
 * words say the opposite is no longer withheld but kept as extracted, shown
 * with its quote and attributed to the extraction; and a corrected contributor
 * sends the message back to draft (R4-A03).
 *
 * Three principles they enforce: a model's assumption never becomes a computed
 * agreement; an approval never follows a fact, a recipient or a request type it
 * did not cover; a rejection never disappears from the list.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RawClaim, RawTranscript } from "../src/lib/engine/raw";
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
  editRequest,
  isReviewed,
  receiveDocument,
  replaceDraft,
} from "../src/lib/engine/review";
import type { Draft, Proposition, ReviewState } from "../src/lib/engine/types";
import { transcriptFromRaw, verifyDraft } from "../src/lib/engine/verify";
import { loadReview, mediaForLiveRun, RECORDED_DRAFT, resetToSample } from "../src/lib/review-store";
import { SAMPLE_SUBMISSION } from "../src/lib/sample";
import { DURATION_SECONDS, HAND_TRANSCRIPT, NOW, RAW_DRAFT, draft, source, submission } from "./helpers";

const T1 = "2026-09-20T15:01:00.000Z";
const T2 = "2026-09-20T15:02:00.000Z";
const T3 = "2026-09-20T15:03:00.000Z";

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

describe("A. approvals that survive a relevant change", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("A01. a corrected, approved message does not stay approved when the child becomes Alex and the parent Casey Bennett", () => {
    let s = buildReview(submission(), draft(), NOW);
    const edited = s.request!.text.replace("Hi Jordan,", "Hi Jordan, thank you for your patience.");
    s = editRequest(s, edited, T1);
    s = approveRequest(s, T1);
    expect(s.request?.status).toBe("approved");
    const again = submission({ version: 2 });
    again.answers.child_first_name = "Alex";
    again.answers.guardian_name = "Casey Bennett";
    s = applySubmission(s, again, draft(), T2);
    expect(s.submission.answers.child_first_name).toBe("Alex");
    // The message is a draft again, written for the new recipient and the new child.
    expect(s.request?.status).toBe("draft");
    expect(s.request?.text).not.toMatch(/Jordan/);
    expect(s.request?.text).not.toMatch(/Sam's/);
    expect(s.request?.text).toMatch(/^Hi Casey,/);
    expect(s.request?.text).toMatch(/Alex's intake form/);
    // The missing item is not reviewed through a request approved for someone else.
    expect(isReviewed(find(s, "doc:insurance_card")!, s.request)).toBe(false);
    // The old wording stays in the record, without its approval.
    expect(s.request?.approvals[0]?.text).toBe(edited);
    expect(s.request?.approvals[0]?.superseded).toBeDefined();
    expect(s.journal.some((e) => e.action === "request_reopened" || e.action === "request_updated")).toBe(true);
  });

  it("A02. an approved request for a missing card changes type when the card arrives unreadable", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = approveRequest(s, T1);
    s = receiveDocument(s, "insurance_card", "insurance-card", { mediaId: "insurance-card", readable: false, unreadableReason: "the photo is blurred", fields: [] }, T2);
    expect(find(s, "doc:insurance_card")?.finding).toBe("unreadable");
    const item = s.request?.items.find((i) => i.propositionId === "doc:insurance_card");
    expect(item?.kind).toBe("unreadable_item");
    expect(s.request?.status).toBe("draft");
    expect(s.request?.text).toMatch(/not readable/);
    expect(s.request?.approvals[0]?.superseded).toBeDefined();
  });

  it("A03. an approved time proposition whose structured hour changes from 15 to 3, same text, same quote, is not approved any more", () => {
    let s = buildReview(submission(), draft(), NOW);
    const id = claimId(s, "time_window");
    s = approve(s, id, T1);
    expect(find(s, id)?.state).toBe("approved");
    const raw = structuredClone(RAW_DRAFT);
    const time = raw.recordings[0].claims.find((c) => c.key === "time_window")!;
    expect(time.earliestHour).toBe(15);
    time.earliestHour = 3;
    s = replaceDraft(s, draft(raw, undefined, "live"), T2);
    const p = find(s, id);
    expect(p?.state).not.toBe("approved");
    expect(p?.approvedAt).toBeUndefined();
    if (p) expect(p.recheck).toBeDefined();
  });

  it("A04. a days cross-check built on two statements (Tuesday, Friday) is flagged when the Friday statement is corrected", () => {
    const raw = spoken("Tuesdays work best for us.", "Fridays are fine too.", "Not Thursdays.");
    const d = recordingDraft(raw, [
      claim({ key: "days_that_work", label: "Days that work", quote: "Tuesdays work best for us", days: ["tuesday"], statement: "The parent states that Tuesdays work best." }),
      claim({ key: "days_that_work", label: "Days that work", quote: "Fridays are fine too", days: ["friday"], statement: "The parent states that Fridays are fine too." }),
    ]);
    const sub = submission();
    sub.answers.preferred_days = ["tuesday", "friday"];
    let s = buildReview(sub, d, NOW);
    const days = find(s, "xcheck:days")!;
    // "consistent" until the fourth pass; since then the code never affirms an agreement, and this cross-check is to confirm.
    expect(days.finding).toBe("to_confirm");
    expect(days.statement).toMatch(/Tuesday and Friday/);
    s = approve(s, "xcheck:days", T1);
    const friday = s.propositions.find((p) => p.id.includes(":days_that_work:") && p.statement.includes("Friday"))!;
    s = correct(s, friday.id, "The parent states that Fridays do not work.", T2);
    const after = find(s, "xcheck:days")!;
    expect(after.recheck).toBeDefined();
    expect(after.dependsOn).toContain(friday.id);
    expect(after.evidence.filter((e) => e.kind === "audio")).toHaveLength(2);
  });

  it("A05. a proposition that goes from corrected to approved does not leave the file approval with a stale fingerprint", () => {
    let s = reviewed(buildReview(submission(), draft(), NOW));
    s = approveFile(s, s.version, T2);
    expect(find(s, "xcheck:days")?.state).toBe("corrected");
    s = approve(s, "xcheck:days", T3);
    expect(find(s, "xcheck:days")?.state).toBe("approved");
    const approval = s.approval;
    expect(!approval || approval.hash === contentFingerprint(s)).toBe(true);
  });

  it("A06. an element in an approved request that receives a recheck can be reviewed on its own, and re-approving the request does not do it", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = addToRequest(s, "xcheck:days", T1);
    s = approveRequest(s, T1);
    s = correct(s, claimId(s, "days_that_work"), "The parent states that Tuesdays and Wednesdays work.", T2);
    const conflict = find(s, "xcheck:days")!;
    expect(conflict.recheck).toBeDefined();
    expect(conflict.inRequest).toBe(true);
    expect(isReviewed(conflict, s.request)).toBe(false);
    // Approving the request again approves nothing about its evidence.
    const again = approveRequest(s, T3);
    expect(find(again, "xcheck:days")?.recheck).toBeDefined();
    // The reviewer can finish the review of the element itself: approve it as it stands, or correct it.
    const confirmed = approve(s, "xcheck:days", T3);
    expect(find(confirmed, "xcheck:days")?.recheck).toBeUndefined();
    expect(canApproveFile(confirmed).reasons.join(" ")).not.toMatch(/xcheck/);
    const corrected = correct(s, "xcheck:days", "Confirmed by phone: Tuesdays only. Still asked in the message.", T3);
    expect(find(corrected, "xcheck:days")?.recheck).toBeUndefined();
    // Since the fourth pass (R3-A06), correcting a fact the message asks about sends the message back to draft: the item is
    // reviewed through the message once the message is approved again for the corrected fact.
    expect(corrected.request?.status).toBe("draft");
    expect(isReviewed(find(corrected, "xcheck:days")!, corrected.request)).toBe(false);
    const reapproved = approveRequest(corrected, T3);
    expect(isReviewed(find(reapproved, "xcheck:days")!, reapproved.request)).toBe(true);
    // Since the fifth pass (R4-A03), the correction of the contributor above already sent the message back to draft: the
    // element approved on its own counts as reviewed through the message once the message is approved again.
    expect(s.request?.status).toBe("draft");
    expect(isReviewed(find(approveRequest(confirmed, T3), "xcheck:days")!, approveRequest(confirmed, T3).request)).toBe(true);
  });

  it("A07. the result of a live run started before a reset is not applied to the file built by the reset, same reference, same media", () => {
    const before = loadReview(NOW);
    const expected = { reference: before.submission.reference, media: mediaForLiveRun(before.submission), builtAt: before.builtAt };
    const after = resetToSample(T1);
    expect(after.submission.reference).toBe(before.submission.reference);
    expect(mediaForLiveRun(after.submission)).toEqual(expected.media);
    const result = applyLiveRun(after, expected, draft(RAW_DRAFT, undefined, "live"), T2);
    expect(result.applied).toBe(false);
    expect(result.state).toBe(after);
    // Control: the same expectation on the file it was made for, even corrected meanwhile, is applied.
    const corrected = correct(before, claimId(before, "days_that_work"), "The parent states that Tuesdays work best, after 4 pm.", T1);
    expect(applyLiveRun(corrected, expected, draft(RAW_DRAFT, undefined, "live"), T2).applied).toBe(true);
  });

  it("A08. submittedAt, which the date rules read, is part of the content fingerprint", () => {
    const s = buildReview(submission(), draft(), NOW);
    const base = contentFingerprint(s);
    const moved = { ...s, submission: { ...s.submission, submittedAt: "2027-10-01T00:00:00.000Z" } };
    expect(contentFingerprint(moved)).not.toBe(base);
  });

  it("A09. a signature date that changes at the same submission version is applied and journaled, and ends the file approval", () => {
    let s = reviewed(buildReview(submission(), draft(), NOW));
    s = approveFile(s, s.version, T2);
    const again = submission();
    again.signature = { name: SAMPLE_SUBMISSION.signature!.name, signedAt: "2026-09-20T16:00:00.000Z" };
    expect(again.version).toBe(s.submission.version);
    const next = applySubmission(s, again, draft(), T3);
    expect(next.submission.signature?.signedAt).toBe("2026-09-20T16:00:00.000Z");
    expect(next.journal.some((e) => e.action === "submission_updated")).toBe(true);
    expect(next.approval).toBeUndefined();
  });
});

describe("B. verification that still confuses word presence with support of a fact", () => {
  /** Since the fifth pass: kept as extracted, attributed, never established. The words stand next to the extraction for the reviewer. */
  const attributed = (state: ReviewState, id: string) => {
    const cross = find(state, id)!;
    expect(cross.statement).toMatch(/^As extracted/);
    expect(cross.finding).not.toBe("consistent");
    expect(cross.criterion?.result).not.toBe("met");
    return cross;
  };

  it("B01. \"Thursdays don't work for us\" structured as a day that works is kept as extracted, its quote next to it, and attributed to the extraction (adapted in the fifth pass)", () => {
    // Until the fifth pass the apostrophe kept its negation and the claim was withheld. The code reads no polarity now.
    const raw = spoken("Thursdays don't work for us.");
    const d = recordingDraft(raw, [claim({ key: "days_that_work", label: "Days that work", quote: "Thursdays don't work for us", days: ["thursday"] })]);
    expect(d.recordings[0].claims.find((c) => c.key === "days_that_work")?.days).toEqual(["thursday"]);
    expect(d.withheld).toEqual([]);
    const sub = submission();
    sub.answers.preferred_days = ["thursday"];
    const cross = attributed(buildReview(sub, d, NOW), "xcheck:days");
    expect(cross.finding).toBe("to_confirm");
    expect(cross.evidence).toContainEqual(expect.objectContaining({ kind: "audio", quote: "Thursdays don't work for us" }));
  });

  it("B02. quoting only \"Thursdays\" out of \"Not Thursdays\" is kept as extracted: the segment with the words is cued, the extraction is attributed, nothing is established (adapted in the fifth pass)", () => {
    // Until the fifth pass the source clause was read and the claim withheld. The code reads no polarity now; the reviewer listens.
    const d = recordingDraft(HAND_TRANSCRIPT, [claim({ key: "days_that_work", label: "Days that work", quote: "Thursdays", days: ["thursday"] })]);
    const kept = d.recordings[0].claims.find((c) => c.key === "days_that_work");
    expect(kept?.days).toEqual(["thursday"]);
    expect(kept?.segment).toEqual({ start: 4.4, end: 7.9 });
    expect(d.withheld).toEqual([]);
    const sub = submission();
    sub.answers.preferred_days = ["thursday"];
    expect(attributed(buildReview(sub, d, NOW), "xcheck:days").finding).toBe("to_confirm");
  });

  it("B03. \"after 3 am\" with earliestHour 15 is kept as the model's extraction, quoted, to confirm, never met (adapted in the fifth pass)", () => {
    // Until the fifth pass the code read "3 am" and withheld the 15. It reads no hour from words now: 15 is shown as extracted next to
    // "any time after 3 am", for the reviewer.
    const raw = spoken("Tuesdays work best for us, any time after 3 am.");
    const d = recordingDraft(raw, [claim({ key: "time_window", label: "Time window", quote: "any time after 3 am", earliestHour: 15 })]);
    expect(d.recordings[0].claims.find((c) => c.key === "time_window")?.earliestHour).toBe(15);
    expect(d.withheld).toEqual([]);
    const cross = attributed(buildReview(submission(), d, NOW), "xcheck:time");
    expect(cross.finding).toBe("to_confirm");
    expect(cross.statement).toMatch(/"any time after 3 am"/);
  });

  it("B04. \"before 3 pm\" with earliestHour 15 is kept as extracted, quoted, to confirm, never met (adapted in the fifth pass)", () => {
    const raw = spoken("Any time before 3 pm works for us.");
    const d = recordingDraft(raw, [claim({ key: "time_window", label: "Time window", quote: "before 3 pm", earliestHour: 15 })]);
    expect(d.recordings[0].claims.find((c) => c.key === "time_window")?.earliestHour).toBe(15);
    const cross = attributed(buildReview(submission(), d, NOW), "xcheck:time");
    expect(cross.finding).toBe("to_confirm");
    expect(cross.statement).toMatch(/"before 3 pm"/);
  });

  it("B05. \"after three\" with earliestHour 27 is not an hour", () => {
    const d = recordingDraft(HAND_TRANSCRIPT, [claim({ key: "time_window", label: "Time window", quote: "any time after three", earliestHour: 27 })]);
    expect(d.recordings[0].claims.some((c) => c.key === "time_window")).toBe(false);
    expect(d.withheld).toEqual([expect.objectContaining({ key: "time_window", reason: "structured_not_in_quote" })]);
  });

  it("B06. in the recorded review as delivered, the extracted hour does not become a consistent cross-check: as extracted, to confirm (adapted in the fifth pass)", () => {
    // The recorded run's time statement carries no uncertainty from the model: it is present, as extracted, its criterion not
    // assessable; the cross-check with the form is to confirm and never met.
    const s = buildReview(SAMPLE_SUBMISSION, RECORDED_DRAFT, NOW);
    const time = s.propositions.find((p) => p.id.includes(":time_window:"))!;
    expect(time.criterion?.result).toBe("not_assessable");
    const cross = find(s, "xcheck:time")!;
    expect(cross.finding).not.toBe("consistent");
    expect(cross.finding).toBe("to_confirm");
    expect(cross.criterion?.result).not.toBe("met");
    expect(cross.statement).toMatch(/^As extracted/);
    expect(cross.statement).toMatch(/To confirm/);
  });

  it("B06b. an hour the model marks as assumed, even with AM or PM in the words, is to confirm, never consistent", () => {
    const raw = spoken("Tuesdays work best for us, any time after three pm.");
    const d = recordingDraft(raw, [
      claim({ key: "time_window", label: "Time window", quote: "any time after three pm", earliestHour: 15, uncertain: "3:00 PM (15:00) was assumed based on context." }),
    ]);
    const s = buildReview(submission(), d, NOW);
    const cross = find(s, "xcheck:time")!;
    expect(cross.finding).toBe("to_confirm");
    expect(cross.criterion?.result).not.toBe("met");
  });

  it("B07. \"We cannot do the sessions at home\" with a structured place home is kept as extracted, quoted, and never agrees with a form that says home (adapted in the fifth pass)", () => {
    // Until the fifth pass the negation was read and the claim withheld. The code reads no polarity now; the quote stands next to it.
    const raw = spoken("We cannot do the sessions at home.");
    const d = recordingDraft(raw, [claim({ key: "location_preference", label: "Location preference", quote: "We cannot do the sessions at home", location: "home" })]);
    expect(d.recordings[0].claims.find((c) => c.key === "location_preference")?.location).toBe("home");
    expect(d.withheld).toEqual([]);
    const sub = submission();
    sub.answers.location = "home";
    const cross = attributed(buildReview(sub, d, NOW), "xcheck:location");
    expect(cross.finding).toBe("to_confirm");
    expect(cross.statement).toMatch(/"We cannot do the sessions at home"/);
  });

  it("B09. a free statement in other is never a finding: \"sessions at home will cure the child\" is withheld", () => {
    const d = recordingDraft(HAND_TRANSCRIPT, [
      claim({ key: "other", label: "Other", statement: "The parent states that sessions at home will cure the child.", nature: "inference", quote: "we would rather do the sessions at home" }),
    ]);
    expect(d.recordings[0].claims.some((c) => c.key === "other")).toBe(false);
    expect(d.withheld).toHaveLength(1);
    expect(d.withheld[0].key).toBe("other");
    // Sixth pass: the word list flags a statement for review, it does not establish that it is clinical (R5-S07, S08).
    expect(["flagged_for_review", "free_statement"]).toContain(d.withheld[0].reason);
  });

  it("B10. a value assembled from distant words of the page, \"Sam Moreno, MD\", is withheld: the value must be contiguous in the passage", () => {
    const raw = structuredClone(RAW_DRAFT);
    const provider = raw.documents[0].fields.find((f) => f.key === "referring_provider")!;
    provider.value = "Sam Moreno, MD";
    provider.quote =
      "I am referring Sam Bennett for an evaluation for applied behavior analysis (ABA) services. A diagnostic evaluation dated June 2, 2026 is on file at our office; " +
      "the diagnosis listed on that evaluation is autism spectrum disorder (F84.0). The family has asked that services be considered for the fall. " +
      "Please contact our office if any additional information is required for your intake. Sincerely, Alice Moreno, MD";
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.documents[0].fields.some((f) => f.key === "referring_provider")).toBe(false);
    expect(d.withheld).toEqual([expect.objectContaining({ key: "referring_provider", reason: "value_not_in_quote" })]);
  });

  it("B11. a machine-form date is compared with the value, not with any date of the passage: August 28, 2026 normalized to 2026-06-02 is withheld", () => {
    const raw = structuredClone(RAW_DRAFT);
    const date = raw.documents[0].fields.find((f) => f.key === "referral_date")!;
    date.value = "August 28, 2026";
    date.normalized = "2026-06-02";
    date.quote =
      "August 28, 2026 Re: Referral for applied behavior analysis (ABA) services Patient: Sam Bennett Date of birth: March 14, 2020 Parent or guardian: Jordan Bennett " +
      "To whom it may concern, I am referring Sam Bennett for an evaluation for applied behavior analysis (ABA) services. A diagnostic evaluation dated June 2, 2026 is on file";
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.documents[0].fields.find((f) => f.key === "referral_date")?.normalized ?? null).not.toBe("2026-06-02");
    expect(d.withheld).toEqual([expect.objectContaining({ key: "referral_date", reason: "normalized_mismatch" })]);
  });

  it("B12. February 31, 2026 is not a date: a synthetic document carrying it gives no machine-form date and no met criterion", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents = [
      {
        mediaId: "referral-letter",
        readable: true,
        unreadableReason: null,
        fields: [{ key: "referral_date", label: "Referral date", value: "February 31, 2026", normalized: "2026-02-31", page: 1, quote: "Referral date: February 31, 2026", uncertain: null }],
      },
    ];
    const sources = { ...sourcesFor(), documents: [{ mediaId: "referral-letter", pages: { 1: "Referral date: February 31, 2026" } }] };
    const d = verifyDraft(raw, sources, meta);
    const field = d.documents[0]?.fields.find((f) => f.key === "referral_date");
    expect(field?.normalized ?? null).toBeNull();
    const s = buildReview(submission(), d, NOW);
    expect(find(s, "field:referral-letter:referral_date")?.criterion?.result ?? "absent").not.toBe("met");
  });

  it("B13. \"after 3:00\" with earliestHour 12 is kept as the model's extraction, quoted, to confirm, never met (adapted in the fifth pass)", () => {
    // Until the fifth pass the code read the words and withheld the 12. It reads no hour from words now: 12:00 pm is shown as extracted
    // next to "anytime after 3:00", for the reviewer; an hour outside 0 to 23 is still refused.
    const raw = spoken("So Tuesdays work best for us, anytime after 3:00.");
    const d = recordingDraft(raw, [claim({ key: "time_window", label: "Time window", quote: "anytime after 3:00", earliestHour: 12 })]);
    expect(d.recordings[0].claims.find((c) => c.key === "time_window")?.earliestHour).toBe(12);
    expect(d.withheld).toEqual([]);
    const cross = attributed(buildReview(submission(), d, NOW), "xcheck:time");
    expect(cross.finding).toBe("to_confirm");
    expect(cross.statement).toMatch(/12:00 pm/);
    expect(cross.statement).toMatch(/"anytime after 3:00"/);
  });
});

describe("C. rejections that disappear, documents the extraction omitted, Spanish that attributes an assumption", () => {
  it("C01. a document the model names wrongly (referral-leter) is listed as not evaluable with its reason, and the real letter is not shown as read", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].mediaId = "referral-leter";
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([expect.objectContaining({ mediaId: "referral-leter", key: "*", reason: "unknown_media" })]);
    const s = buildReview(submission(), d, NOW);
    const listed = s.propositions.find((p) => p.finding === "withheld");
    expect(listed).toBeDefined();
    expect(listed?.statement).toMatch(/referral-leter/);
    expect(listed?.criterion?.result).toBe("not_assessable");
    expect(isReviewed(listed!, s.request)).toBe(false);
    const letter = find(s, "doc:referral_letter")!;
    expect(letter.finding).not.toBe("present");
  });

  it("C02. a document absent from the extraction output is not \"Received. Not read yet. / Present\": it follows the document that gave no field", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents = raw.documents.filter((doc) => doc.mediaId !== "referral-letter");
    const d = verifyDraft(raw, sourcesFor(), meta);
    const s = buildReview(submission(), d, NOW);
    const letter = find(s, "doc:referral_letter")!;
    expect(letter.finding).toBe("to_confirm");
    expect(letter.criterion?.id).toBe("document_read");
    expect(letter.criterion?.result).toBe("not_met");
    expect(letter.statement).not.toBe("Received. Not read yet.");
    expect(letter.statement).toMatch(/0 fields/);
    expect(s.stage).toBe("waiting_for_review");
  });

  it("C05. the Spanish message composed from the delivered review cites the extracted hour only as our reading, in a question (adapted in the fifth pass)", () => {
    // Until the fifth pass the code read that "3:00" had no AM or PM and asked without an hour. It reads no words now: the model's
    // extraction (15:00) is cited "tal como la leímos", as a question to the family, never as what the parent said.
    const sub = structuredClone(SAMPLE_SUBMISSION);
    sub.language = "es";
    sub.answers.contact_language = "es";
    sub.answers.preferred_time = "morning";
    let s = buildReview(sub, RECORDED_DRAFT, NOW);
    const cross = find(s, "xcheck:time")!;
    expect(cross.requestable).toBe("confirm");
    s = addToRequest(s, "xcheck:time", T1);
    const text = s.request!.text;
    expect(text).toMatch(/en su respuesta grabada, tal como la leímos, dice a partir de las 15:00: ¿en qué momento del día debemos planificar las sesiones\?/);
    expect(text).not.toMatch(/The parent|el padre|la madre/);
  });
});
