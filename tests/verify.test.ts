import { describe, expect, it } from "vitest";
import { locateQuote, quoteIsOnPage, transcriptFromRaw, verifyDraft } from "../src/lib/engine/verify";
import { DURATION_SECONDS, HAND_TRANSCRIPT, NOW, RAW_DRAFT, source, transcript } from "./helpers";

const sources = () => ({
  documents: [source("referral-letter"), source("insurance-card")],
  recordings: [{ mediaId: "recording-scheduling", transcript: transcript(), durationSeconds: DURATION_SECONDS }],
});

describe("source check on document fields", () => {
  it("keeps a field whose quote is on the page it names", () => {
    const draft = verifyDraft(RAW_DRAFT, sources(), { origin: "recorded", computedAt: NOW });
    const letter = draft.documents.find((d) => d.mediaId === "referral-letter")!;
    expect(letter.fields.map((f) => f.key)).toContain("patient_name");
    expect(draft.withheld).toHaveLength(0);
  });

  it("withholds a field whose quote is not on the page", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields[0].quote = "Patient: Alex Bennett";
    const draft = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    const letter = draft.documents.find((d) => d.mediaId === "referral-letter")!;
    expect(letter.fields.map((f) => f.key)).not.toContain("patient_name");
    expect(draft.withheld).toEqual([expect.objectContaining({ key: "patient_name", reason: "quote_not_found" })]);
  });

  it("withholds a field whose quote is on another page than the one named", () => {
    const raw = structuredClone(RAW_DRAFT);
    const phone = raw.documents[1].fields.find((f) => f.key === "member_services_phone")!;
    phone.page = 1;
    const draft = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    expect(draft.withheld).toEqual([expect.objectContaining({ key: "member_services_phone", reason: "quote_not_found" })]);
  });

  it("refuses a field that comes with no source at all (must fail the check)", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents[0].fields[0].quote = "";
    const draft = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    expect(draft.withheld).toEqual([expect.objectContaining({ key: "patient_name", reason: "no_source" })]);
    expect(draft.documents[0].fields.some((f) => f.key === "patient_name")).toBe(false);
  });

  it("withholds a whole document the file does not hold", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.documents.push({ mediaId: "proof-of-address", readable: true, unreadableReason: null, fields: [] });
    const draft = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    expect(draft.withheld).toEqual([expect.objectContaining({ mediaId: "proof-of-address", reason: "unknown_media" })]);
  });

  it("compares quotes loosely on case, spacing and curly quotes, not on words", () => {
    const page = "Patient: Sam Bennett\nDate of birth: March 14, 2020";
    expect(quoteIsOnPage("patient:  sam bennett", page)).toBe(true);
    expect(quoteIsOnPage("Patient: Sam Benett", page)).toBe(false);
  });
});

describe("source check on recording claims", () => {
  it("locates the audio segment from the quoted words, across segment boundaries", () => {
    const t = transcript();
    expect(locateQuote("Tuesdays work best for us", t.segments)).toEqual({ start: 1.2, end: 4.4 });
    expect(locateQuote("after three. Not Thursdays", t.segments)).toEqual({ start: 1.2, end: 7.9 });
  });

  it("uses the located segment, not the one the model would claim", () => {
    const draft = verifyDraft(RAW_DRAFT, sources(), { origin: "recorded", computedAt: NOW });
    const rec = draft.recordings[0];
    const negative = rec.claims.find((c) => c.key === "days_that_do_not_work")!;
    expect(negative.segment).toEqual({ start: 4.4, end: 7.9 });
  });

  it("withholds a claim whose words are not in the transcript", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[0].quote = "Mondays work best for us";
    const draft = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    expect(draft.withheld).toEqual([expect.objectContaining({ key: "days_that_work", reason: "segment_not_found" })]);
    expect(draft.recordings[0].claims.some((c) => c.key === "days_that_work")).toBe(false);
  });

  it("refuses a claim with no quoted words", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings[0].claims[1].quote = "   ";
    const draft = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    expect(draft.withheld).toEqual([expect.objectContaining({ key: "days_that_do_not_work", reason: "no_source" })]);
  });

  it("marks a recording that ends mid-sentence as unusable, and keeps no claim as a fact about it", () => {
    const t = transcriptFromRaw("recording-scheduling", {
      segments: [{ start: 0, end: 1.5, text: "Tuesdays work best for" }],
      complete: false,
      note: "The audio stops after 1.5 seconds.",
    });
    expect(t.unusable).toBe("The audio stops after 1.5 seconds.");
    const empty = transcriptFromRaw("recording-scheduling", { segments: [], complete: true, note: null });
    expect(empty.unusable).toMatch(/No usable speech/);
  });

  it("keeps a transcript for a recording the model returned nothing about", () => {
    const raw = structuredClone(RAW_DRAFT);
    raw.recordings = [];
    const draft = verifyDraft(raw, sources(), { origin: "recorded", computedAt: NOW });
    expect(draft.recordings).toHaveLength(1);
    expect(draft.recordings[0].claims).toHaveLength(0);
    expect(draft.recordings[0].transcript.segments).toHaveLength(HAND_TRANSCRIPT.segments.length);
  });
});
