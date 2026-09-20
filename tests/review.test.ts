import { describe, expect, it } from "vitest";
import {
  addToRequest,
  approve,
  approveFile,
  approveRequest,
  buildReview,
  canApproveFile,
  correct,
  documentCount,
  focalProposition,
  receiveDocument,
  replaceDraft,
} from "../src/lib/engine/review";
import { Refused, type ReviewState } from "../src/lib/engine/types";
import { NOW, RAW_DRAFT, draft, submission } from "./helpers";

const T1 = "2026-09-20T15:01:00.000Z";
const T2 = "2026-09-20T15:02:00.000Z";
const T3 = "2026-09-20T15:03:00.000Z";
const T4 = "2026-09-20T15:04:00.000Z";

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

describe("rule 1: a missing required item prepares a request, and sends nothing", () => {
  it("finds the one missing item of the sample and drafts the request", () => {
    const state = buildReview(submission(), draft(), NOW);
    expect(documentCount(state)).toEqual({ received: 1, requested: 2 });
    const focal = focalProposition(state)!;
    expect(focal.id).toBe("doc:insurance_card");
    expect(focal.finding).toBe("missing");
    expect(focal.inRequest).toBe(true);
    expect(state.request?.status).toBe("draft");
    expect(state.request?.items).toEqual([{ propositionId: "doc:insurance_card", kind: "missing_item" }]);
    expect(state.request?.text).toContain("Hi Jordan,");
    expect(state.request?.text).toContain("Insurance card, front and back");
    expect(state.request?.text).toContain("SB-2041");
    expect(state.journal.map((e) => e.action)).toContain("request_prepared");
    expect(state.journal.find((e) => e.action === "request_prepared")?.detail).toMatch(/Not sent/);
  });

  it("writes the request in Spanish when the parent used Spanish", () => {
    const state = buildReview(submission({ language: "es" }), draft(), NOW);
    expect(state.request?.language).toBe("es");
    expect(state.request?.text).toContain("Hola Jordan:");
    expect(state.request?.text).toContain("Tarjeta del seguro, frente y reverso");
  });

  it("treats a document that is not readable as an item to ask for again, not as received", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0] = { mediaId: "referral-letter", readable: false, unreadableReason: "the scan is too dark to read", fields: [] };
    const state = buildReview(submission(), draft(raw), NOW);
    const letter = state.propositions.find((p) => p.id === "doc:referral_letter")!;
    expect(letter.finding).toBe("unreadable");
    expect(letter.inRequest).toBe(true);
    expect(state.request?.items.map((i) => i.kind)).toEqual(["unreadable_item", "missing_item"]);
    expect(state.request?.text).toMatch(/not readable/);
    expect(state.propositions.some((p) => p.group === "referral_letter")).toBe(false);
  });

  it("approving the request marks it approved and still sends nothing", () => {
    let state = buildReview(submission(), draft(), NOW);
    state = approveRequest(state, T1);
    expect(state.request?.status).toBe("approved");
    expect(state.request?.approvedText).toBe(state.request?.text);
    expect(state.journal.at(-1)?.detail).toMatch(/Not sent/);
    const again = approveRequest(state, T2);
    expect(again.journal.at(-1)?.action).toBe("approval_repeated");
  });
});

describe("rule 2: disagreeing sources and uncertain extractions wait for a reviewer", () => {
  it("flags Tuesdays-not-Thursdays against a form that lists Thursday, and chooses nothing", () => {
    const state = buildReview(submission(), draft(), NOW);
    const days = state.propositions.find((p) => p.id === "xcheck:days")!;
    expect(days.finding).toBe("conflicting");
    expect(days.statement).toMatch(/No day has been chosen/);
    expect(days.statement).toMatch(/Tuesday and Thursday/);
    expect(days.statement).toMatch(/Thursday does not work/);
    expect(days.criterion?.result).toBe("not_met");
    expect(days.evidence.map((e) => e.kind)).toEqual(["form", "audio", "audio"]);
    expect(state.stage).toBe("waiting_for_review");
    expect(state.journal.find((e) => e.action === "stage_changed")?.detail).toMatch(/Rule 2/);
  });

  it("finds the sources consistent when the form lists Tuesday only", () => {
    const s = submission();
    s.answers.preferred_days = ["tuesday"];
    const state = buildReview(s, draft(), NOW);
    const days = state.propositions.find((p) => p.id === "xcheck:days")!;
    expect(days.finding).toBe("consistent");
    expect(state.stage).toBe("in_review");
  });

  it("keeps a negative answer, a missing recording and an unusable recording apart", () => {
    const withNegative = buildReview(submission(), draft(), NOW);
    const negative = withNegative.propositions.find((p) => p.id.includes("days_that_do_not_work"))!;
    expect(negative.finding).toBe("negative");
    expect(negative.statement).toMatch(/Thursdays do not work/);

    const missing = submission();
    missing.recordings.scheduling_prompt = { status: "missing" };
    const withMissing = buildReview(missing, draft(), NOW);
    expect(withMissing.propositions.find((p) => p.id === "rec:scheduling_prompt")?.finding).toBe("missing");
    expect(withMissing.propositions.some((p) => p.id === "xcheck:days")).toBe(false);

    const truncated = draft(RAW_DRAFT, { segments: [{ start: 0, end: 1.5, text: "Tuesdays work best for" }], complete: false, note: "The audio stops after 1.5 seconds." });
    const withUnusable = buildReview(submission(), truncated, NOW);
    const unusable = withUnusable.propositions.find((p) => p.id === "rec:scheduling_prompt:unusable")!;
    expect(unusable.finding).toBe("unusable_audio");
    expect(unusable.inRequest).toBe(true);
    expect(withUnusable.propositions.some((p) => p.group === "recording" && p.finding === "present")).toBe(false);
    expect(withUnusable.stage).toBe("waiting_for_review");
  });

  it("an uncertain extraction is a thing to confirm, not a value", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields[3].uncertain = "the day could be 26 or 28";
    const state = buildReview(submission(), draft(raw), NOW);
    const date = state.propositions.find((p) => p.id === "field:referral-letter:referral_date")!;
    expect(date.finding).toBe("to_confirm");
    expect(date.criterion?.note).toMatch(/Uncertain/);
  });

  it("a name that differs between the letter and the form is a disagreement", () => {
    const s = submission();
    s.answers.child_first_name = "Samuel";
    const state = buildReview(s, draft(), NOW);
    const name = state.propositions.find((p) => p.id === "field:referral-letter:patient_name")!;
    expect(name.finding).toBe("conflicting");
    expect(name.criterion?.result).toBe("not_met");
    expect(name.criterion?.note).toContain("Samuel Bennett");
  });

  it("offers not assessable where the document cannot answer", () => {
    const state = buildReview(submission(), draft(), NOW);
    const license = state.propositions.find((p) => p.id.endsWith(":license"))!;
    expect(license.criterion?.result).toBe("not_assessable");
  });

  it("dates the referral and applies the twelve-month rule in words", () => {
    const state = buildReview(submission(), draft(), NOW);
    const date = state.propositions.find((p) => p.id === "field:referral-letter:referral_date")!;
    expect(date.criterion?.result).toBe("met");
    expect(date.criterion?.note).toBe("23 days before the submission.");
    const old = submission({ submittedAt: "2027-10-01T00:00:00.000Z" });
    const late = buildReview(old, draft(), NOW);
    expect(late.propositions.find((p) => p.id === "field:referral-letter:referral_date")?.criterion?.result).toBe("not_met");
  });

  it("puts a conflict into the request when the reviewer asks the family", () => {
    let state = buildReview(submission(), draft(), NOW);
    state = addToRequest(state, "xcheck:days", T1);
    expect(state.request?.items.map((i) => i.kind)).toEqual(["missing_item", "confirm"]);
    expect(state.request?.text).toMatch(/your form lists Tuesday and Thursday, and your recorded answer says Thursday does not work/);
    const es = addToRequest(buildReview(submission({ language: "es" }), draft(), NOW), "xcheck:days", T1);
    expect(es.request?.text).toMatch(/su formulario indica martes y jueves, y en su respuesta grabada dice que no puede los jueves/);
  });
});

describe("reviewer actions on a proposition", () => {
  it("a correction keeps the old value and its author, and flags what rests on it", () => {
    let state = buildReview(submission(), draft(), NOW);
    const id = state.propositions.find((p) => p.id.includes("days_that_work"))!.id;
    state = correct(state, id, "The parent states that Tuesdays work best, after 4 pm.", T1);
    const p = state.propositions.find((x) => x.id === id)!;
    expect(p.state).toBe("corrected");
    expect(p.history.map((h) => h.by)).toEqual(["ai", "reviewer"]);
    expect(p.history[0].statement).toMatch(/after 3 pm/);
    expect(p.criterion?.result).toBe("recheck");
    expect(state.version).toBe(2);
    const days = state.propositions.find((x) => x.id === "xcheck:days")!;
    expect(days.recheck?.because).toMatch(/was corrected/);
    const entry = state.journal.find((e) => e.action === "corrected")!;
    expect(entry.from).toMatch(/after 3 pm/);
    expect(entry.to).toMatch(/after 4 pm/);
  });

  it("approving twice changes nothing the second time", () => {
    let state = buildReview(submission(), draft(), NOW);
    const id = "field:referral-letter:patient_name";
    state = approve(state, id, T1);
    const once = state.propositions.find((p) => p.id === id)!;
    state = approve(state, id, T2);
    const twice = state.propositions.find((p) => p.id === id)!;
    expect(twice).toEqual(once);
    expect(state.journal.at(-1)?.action).toBe("approval_repeated");
  });

  it("a correction of an approved proposition ends its approval and shows both versions", () => {
    let state = buildReview(submission(), draft(), NOW);
    const id = "field:referral-letter:referring_provider";
    state = approve(state, id, T1);
    state = correct(state, id, "Alice Moreno, MD (Pediatrics)", T2);
    const p = state.propositions.find((x) => x.id === id)!;
    expect(p.state).toBe("corrected");
    expect(p.approvedAt).toBeUndefined();
    expect(p.history).toHaveLength(2);
    expect(state.propositions.find((x) => x.id === `${id}:license`)?.recheck).toBeDefined();
  });

  it("refuses to add to the request what is not requestable", () => {
    const state = buildReview(submission(), draft(), NOW);
    expect(() => addToRequest(state, "field:referral-letter:patient_name", T1)).toThrow(Refused);
  });
});

describe("rule 3: approving the current version, and what ends it", () => {
  it("refuses the file while propositions are unreviewed, and says why", () => {
    const state = buildReview(submission(), draft(), NOW);
    const check = canApproveFile(state);
    expect(check.ok).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/not reviewed yet/);
    expect(check.reasons.join(" ")).toMatch(/still a draft/);
    expect(() => approveFile(state, state.version, T1)).toThrow(Refused);
  });

  it("moves the file to waiting on family once everything is reviewed and the request is approved", () => {
    let state = reviewed(buildReview(submission(), draft(), NOW));
    expect(canApproveFile(state).ok).toBe(true);
    state = approveFile(state, state.version, T2);
    expect(state.approval?.version).toBe(state.version);
    expect(state.approval?.snapshot.length).toBe(state.propositions.length);
    expect(state.stage).toBe("waiting_on_family");
    const entry = state.journal.find((e) => e.action === "file_approved")!;
    expect(entry.detail).toMatch(/Rule 3/);
  });

  it("binds the approval to the version, so A then B then A cannot reuse the first approval", () => {
    let state = reviewed(buildReview(submission(), draft(), NOW));
    state = approveFile(state, state.version, T1);
    const approvedVersion = state.version;
    const id = "field:referral-letter:patient_name";
    const original = state.propositions.find((p) => p.id === id)!.statement;
    state = correct(state, id, "Sam R. Bennett", T2);
    expect(state.approval).toBeUndefined();
    expect(state.approvalHistory[0].detached?.because).toMatch(/corrected after the file was approved/);
    state = correct(state, id, original, T3);
    expect(state.version).toBe(approvedVersion + 2);
    expect(() => approveFile(state, approvedVersion, T4)).toThrow(/changed since it was displayed/);
    expect(state.journal.some((e) => e.action === "approval_detached")).toBe(true);
    // The version that was approved stays readable in the history, with its content.
    expect(state.approvalHistory[0].snapshot.find((s) => s.id === id)?.statement).toBe(original);
  });

  it("refuses an approval that names a version other than the current one", () => {
    const state = reviewed(buildReview(submission(), draft(), NOW));
    expect(() => approveFile(state, state.version + 1, T1)).toThrow(/changed since it was displayed/);
    expect(() => approveFile(state, state.version - 1, T1)).toThrow(Refused);
  });

  it("a new document detaches the approval, satisfies the request item and adds propositions to review", () => {
    let state = reviewed(buildReview(submission(), draft(), NOW));
    state = approveFile(state, state.version, T1);
    const before = state.propositions.length;
    const card = draft().documents.find((d) => d.mediaId === "insurance-card")!;
    state = receiveDocument(state, "insurance_card", "insurance-card", card, T2);
    expect(state.approval).toBeUndefined();
    expect(state.approvalHistory.at(-1)?.detached?.because).toMatch(/received after the file was approved/);
    expect(state.submission.documents.insurance_card.status).toBe("received");
    expect(state.request?.items[0].satisfiedAt).toBe(T2);
    expect(state.propositions.length).toBeGreaterThan(before);
    expect(state.propositions.filter((p) => p.group === "insurance_card").every((p) => p.state === "proposed")).toBe(true);
    expect(state.propositions.find((p) => p.id === "doc:insurance_card")?.finding).toBe("present");
    expect(documentCount(state)).toEqual({ received: 2, requested: 2 });
    expect(state.journal.map((e) => e.action)).toContain("document_received");
    expect(state.stage).not.toBe("waiting_on_family");
    // The reviewer's earlier approvals on untouched propositions stand.
    expect(state.propositions.find((p) => p.id === "field:referral-letter:patient_name")?.state).toBe("approved");
  });

  it("ends at ready for scheduling once every item is in and everything is reviewed", () => {
    let state = reviewed(buildReview(submission(), draft(), NOW));
    const card = draft().documents.find((d) => d.mediaId === "insurance-card")!;
    state = receiveDocument(state, "insurance_card", "insurance-card", card, T1);
    state = reviewed(state, T2);
    state = approveFile(state, state.version, T3);
    expect(state.stage).toBe("ready_for_scheduling");
    expect(() => receiveDocument(state, "insurance_card", "insurance-card", card, T4)).toThrow(Refused);
  });

  it("a draft computed again keeps the reviewer's work on unchanged statements and detaches the file approval", () => {
    let state = reviewed(buildReview(submission(), draft(), NOW));
    state = approveFile(state, state.version, T1);
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[0].statement = "The parent states that Tuesdays are best, any time after 3 pm.";
    state = replaceDraft(state, draft(raw, undefined, "live"), T2);
    expect(state.approval).toBeUndefined();
    expect(state.draft.origin).toBe("live");
    expect(state.propositions.find((p) => p.id === "field:referral-letter:patient_name")?.state).toBe("approved");
    const changed = state.propositions.find((p) => p.id.includes("days_that_work"))!;
    expect(changed.state).toBe("proposed");
    expect(changed.recheck?.because).toMatch(/computed again/);
    expect(changed.history.length).toBeGreaterThan(1);
  });
});

describe("an open disagreement cannot simply be approved", () => {
  it("refuses approval and keeps the file waiting", () => {
    const state = buildReview(submission(), draft(), NOW);
    expect(() => approve(state, "xcheck:days", T1)).toThrow(/nothing was chosen/);
    const corrected = correct(state, "xcheck:days", "Tuesdays after 3 pm, confirmed by phone with the family.", T1);
    expect(corrected.propositions.find((p) => p.id === "xcheck:days")?.state).toBe("corrected");
    expect(corrected.stage).toBe("in_review");
  });

  it("an uncertain claim can be approved once the reviewer has checked the source", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[3].uncertain = "stated as a preference, not a requirement";
    let state = buildReview(submission(), draft(raw), NOW);
    const location = state.propositions.find((p) => p.finding === "to_confirm")!;
    expect(location.id).toMatch(/location_preference/);
    state = correct(state, "xcheck:days", "Tuesdays after 3 pm, confirmed by phone.", T1);
    expect(state.stage).toBe("waiting_for_review");
    state = approve(state, location.id, T2);
    expect(state.stage).toBe("in_review");
  });
});

describe("propositions that appear later carry the file version of their arrival", () => {
  it("stamps a re-run's new proposition with the new version", () => {
    let state = buildReview(submission(), draft(), NOW);
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims.push({
      key: "other",
      label: "Other scheduling note",
      statement: "The parent states that Sam has swimming on Thursdays.",
      nature: "extraction",
      quote: "Sam has swimming on Thursdays",
      days: [],
      earliestHour: null,
      location: null,
      uncertain: null,
    });
    state = replaceDraft(state, draft(raw, undefined, "live"), T1);
    const other = state.propositions.find((p) => p.label === "Other scheduling note")!;
    expect(other.history[0].version).toBe(state.version);
    expect(state.version).toBe(2);
  });
});
