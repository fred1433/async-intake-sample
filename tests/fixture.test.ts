/**
 * The recorded run is a fixture, so it is checked like any other data: every
 * quote is on its page, every audio segment is the one the code locates from
 * the quoted words, and the review built from it has the shape the page shows.
 */
import { describe, expect, it } from "vitest";
import recordedDraft from "../src/lib/fixtures/recorded-draft.json";
import run from "../src/lib/fixtures/recorded-run.json";
import { buildReview, documentCount, focalProposition } from "../src/lib/engine/review";
import type { Draft } from "../src/lib/engine/types";
import { locateQuote, quoteIsOnPage } from "../src/lib/engine/verify";
import { documentOf, pageText, SAMPLE_SUBMISSION } from "../src/lib/sample";

const draft = recordedDraft as Draft;

describe("the recorded run", () => {
  it("says it is recorded, and when", () => {
    expect(draft.origin).toBe("recorded");
    expect(Date.parse(draft.computedAt)).not.toBeNaN();
    expect(run.usage.transcription?.model).toBeTruthy();
    expect(run.usage.extraction?.model).toBeTruthy();
    expect(run.recordedAt).toBe(draft.computedAt);
  });

  it("quotes only passages that are on the page named", () => {
    for (const doc of draft.documents) {
      const source = documentOf(doc.mediaId);
      for (const field of doc.fields) {
        expect(quoteIsOnPage(field.quote, pageText(source, field.page)), `${doc.mediaId} ${field.key}`).toBe(true);
      }
    }
  });

  it("ties every claim to the audio segment its words are in", () => {
    for (const rec of draft.recordings) {
      expect(rec.transcript.unusable).toBeNull();
      for (const claim of rec.claims) {
        expect(locateQuote(claim.quote, rec.transcript.segments), claim.key).toEqual(claim.segment);
      }
    }
  });

  it("withheld nothing, and read both sample documents", () => {
    expect(draft.withheld).toEqual([]);
    expect(draft.documents.map((d) => d.mediaId).sort()).toEqual(["insurance-card", "referral-letter"]);
  });

  it("gives the sample its focal point: one missing item, draft request ready for review", () => {
    const state = buildReview(SAMPLE_SUBMISSION, draft, "2026-09-20T15:00:00.000Z");
    expect(documentCount(state)).toEqual({ received: 1, requested: 2 });
    expect(focalProposition(state)?.id).toBe("doc:insurance_card");
    expect(state.request?.status).toBe("draft");
    expect(state.propositions.find((p) => p.id === "xcheck:days")?.finding).toBe("conflicting");
    expect(state.propositions.find((p) => p.id.includes("days_that_do_not_work"))?.finding).toBe("negative");
    expect(state.stage).toBe("waiting_for_review");
    expect(state.propositions.some((p) => p.group === "insurance_card")).toBe(false);
  });
});
