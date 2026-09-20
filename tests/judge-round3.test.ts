/**
 * Third round of the second reviewer (20 September 2026), on commit aaf262a:
 * 35 scenarios written from its descriptions, with the inputs it gave.
 * R3-A01 to A06 (the request and its approval), R3-B01 to B09 (agreements and
 * criteria the code affirmed without establishing them), R3-R01 to R06 (true
 * positives the third pass rejected, and the origin line of a run without a
 * recording), then the 15 positive controls it described (A05 and P01 to P14).
 * The 20 that failed were run red on aaf262a before the correction; the
 * output of that run is in the correction report. The 15 controls were green
 * before and after.
 *
 * The decision they enforce, beyond the individual fixes: the code never
 * affirms an agreement between the form and the recording. A cross-check is
 * "Sources disagree" on an explicit negation in the clause of the quoted
 * words, and "To confirm" for everything else, what seems to agree included.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeDraft, resetTranscriptCache } from "../src/lib/ai/pipeline";
import { draftOriginLabel } from "../src/lib/draft-origin";
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
import { sampleIntakeDraft, switchDraftLanguage } from "../src/lib/intake-draft";
import { resetLimits } from "../src/lib/limits";
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

/** The provider propositions of the letter, the license line left aside. */
const providerProps = (state: ReviewState) => state.propositions.filter((p) => p.id.startsWith("field:referral-letter:referring_provider") && !p.id.endsWith(":license"));

describe("R3-A. a request approved for a context that is no longer the right one", () => {
  it("R3-A01. the message corrected to name Sam Bennett and approved does not stay approved when the child becomes Sam Rivera", () => {
    let s = buildReview(submission(), draft(), NOW);
    const named = s.request!.text.replace("Sam's intake form", "Sam Bennett's intake form");
    expect(named).not.toBe(s.request!.text);
    s = editRequest(s, named, T1);
    s = approveRequest(s, T1);
    expect(s.request?.status).toBe("approved");
    const again = submission({ version: 2 });
    again.answers.child_last_name = "Rivera";
    s = applySubmission(s, again, draft(), T2);
    expect(s.submission.answers.child_last_name).toBe("Rivera");
    // The file holds Sam Rivera: a message approved for Sam Bennett is a draft again.
    expect(s.request?.status).toBe("draft");
    expect(s.request?.text).not.toMatch(/Sam Bennett/);
    expect(s.request?.approvals[0]?.text).toBe(named);
    expect(s.request?.approvals[0]?.superseded).toBeDefined();
    expect(s.journal.some((e) => e.action === "request_reopened")).toBe(true);
    expect(isReviewed(find(s, "doc:insurance_card")!, s.request)).toBe(false);
  });

  it("R3-A02. an approved message does not stay approved when the contact address changes", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = approveRequest(s, T1);
    const again = submission({ version: 2 });
    again.answers.email = "jordan.rivera@example.com";
    s = applySubmission(s, again, draft(), T2);
    expect(s.submission.answers.email).toBe("jordan.rivera@example.com");
    expect(s.request?.status).toBe("draft");
    expect(s.request?.approvals[0]?.superseded).toBeDefined();
    expect(s.journal.some((e) => e.action === "request_reopened")).toBe(true);
  });

  it("R3-A03. a new draft that no longer extracts the days does not close the question asked of the family: the item stays open, its basis missing", () => {
    const sub = submission();
    sub.documents.insurance_card = { status: "received", mediaId: "insurance-card", receivedAt: NOW };
    let s = buildReview(sub, draft(), NOW);
    expect(s.request).toBeUndefined();
    s = addToRequest(s, "xcheck:days", T1);
    s = approveRequest(s, T1);
    expect(s.request?.status).toBe("approved");
    // The recording still speaks; the model just did not extract the days this time.
    const without = recordingDraft(HAND_TRANSCRIPT, [
      claim({ key: "time_window", label: "Time window", quote: "any time after three", earliestHour: 15 }),
      claim({ key: "location_preference", label: "Location preference", quote: "we would rather do the sessions at home", location: "home" }),
    ]);
    s = replaceDraft(s, { ...without, origin: "live" }, T2);
    expect(find(s, "xcheck:days")).toBeUndefined();
    const item = s.request?.items.find((i) => i.propositionId === "xcheck:days");
    expect(item).toBeDefined();
    // "The model did not extract it" is not "the family answered".
    expect(item?.satisfiedAt).toBeUndefined();
    expect(item?.basisMissing).toBeDefined();
    expect(s.request?.items.some((i) => !i.satisfiedAt)).toBe(true);
    expect(s.request?.status).toBe("draft");
    expect(s.journal.some((e) => e.action === "request_reopened")).toBe(true);
  });

  it("R3-A04. two referring_provider fields in the raw output do not share an id, and approving one does not replace the other", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields.push({ key: "referring_provider", label: "Referring provider", value: "Sam Bennett", normalized: null, page: 1, quote: "Patient: Sam Bennett", uncertain: null });
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([]);
    const s = buildReview(submission(), d, NOW);
    const providers = providerProps(s);
    const ids = providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const before = providers.map((p) => p.statement).join(" | ");
    expect(before).toMatch(/Alice Moreno, MD/);
    expect(before).toMatch(/Sam Bennett/);
    const approved = approve(s, providers[0].id, T1);
    const after = providerProps(approved).map((p) => p.statement).join(" | ");
    expect(after).toBe(before);
    expect(after).toMatch(/Sam Bennett/);
    // Two values for one key: neither is established, both are shown, the reviewer picks.
    expect(providers.every((p) => p.criterion?.result !== "met")).toBe(true);
    expect(providers.some((p) => p.finding === "to_confirm")).toBe(true);
  });

  it("A05. (control) an approved message follows the contact language: Spanish asked for after the approval reopens it in Spanish", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = approveRequest(s, T1);
    const again = submission({ version: 2 });
    again.answers.contact_language = "es";
    s = applySubmission(s, again, draft(), T2);
    expect(s.request?.status).toBe("draft");
    expect(s.request?.language).toBe("es");
    expect(s.request?.text).toMatch(/^Hola Jordan:/);
    expect(s.request?.approvals[0]?.superseded).toBeDefined();
  });

  it("R3-A06. a fact asked of the family that the reviewer corrects (Thursday confirmed, do not ask) sends the approved message back to draft", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = addToRequest(s, "xcheck:days", T1);
    s = approveRequest(s, T1);
    s = correct(s, claimId(s, "days_that_work"), "The parent states that Tuesdays and Wednesdays work.", T2);
    expect(find(s, "xcheck:days")?.recheck).toBeDefined();
    s = correct(s, "xcheck:days", "Thursday confirmed by phone with the family: do not ask about days.", T3);
    expect(find(s, "xcheck:days")?.recheck).toBeUndefined();
    // The message still asks which days; what it asks about was corrected: it is a draft again, for review.
    expect(s.request?.status).toBe("draft");
    expect(s.request?.approvals[0]?.superseded).toBeDefined();
    const reopened = s.journal.filter((e) => e.action === "request_reopened").at(-1);
    expect(reopened?.detail).toMatch(/fact/i);
  });
});

describe("R3-B. words that are present still become agreements or criteria that are not established", () => {
  it("R3-B01. \"We cannot do the sessions after 3 pm\" with earliestHour 15 is not in agreement with a form that says after 3 pm: the sources disagree", () => {
    const raw = spoken("We cannot do the sessions after 3 pm.");
    const d = recordingDraft(raw, [claim({ key: "time_window", label: "Time window", quote: "We cannot do the sessions after 3 pm", earliestHour: 15 })]);
    const s = buildReview(submission(), d, NOW);
    expect(s.submission.answers.preferred_time).toBe("after_3pm");
    const cross = find(s, "xcheck:time")!;
    expect(cross).toBeDefined();
    expect(cross.finding).toBe("conflicting");
    expect(cross.criterion?.result).not.toBe("met");
    expect(cross.requestable).toBe("confirm");
    const time = s.propositions.find((p) => p.id.includes(":time_window:"));
    expect(time?.finding ?? "absent").not.toBe("present");
  });

  it("R3-B02. \"after 3:30 pm\" with earliestHour 15 is not 15:00: the minutes are never flattened, and nothing agrees", () => {
    const raw = spoken("We can do sessions after 3:30 pm.");
    const d = recordingDraft(raw, [claim({ key: "time_window", label: "Time window", quote: "after 3:30 pm", earliestHour: 15 })]);
    const kept = d.recordings[0].claims.find((c) => c.key === "time_window");
    expect(kept?.earliestHour ?? null).toBeNull();
    const s = buildReview(submission(), d, NOW);
    const cross = find(s, "xcheck:time");
    expect(cross?.finding ?? "absent").not.toBe("consistent");
    expect(cross?.criterion?.result ?? "absent").not.toBe("met");
    expect(cross?.finding ?? "absent").toBe("to_confirm");
  });

  it("R3-B03. \"We cannot\" / \"do the sessions at home.\" across two segments, quoting the second, is not in agreement with a form that says home", () => {
    const raw = spoken("We cannot", "do the sessions at home.");
    const d = recordingDraft(raw, [claim({ key: "location_preference", label: "Location preference", quote: "do the sessions at home", location: "home" })]);
    const sub = submission();
    sub.answers.location = "home";
    const s = buildReview(sub, d, NOW);
    const cross = find(s, "xcheck:location");
    expect(cross?.finding ?? "absent").not.toBe("consistent");
    expect(cross?.criterion?.result ?? "absent").not.toBe("met");
    expect(cross?.finding ?? "absent").toBe("to_confirm");
  });

  it("R3-B04. \"cannot do sessions on Tuesdays, Thursdays or Fridays\", quoting \"Thursdays or Fridays\" as days that work, does not make Thursday agree with the form", () => {
    const raw = spoken("We cannot do sessions on Tuesdays, Thursdays or Fridays.");
    const d = recordingDraft(raw, [claim({ key: "days_that_work", label: "Days that work", quote: "Thursdays or Fridays", days: ["thursday"] })]);
    const sub = submission();
    sub.answers.preferred_days = ["thursday"];
    const s = buildReview(sub, d, NOW);
    const cross = find(s, "xcheck:days");
    expect(cross?.finding ?? "absent").not.toBe("consistent");
    expect(cross?.criterion?.result ?? "absent").not.toBe("met");
    if (cross) expect(cross.statement).not.toMatch(/agree/);
  });

  it("R3-B05. on the recorded transcript, quoting \"Sam has swimming on Thursdays\" as Thursday available does not agree with a form that lists Thursday only", () => {
    const d = recordingDraft(HAND_TRANSCRIPT, [claim({ key: "days_that_work", label: "Days that work", quote: "Sam has swimming on Thursdays", days: ["thursday"] })]);
    const sub = submission();
    sub.answers.preferred_days = ["thursday"];
    const s = buildReview(sub, d, NOW);
    const cross = find(s, "xcheck:days");
    expect(cross?.finding ?? "absent").not.toBe("consistent");
    expect(cross?.criterion?.result ?? "absent").not.toBe("met");
    if (cross) expect(cross.statement).not.toMatch(/agree/);
  });

  it("R3-B06. a name the model reads as uncertain is to confirm with a criterion that is not met: the audio convention applies to documents too", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields[0].uncertain = "the surname may read Bennet or Bennett";
    const d = verifyDraft(raw, sourcesFor(), meta);
    const s = buildReview(submission(), d, NOW);
    const name = find(s, "field:referral-letter:patient_name")!;
    expect(name.finding).toBe("to_confirm");
    expect(name.criterion?.result).not.toBe("met");
    expect(name.criterion?.result).toBe("not_assessable");
    expect(name.criterion?.note).toMatch(/Uncertain/);
  });

  it("R3-B07. the patient's name given as the referring provider, quoting \"Patient: Sam Bennett\", does not meet \"names a referring provider\"", () => {
    const raw = structuredClone(RAW_DRAFT);
    const provider = raw.documents[0].fields.find((f) => f.key === "referring_provider")!;
    provider.value = "Sam Bennett";
    provider.quote = "Patient: Sam Bennett";
    const d = verifyDraft(raw, sourcesFor(), meta);
    expect(d.withheld).toEqual([]);
    const s = buildReview(submission(), d, NOW);
    const p = find(s, "field:referral-letter:referring_provider")!;
    expect(p.statement).toBe("Sam Bennett");
    expect(p.criterion?.result).not.toBe("met");
    expect(p.criterion?.result).toBe("not_assessable");
  });

  it("R3-B08. a second time statement with no hour (the Thursday timing is undecided) keeps the time cross-check from being an agreement", () => {
    const raw = spoken("Tuesdays work best for us, any time after 3 pm.", "On Thursdays the timing is still undecided.");
    const d = recordingDraft(raw, [
      claim({ key: "time_window", label: "Time window", quote: "any time after 3 pm", earliestHour: 15 }),
      claim({ key: "time_window", label: "Time window", quote: "the timing is still undecided", earliestHour: null, statement: "The parent states that the Thursday timing is still undecided." }),
    ]);
    expect(d.recordings[0].claims.filter((c) => c.key === "time_window")).toHaveLength(2);
    const s = buildReview(submission(), d, NOW);
    const cross = find(s, "xcheck:time")!;
    expect(cross.finding).not.toBe("consistent");
    expect(cross.finding).toBe("to_confirm");
    expect(cross.criterion?.result).not.toBe("met");
  });

  it("R3-B09. a statement replaced by another wording in a new draft flags the cross-check that rests on it, as a direct correction does", () => {
    const sub = submission();
    sub.answers.preferred_days = ["tuesday"];
    let s = buildReview(sub, draft(), NOW);
    s = approve(s, "xcheck:days", T1);
    expect(find(s, "xcheck:days")?.state).toBe("approved");
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[0].statement = "The parent states that Tuesdays are the best day, after 3 pm.";
    s = replaceDraft(s, draft(raw, undefined, "live"), T2);
    const days = s.propositions.find((p) => p.id.includes(":days_that_work:"))!;
    expect(days.state).toBe("proposed");
    const cross = find(s, "xcheck:days")!;
    expect(cross.recheck).toBeDefined();
    expect(isReviewed(cross, s.request)).toBe(false);
  });
});

describe("R3-R. true positives the third pass rejected, and the origin of a run without a recording", () => {
  it("R3-R01. \"Tuesdays work, but Thursdays don't.\" quoted in full, Tuesday available, is kept: the same words on both sides", () => {
    const raw = spoken("Tuesdays work, but Thursdays don't.");
    const d = recordingDraft(raw, [claim({ key: "days_that_work", label: "Days that work", quote: "Tuesdays work, but Thursdays don't.", days: ["tuesday"] })]);
    expect(d.withheld).toEqual([]);
    const kept = d.recordings[0].claims.find((c) => c.key === "days_that_work");
    expect(kept?.days).toEqual(["tuesday"]);
  });

  it("R3-R02. \"Los martes sí, pero los jueves no.\" quoted in full, Tuesday available, is kept", () => {
    const raw = spoken("Los martes sí, pero los jueves no.");
    const d = recordingDraft(raw, [claim({ key: "days_that_work", label: "Days that work", quote: "Los martes sí, pero los jueves no.", days: ["tuesday"] })]);
    expect(d.withheld).toEqual([]);
    const kept = d.recordings[0].claims.find((c) => c.key === "days_that_work");
    expect(kept?.days).toEqual(["tuesday"]);
  });

  it("R3-R03. \"después de las tres de la tarde\" keeps the hour 15: \"las\" is an article, not a relation", () => {
    const raw = spoken("Podemos empezar después de las tres de la tarde.");
    const d = recordingDraft(raw, [claim({ key: "time_window", label: "Time window", quote: "después de las tres de la tarde", earliestHour: 15 })]);
    expect(d.withheld).toEqual([]);
    const kept = d.recordings[0].claims.find((c) => c.key === "time_window");
    expect(kept?.earliestHour).toBe(15);
    expect(kept?.unresolved).toBeNull();
  });

  it("R3-R04. \"Any time after three\" / \"pm works.\" split across two segments keeps the hour 15: a segment is not a clause", () => {
    const raw = spoken("Any time after three", "pm works.");
    const d = recordingDraft(raw, [claim({ key: "time_window", label: "Time window", quote: "after three pm", earliestHour: 15 })]);
    expect(d.withheld).toEqual([]);
    const kept = d.recordings[0].claims.find((c) => c.key === "time_window");
    expect(kept?.earliestHour).toBe(15);
    expect(kept?.unresolved).toBeNull();
  });

  it("R3-R05. \"No problem with Tuesdays\" is not a negation of Tuesday", () => {
    const raw = spoken("No problem with Tuesdays.");
    const works = recordingDraft(raw, [claim({ key: "days_that_work", label: "Days that work", quote: "No problem with Tuesdays", days: ["tuesday"] })]);
    expect(works.withheld).toEqual([]);
    expect(works.recordings[0].claims.find((c) => c.key === "days_that_work")?.days).toEqual(["tuesday"]);
    const negative = recordingDraft(raw, [claim({ key: "days_that_do_not_work", label: "Days that do not work", quote: "No problem with Tuesdays", days: ["tuesday"] })]);
    expect(negative.withheld).toEqual([expect.objectContaining({ key: "days_that_do_not_work", reason: "negation_mismatch" })]);
  });

  it("R3-R06. a file with no recording ran one extraction and no transcription, and the origin line says so", async () => {
    resetLimits();
    resetTranscriptCache();
    const deps = {
      transcribe: async () => {
        throw new Error("no recording: the transcription must not be called");
      },
      extract: async () => ({
        raw: { documents: RAW_DRAFT.documents.filter((doc) => doc.mediaId === "referral-letter"), recordings: [] },
        usage: { model: "test", inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0 },
      }),
    };
    const { draft: d, usage } = await computeDraft(["referral-letter"], "live", deps);
    expect(usage.transcription).toBeNull();
    expect(usage.extraction).not.toBeNull();
    expect(d.recordings).toHaveLength(0);
    const line = draftOriginLabel(d);
    expect(line).not.toMatch(/two model calls/);
    expect(line).toMatch(/extraction/);
    expect(line).toMatch(/no recording|not called|no transcription/i);
    const state = replaceDraft(buildReview(submission(), draft(), NOW), d, T1);
    const replaced = state.journal.find((e) => e.action === "draft_replaced")!;
    expect(replaced.detail).not.toMatch(/both called/);
    resetLimits();
    resetTranscriptCache();
  });
});

describe("P. positive controls of the third round: what already held, and must keep holding", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("P01. a free statement (other) is listed for the reviewer with its quoted words, never assessed, in a replaced draft too", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims.push({
      key: "other",
      label: "Scheduling note",
      statement: "The parent states that Sam has swimming on Thursdays.",
      nature: "extraction",
      quote: "Sam has swimming on Thursdays",
      days: [],
      earliestHour: null,
      location: null,
      uncertain: null,
    });
    const d = verifyDraft(raw, sourcesFor(), { origin: "live", computedAt: T1 });
    expect(d.withheld).toEqual([expect.objectContaining({ key: "other", reason: "free_statement" })]);
    const s = replaceDraft(buildReview(submission(), draft(), NOW), d, T1);
    const listed = s.propositions.find((p) => p.finding === "withheld" && p.label === "Scheduling note")!;
    expect(listed).toBeDefined();
    expect(listed.statement).toMatch(/Sam has swimming on Thursdays/);
    expect(listed.criterion?.result).toBe("not_assessable");
    expect(isReviewed(listed, s.request)).toBe(false);
    expect(s.journal.find((e) => e.action === "draft_replaced")?.detail).toMatch(/1 withheld/);
  });

  it("P02. a document the draft names wrongly (referral-leter) is listed with no invented source, and the real letter is not shown as read", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].mediaId = "referral-leter";
    const d = verifyDraft(raw, sourcesFor(), meta);
    const s = buildReview(submission(), d, NOW);
    const listed = find(s, "withheld:referral-leter:*")!;
    expect(listed).toBeDefined();
    expect(listed.group).toBe("documents");
    expect(listed.evidence).toEqual([]);
    expect(listed.criterion?.note).toMatch(/does not hold/);
    expect(find(s, "doc:referral_letter")?.finding).toBe("to_confirm");
    expect(find(s, "doc:referral_letter")?.statement).toMatch(/0 fields/);
  });

  it("P03. switching the screen language leaves the contact language answer alone", () => {
    const form = sampleIntakeDraft();
    form.answers.contact_language = "es";
    const switched = switchDraftLanguage(form, "en");
    expect(switched.lang).toBe("en");
    expect(switched.answers.contact_language).toBe("es");
  });

  it("P04. submittedAt is part of the content fingerprint", () => {
    const s = buildReview(submission(), draft(), NOW);
    const moved = { ...s, submission: { ...s.submission, submittedAt: "2027-10-01T00:00:00.000Z" } };
    expect(contentFingerprint(moved)).not.toBe(contentFingerprint(s));
  });

  it("P05. corrected then approved: the file approval does not survive with a stale fingerprint", () => {
    let s = reviewed(buildReview(submission(), draft(), NOW));
    s = approveFile(s, s.version, T2);
    expect(find(s, "xcheck:days")?.state).toBe("corrected");
    s = approve(s, "xcheck:days", T3);
    expect(find(s, "xcheck:days")?.state).toBe("approved");
    expect(!s.approval || s.approval.hash === contentFingerprint(s)).toBe(true);
  });

  it("P06. a signature date that changes at the same submission version is applied, journaled, and ends the file approval", () => {
    let s = reviewed(buildReview(submission(), draft(), NOW));
    s = approveFile(s, s.version, T2);
    const again = submission();
    again.signature = { name: SAMPLE_SUBMISSION.signature!.name, signedAt: "2026-09-20T16:00:00.000Z" };
    const next = applySubmission(s, again, draft(), T3);
    expect(next.submission.signature?.signedAt).toBe("2026-09-20T16:00:00.000Z");
    expect(next.journal.some((e) => e.action === "submission_updated")).toBe(true);
    expect(next.approval).toBeUndefined();
  });

  it("P07. a live result computed for a build that was reset since is not applied", () => {
    const before = loadReview(NOW);
    const expected = { reference: before.submission.reference, media: mediaForLiveRun(before.submission), builtAt: before.builtAt };
    const after = resetToSample(T1);
    const result = applyLiveRun(after, expected, draft(RAW_DRAFT, undefined, "live"), T2);
    expect(result.applied).toBe(false);
    expect(result.state).toBe(after);
  });

  it("P08. a received document the run returned nothing for is to confirm, with zero fields and the criterion not met", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents = raw.documents.filter((doc) => doc.mediaId !== "referral-letter");
    const d = verifyDraft(raw, sourcesFor(), meta);
    const s = buildReview(submission(), d, NOW);
    const letter = find(s, "doc:referral_letter")!;
    expect(letter.finding).toBe("to_confirm");
    expect(letter.criterion?.result).toBe("not_met");
    expect(letter.statement).toMatch(/0 fields/);
  });

  it("P09. the recorded review keeps its shape: seven letter fields, the license line, the recorded statements, the three cross-checks with days in disagreement", () => {
    const s = buildReview(SAMPLE_SUBMISSION, RECORDED_DRAFT, NOW);
    const letterFields = s.propositions.filter((p) => p.group === "referral_letter" && p.nature === "extraction");
    expect(letterFields).toHaveLength(7);
    expect(s.propositions.filter((p) => p.id.endsWith(":license"))).toHaveLength(1);
    const claims = s.propositions.filter((p) => p.id.startsWith("claim:"));
    expect(claims.length).toBe(RECORDED_DRAFT.recordings[0].claims.length);
    expect(claims.length).toBeGreaterThanOrEqual(4);
    const listed = s.propositions.filter((p) => p.finding === "withheld");
    expect(listed.length).toBe(RECORDED_DRAFT.withheld.length);
    expect(s.propositions.length).toBe(2 + 7 + 1 + claims.length + listed.length + 3);
    expect(find(s, "xcheck:days")?.finding).toBe("conflicting");
    expect(find(s, "xcheck:time")?.finding).toBe("to_confirm");
    expect(find(s, "xcheck:location")).toBeDefined();
    // The provider on the letter carries its credential on the line: that criterion holds.
    expect(find(s, "field:referral-letter:referring_provider")?.criterion?.result).toBe("met");
    expect(s.stage).toBe("waiting_for_review");
  });

  it("P10. the recorded review can be worked through to Waiting on family while the card is still requested", () => {
    let s = reviewed(buildReview(SAMPLE_SUBMISSION, RECORDED_DRAFT, NOW));
    expect(canApproveFile(s).ok).toBe(true);
    s = approveFile(s, s.version, T2);
    expect(s.stage).toBe("waiting_on_family");
    expect(s.request?.items.some((i) => !i.satisfiedAt)).toBe(true);
  });

  it("P11. in the recorded review, \"3:00\" without AM or PM gives no hour to compare, and the time cross-check is to confirm", () => {
    const s = buildReview(SAMPLE_SUBMISSION, RECORDED_DRAFT, NOW);
    const time = s.propositions.find((p) => p.id.includes(":time_window:"))!;
    expect(time.finding).toBe("to_confirm");
    expect(RECORDED_DRAFT.recordings[0].claims.find((c) => c.key === "time_window")?.earliestHour ?? null).toBeNull();
    const cross = find(s, "xcheck:time")!;
    expect(cross.finding).toBe("to_confirm");
    expect(cross.criterion?.result).not.toBe("met");
    expect(cross.statement).toMatch(/To confirm/);
  });

  it("P12. Casey and Alex: a corrected, approved message is a draft again for the new recipient and the new child", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = editRequest(s, s.request!.text.replace("Hi Jordan,", "Hi Jordan, thank you for your patience."), T1);
    s = approveRequest(s, T1);
    const again = submission({ version: 2 });
    again.answers.child_first_name = "Alex";
    again.answers.guardian_name = "Casey Bennett";
    s = applySubmission(s, again, draft(), T2);
    expect(s.request?.status).toBe("draft");
    expect(s.request?.text).toMatch(/^Hi Casey,/);
    expect(s.request?.text).toMatch(/Alex's intake form/);
    expect(isReviewed(find(s, "doc:insurance_card")!, s.request)).toBe(false);
  });

  it("P13. a card asked for as missing and received unreadable is another request: same id, new kind, draft again", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = approveRequest(s, T1);
    s = receiveDocument(s, "insurance_card", "insurance-card", { mediaId: "insurance-card", readable: false, unreadableReason: "the photo is blurred", fields: [] }, T2);
    const item = s.request?.items.find((i) => i.propositionId === "doc:insurance_card");
    expect(item?.kind).toBe("unreadable_item");
    expect(item?.satisfiedAt).toBeUndefined();
    expect(s.request?.status).toBe("draft");
    expect(s.request?.text).toMatch(/not readable/);
  });

  it("P14. a days cross-check built on two statements (Tuesday, Friday) depends on both and is flagged when the Friday one is corrected", () => {
    const raw = spoken("Tuesdays work best for us.", "Fridays are fine too.", "Not Thursdays.");
    const d = recordingDraft(raw, [
      claim({ key: "days_that_work", label: "Days that work", quote: "Tuesdays work best for us", days: ["tuesday"], statement: "The parent states that Tuesdays work best." }),
      claim({ key: "days_that_work", label: "Days that work", quote: "Fridays are fine too", days: ["friday"], statement: "The parent states that Fridays are fine too." }),
    ]);
    const sub = submission();
    sub.answers.preferred_days = ["tuesday", "friday"];
    let s = buildReview(sub, d, NOW);
    const days = find(s, "xcheck:days")!;
    expect(days.finding).not.toBe("conflicting");
    s = approve(s, "xcheck:days", T1);
    const friday = s.propositions.find((p) => p.id.includes(":days_that_work:") && p.statement.includes("Friday"))!;
    s = correct(s, friday.id, "The parent states that Fridays do not work.", T2);
    const after = find(s, "xcheck:days")!;
    expect(after.recheck).toBeDefined();
    expect(after.dependsOn).toContain(friday.id);
    expect(after.evidence.filter((e) => e.kind === "audio")).toHaveLength(2);
  });
});
