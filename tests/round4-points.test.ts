/**
 * The passing paths of the fifth pass: what the new rules must still let
 * through, and the points of the fourth verdict that had no scenario of the
 * reviewer's own (the notice after a live run, the wording of "Run again",
 * the merge of several blocks, a resolved item asked again only after a new
 * submission, the structural comparisons of hours and places, "Starting at
 * 5 pm"). Written with their code, not run red.
 */
import { describe, expect, it } from "vitest";
import { liveRunCalls, liveRunNotice, runAgainTitle } from "../src/lib/draft-origin";
import type { RawClaim, RawTranscript } from "../src/lib/engine/raw";
import { addToRequest, applySubmission, approveRequest, buildReview, receiveDocument, replaceDraft, resolveRequestItem } from "../src/lib/engine/review";
import type { Draft, ReviewState } from "../src/lib/engine/types";
import { Refused } from "../src/lib/engine/types";
import { transcriptFromRaw, verifyDraft } from "../src/lib/engine/verify";
import { DURATION_SECONDS, HAND_TRANSCRIPT, NOW, RAW_DRAFT, draft, source, submission } from "./helpers";

const T1 = "2026-09-20T15:01:00.000Z";
const T2 = "2026-09-20T15:02:00.000Z";
const T3 = "2026-09-20T15:03:00.000Z";
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

const sources = () => ({
  documents: [source("referral-letter"), source("insurance-card")],
  recordings: [{ mediaId: "recording-scheduling", transcript: transcriptFromRaw("recording-scheduling", HAND_TRANSCRIPT, DURATION_SECONDS), durationSeconds: DURATION_SECONDS }],
});

describe("the notice after a live run, and the wording of Run again, say what really runs", () => {
  it("one call without a recording, two calls with one, one call when the transcription was reused", () => {
    const live: Draft = { ...draft(RAW_DRAFT, undefined, "live"), computedAt: T1 };
    expect(liveRunCalls(live)).toMatch(/two model calls ran, the transcription and the extraction/);
    expect(liveRunCalls({ ...live, transcriptReused: true })).toMatch(/transcription was reused/);
    expect(liveRunCalls({ ...live, transcriptReused: true })).not.toMatch(/two model calls/);
    const alone: Draft = { ...live, recordings: [] };
    expect(liveRunCalls(alone)).toMatch(/one model call ran, the extraction/);
    expect(liveRunCalls(alone)).not.toMatch(/two|both/);
    expect(liveRunNotice(alone, 12)).toMatch(/^Live draft computed .*: one model call ran, the extraction; there was no recording, so no transcription was called\. 12 propositions, 0 withheld by the source check\.$/);
    expect(runAgainTitle(true)).toMatch(/transcription .* and the extraction/);
    expect(runAgainTitle(false)).toMatch(/extraction again .* no transcription/);
  });
});

describe("several blocks for one media are merged, none ignored, and the review says so", () => {
  it("a document returned twice: every field of both blocks is read, and one proposition names the merge", () => {
    const raw = structuredClone(RAW_DRAFT);
    const [letter] = raw.documents;
    raw.documents = [
      { ...letter, fields: letter.fields.slice(0, 3) },
      { ...letter, fields: letter.fields.slice(3) },
    ];
    const d = verifyDraft(raw, sources(), meta);
    expect(d.withheld).toEqual([]);
    expect(d.documents).toHaveLength(1);
    expect(d.documents[0].blocks).toBe(2);
    expect(d.documents[0].fields).toHaveLength(7);
    expect(d.documents[0].fields[0].checked.join(" ")).toMatch(/block 1 of 2/);
    expect(d.documents[0].fields[6].checked.join(" ")).toMatch(/block 2 of 2/);
    const s = buildReview(submission(), d, NOW);
    const merge = find(s, "blocks:referral-letter")!;
    expect(merge.finding).toBe("to_confirm");
    expect(merge.criterion?.id).toBe("conflicting_extraction");
    expect(merge.statement).toMatch(/2 blocks/);
    expect(s.propositions.filter((p) => p.group === "referral_letter" && p.nature === "extraction")).toHaveLength(7);
  });

  it("a recording returned twice: every statement of both blocks is listed, and one proposition names the merge", () => {
    const raw = structuredClone(RAW_DRAFT);
    const [days, negative, time, location] = raw.recordings[0].claims;
    raw.recordings = [
      { mediaId: "recording-scheduling", claims: [days, time] },
      { mediaId: "recording-scheduling", claims: [negative, location] },
    ];
    const d = verifyDraft(raw, sources(), meta);
    expect(d.withheld).toEqual([]);
    expect(d.recordings).toHaveLength(1);
    expect(d.recordings[0].blocks).toBe(2);
    expect(d.recordings[0].claims).toHaveLength(4);
    const s = buildReview(submission(), d, NOW);
    expect(find(s, "blocks:recording-scheduling")?.criterion?.id).toBe("conflicting_extraction");
    expect(s.propositions.filter((p) => p.id.startsWith("claim:"))).toHaveLength(4);
    expect(find(s, "xcheck:days")?.finding).toBe("conflicting");
    expect(find(s, "xcheck:location")).toBeDefined();
  });

  it("a document that one block calls unreadable and another reads is readable, with its fields", () => {
    const raw = structuredClone(RAW_DRAFT);
    const [letter] = raw.documents;
    raw.documents = [{ mediaId: "referral-letter", readable: false, unreadableReason: "too dark", fields: [] }, letter];
    const d = verifyDraft(raw, sources(), meta);
    expect(d.withheld).toEqual([]);
    expect(d.documents[0].readable).toBe(true);
    expect(d.documents[0].fields).toHaveLength(7);
  });
});

describe("a resolution by the reviewer survives a run and yields only to a new submission", () => {
  it("asked again after the family sends the form again, with the reason on the item and in the journal", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = approveRequest(s, T1);
    s = resolveRequestItem(s, "doc:insurance_card", "handled by phone", T2);
    // A run changes nothing: the card stays resolved (R4-B03).
    s = replaceDraft(s, draft(RAW_DRAFT, undefined, "live"), T2);
    expect(find(s, "doc:insurance_card")?.inRequest).toBe(false);
    // A new submission that still lacks the card asks for it again, and says why.
    const again = submission({ version: 2 });
    again.answers.phone = "(718) 555-0199";
    s = applySubmission(s, again, draft(), T3);
    const open = s.request?.items.filter((i) => i.propositionId === "doc:insurance_card" && !i.satisfiedAt) ?? [];
    expect(open).toHaveLength(1);
    expect(open[0].reopened?.because).toMatch(/submission changed/);
    expect(s.request?.items.some((i) => i.propositionId === "doc:insurance_card" && i.satisfiedBy === "reviewer")).toBe(true);
    expect(s.journal.some((e) => e.action === "request_updated" && /asked again/.test(e.detail))).toBe(true);
    expect(s.request?.status).toBe("draft");
    expect(s.request?.text).toMatch(/Insurance card, front and back/);
  });

  it("a request with nothing left to ask is not approved by reuse, and cannot be approved", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = approveRequest(s, T1);
    s = resolveRequestItem(s, "doc:insurance_card", "", T2);
    expect(s.request?.items.every((i) => i.satisfiedAt)).toBe(true);
    expect(s.request?.status).toBe("draft");
    expect(s.request?.approvals[0]?.superseded?.because).toMatch(/items changed/);
    expect(() => approveRequest(s, T3)).toThrow(Refused);
  });

  it("a card asked for as missing and received unreadable: the old question is received, a new one is open", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = approveRequest(s, T1);
    s = receiveDocument(s, "insurance_card", "insurance-card", { mediaId: "insurance-card", readable: false, unreadableReason: "the photo is blurred", fields: [] }, T2);
    const items = s.request?.items.filter((i) => i.propositionId === "doc:insurance_card") ?? [];
    expect(items.map((i) => [i.kind, i.satisfiedBy ?? "open"])).toEqual([
      ["unreadable_item", "open"],
      ["missing_item", "family"],
    ]);
    expect(s.request?.status).toBe("draft");
  });
});

describe("structured comparisons of hours and places: what disagrees, what is to confirm", () => {
  const time = (formTime: string, hour: number, words: string) => {
    const d = recordingDraft(spoken(`We can do sessions ${words}.`), [claim({ key: "time_window", label: "Time window", quote: words, earliestHour: hour })]);
    const sub = submission();
    sub.answers.preferred_time = formTime;
    return find(buildReview(sub, d, NOW), "xcheck:time")!;
  };

  it("an extracted hour past the end of the form's window disagrees, as extracted; noon against a morning form is to confirm; an earlier hour is to confirm", () => {
    expect(time("morning", 13, "from one pm").finding).toBe("conflicting");
    expect(time("morning", 13, "from one pm").statement).toMatch(/^As extracted from the recording \("from one pm"\), the earliest hour is 1:00 pm, past the end of the form's window\. The form says morning\. To confirm which time of day\.$/);
    expect(time("morning", 12, "from noon").finding).toBe("to_confirm");
    expect(time("after_3pm", 8, "from eight am").finding).toBe("to_confirm");
    expect(time("early_afternoon", 15, "from three pm").finding).toBe("to_confirm");
    expect(time("evening", 15, "from three pm").finding).toBe("to_confirm");
  });

  it("\"Starting at 5 pm\" keeps its extracted hour, shown as extracted, to confirm against an evening form, with no reason about the words", () => {
    const d = recordingDraft(spoken("Starting at 5 pm works for us."), [claim({ key: "time_window", label: "Time window", quote: "Starting at 5 pm", earliestHour: 17 })]);
    expect(d.withheld).toEqual([]);
    const kept = d.recordings[0].claims[0];
    expect(kept.earliestHour).toBe(17);
    expect(kept.checked.join(" ")).toMatch(/17:00 as extracted by the model/);
    expect(kept.checked.join(" ")).not.toMatch(/from when|without saying/);
    const sub = submission();
    sub.answers.preferred_time = "evening";
    const cross = find(buildReview(sub, d, NOW), "xcheck:time")!;
    expect(cross.finding).toBe("to_confirm");
    expect(cross.statement).toBe('As extracted from the recording ("Starting at 5 pm"), the earliest hour is 5:00 pm. The form says evening. To confirm.');
  });

  it("the other place than the one the form names disagrees, as extracted; either on either side is to confirm", () => {
    const placeCheck = (formPlace: string, extracted: "home" | "center" | "either", words: string) => {
      const d = recordingDraft(spoken(`We would rather do the sessions ${words}.`), [claim({ key: "location_preference", label: "Location preference", quote: words, location: extracted })]);
      const sub = submission();
      sub.answers.location = formPlace;
      return find(buildReview(sub, d, NOW), "xcheck:location")!;
    };
    expect(placeCheck("home", "center", "at the center").finding).toBe("conflicting");
    expect(placeCheck("home", "center", "at the center").statement).toMatch(/^As extracted from the recording \("at the center"\), the place is sessions at the center\. The form says sessions at home\. To confirm which place\.$/);
    expect(placeCheck("either", "center", "at the center").finding).toBe("to_confirm");
    expect(placeCheck("center", "either", "anywhere").finding).toBe("to_confirm");
    expect(placeCheck("center", "center", "at the center").finding).toBe("to_confirm");
  });

  it("an uncertain extraction never disagrees: the doubt is noted and the cross-check is to confirm", () => {
    const d = recordingDraft(HAND_TRANSCRIPT, [claim({ key: "days_that_do_not_work", label: "Days that do not work", quote: "Not Thursdays", days: ["thursday"], uncertain: "the day is hard to hear" })]);
    const sub = submission();
    sub.answers.preferred_days = ["thursday"];
    const cross = find(buildReview(sub, d, NOW), "xcheck:days")!;
    expect(cross.finding).toBe("to_confirm");
    expect(cross.criterion?.note).toMatch(/hard to hear/);
  });

  it("the question to the family follows the current form: after a Friday form, it cites Friday and what was extracted, as we read it", () => {
    let s = buildReview(submission(), draft(), NOW);
    s = addToRequest(s, "xcheck:days", T1);
    const again = submission({ version: 2 });
    again.answers.preferred_days = ["friday"];
    s = applySubmission(s, again, draft(), T2);
    expect(s.request?.text).toMatch(/your form lists Friday; your recorded answer, as we read it, mentions Tuesday and says Thursday does not work: which days should we plan on\?/);
  });
});
