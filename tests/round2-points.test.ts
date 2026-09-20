/**
 * Points of the second round that had no test of the reviewer's own: the
 * contact language, the origin of a live run, the Spanish time phrase. Three
 * of the four were run red on 1498107 before their correction (the new
 * functions are imported lazily so a missing one reads as a red test, not as
 * a broken file); the header-line test was written together with its module,
 * so no red run of it exists.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeDraft, resetTranscriptCache } from "../src/lib/ai/pipeline";
import { buildReview, replaceDraft } from "../src/lib/engine/review";
import type { Draft } from "../src/lib/engine/types";
import { transcriptFromRaw } from "../src/lib/engine/verify";
import { DICTIONARIES } from "../src/lib/i18n";
import { sampleIntakeDraft } from "../src/lib/intake-draft";
import { resetLimits } from "../src/lib/limits";
import { mediaOf, type SampleRecording } from "../src/lib/sample";
import { HAND_TRANSCRIPT, NOW, RAW_DRAFT, draft, submission } from "./helpers";

describe("9. the language of the screen is not the language of the messages", () => {
  it("switching the screen language leaves the contact language answer alone", async () => {
    const { switchDraftLanguage } = await import("../src/lib/intake-draft");
    const form = sampleIntakeDraft();
    form.answers.contact_language = "es";
    const switched = switchDraftLanguage(form, "en");
    expect(switched.lang).toBe("en");
    expect(switched.answers.contact_language).toBe("es");
  });
});

describe("10. the origin of a live run says what really ran", () => {
  beforeEach(() => {
    resetLimits();
    resetTranscriptCache();
  });
  afterEach(() => {
    resetLimits();
    resetTranscriptCache();
  });

  it("a draft built on a reused transcript says so, in the draft and in the journal", async () => {
    const recording = mediaOf("recording-scheduling") as SampleRecording;
    const transcript = transcriptFromRaw(recording.id, HAND_TRANSCRIPT, recording.durationSeconds);
    const deps = {
      transcribe: async () => ({ transcript, usage: { model: "test", inputTokens: 1, outputTokens: 1 } }),
      extract: async () => ({ raw: RAW_DRAFT, usage: { model: "test", inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0 } }),
    };
    const first = await computeDraft(["referral-letter", "recording-scheduling"], "live", deps);
    expect(first.draft.transcriptReused).toBeFalsy();
    const second = await computeDraft(["referral-letter", "recording-scheduling"], "live", deps);
    expect(second.usage.transcription?.cached).toBe(true);
    expect(second.draft.transcriptReused).toBe(true);
    const state = replaceDraft(buildReview(submission(), draft(), NOW), second.draft, "2026-09-20T15:01:00.000Z");
    const replaced = state.journal.find((e) => e.action === "draft_replaced")!;
    expect(replaced.detail).toMatch(/transcription reused from an earlier run of the day/);
    expect(replaced.detail).not.toMatch(/both called/);
  });

  it("the header line of the review distinguishes a reused transcription from two calls", async () => {
    const { draftOriginLabel } = await import("../src/lib/draft-origin");
    const live: Draft = { ...draft(RAW_DRAFT, undefined, "live"), computedAt: "2026-09-20T15:01:00.000Z" };
    expect(draftOriginLabel(live)).toMatch(/two model calls ran/);
    expect(draftOriginLabel({ ...live, transcriptReused: true })).toMatch(/transcription was reused/);
    expect(draftOriginLabel({ ...live, transcriptReused: true })).not.toMatch(/two model calls/);
    expect(draftOriginLabel(draft())).toMatch(/served as stored, no model call/);
  });
});

describe("cosmetic: the Spanish time phrase", () => {
  it("says por la mañana, not mañana, which would read as tomorrow", () => {
    expect(DICTIONARIES.es.requestDraft.timePhrase.morning).toBe("por la mañana");
    expect(DICTIONARIES.es.requestDraft.confirmTimeUnknown(DICTIONARIES.es.requestDraft.timePhrase.morning)).toMatch(/su formulario indica por la mañana;/);
    expect(DICTIONARIES.en.requestDraft.timePhrase.morning).toBe("in the morning");
  });
});
