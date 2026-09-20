import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeDraft, ProviderUnavailable, resetTranscriptCache } from "../src/lib/ai/pipeline";
import { transcriptFromRaw } from "../src/lib/engine/verify";
import { inspect, recordProviderFailure, recordProviderSuccess, resetLimits, takeLiveRun } from "../src/lib/limits";
import { mediaOf, type SampleRecording } from "../src/lib/sample";
import { HAND_TRANSCRIPT, RAW_DRAFT } from "./helpers";

describe("daily caps on live runs", () => {
  beforeEach(() => {
    resetLimits();
    process.env.DEMO_DAILY_CAP = "2";
    process.env.DEMO_ADDRESS_DAILY_CAP = "1";
  });
  afterEach(() => {
    delete process.env.DEMO_DAILY_CAP;
    delete process.env.DEMO_ADDRESS_DAILY_CAP;
    resetLimits();
  });

  it("allows up to the instance cap, then refuses with the reason", () => {
    const day = new Date("2026-09-20T10:00:00Z");
    expect(takeLiveRun("a", day).allowed).toBe(true);
    expect(takeLiveRun("b", day).allowed).toBe(true);
    const third = takeLiveRun("c", day);
    expect(third.allowed).toBe(false);
    expect(third.reason).toBe("instance_daily_cap");
    expect(third.instanceRemaining).toBe(0);
  });

  it("caps one address before the instance", () => {
    const day = new Date("2026-09-20T10:00:00Z");
    expect(takeLiveRun("a", day).allowed).toBe(true);
    const again = takeLiveRun("a", day);
    expect(again.allowed).toBe(false);
    expect(again.reason).toBe("address_daily_cap");
    expect(inspect(day, "b").allowed).toBe(true);
  });

  it("starts again at midnight UTC", () => {
    const day = new Date("2026-09-20T23:59:00Z");
    takeLiveRun("a", day);
    takeLiveRun("b", day);
    expect(takeLiveRun("c", day).allowed).toBe(false);
    const next = new Date("2026-09-21T00:01:00Z");
    expect(inspect(next, "c").resetsAt).toBe("2026-09-22T00:00:00.000Z");
    expect(takeLiveRun("c", next).allowed).toBe(true);
  });

  it("reads the cap from the environment, so a test deployment can set it to 1", () => {
    process.env.DEMO_DAILY_CAP = "1";
    const day = new Date("2026-09-20T10:00:00Z");
    expect(takeLiveRun("a", day).allowed).toBe(true);
    expect(takeLiveRun("b", day).allowed).toBe(false);
  });
});

describe("point 26: one counter for both providers, no repetition on persistent errors", () => {
  beforeEach(() => {
    resetLimits();
    resetTranscriptCache();
    process.env.DEMO_DAILY_CAP = "2";
  });
  afterEach(() => {
    delete process.env.DEMO_DAILY_CAP;
    resetLimits();
    resetTranscriptCache();
  });

  it("pauses live runs after three consecutive provider failures, for a bounded time, and a success clears it", () => {
    const now = new Date("2026-09-20T10:00:00Z");
    recordProviderFailure(now);
    recordProviderFailure(now);
    expect(inspect(now, "a").allowed).toBe(true);
    recordProviderFailure(now);
    const paused = takeLiveRun("a", now);
    expect(paused.allowed).toBe(false);
    expect(paused.reason).toBe("paused_after_errors");
    expect(paused.pausedUntil).toBe("2026-09-20T10:30:00.000Z");
    expect(inspect(now, "a").instanceRemaining).toBe(2);
    const later = new Date("2026-09-20T10:31:00Z");
    expect(takeLiveRun("b", later).allowed).toBe(true);
    recordProviderFailure(later);
    recordProviderFailure(later);
    recordProviderSuccess();
    recordProviderFailure(later);
    expect(inspect(later, "c").allowed).toBe(true);
  });

  it("keeps the transcript of the day, so an extraction that fails does not spend the transcription again", async () => {
    const calls = { transcribe: 0, extract: 0 };
    const recording = mediaOf("recording-scheduling") as SampleRecording;
    const transcript = transcriptFromRaw(recording.id, HAND_TRANSCRIPT, recording.durationSeconds);
    const deps = {
      transcribe: async () => {
        calls.transcribe += 1;
        return { transcript, usage: { model: "test", inputTokens: 1, outputTokens: 1 } };
      },
      extract: async () => {
        calls.extract += 1;
        if (calls.extract === 1) throw new ProviderUnavailable("down", "extraction", 401, "AuthenticationError");
        return { raw: RAW_DRAFT, usage: { model: "test", inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0 } };
      },
    };
    await expect(computeDraft(["referral-letter", "recording-scheduling"], "live", deps)).rejects.toBeInstanceOf(ProviderUnavailable);
    expect(calls).toEqual({ transcribe: 1, extract: 1 });
    const { draft, usage } = await computeDraft(["referral-letter", "recording-scheduling"], "live", deps);
    expect(calls).toEqual({ transcribe: 1, extract: 2 });
    expect(usage.transcription?.cached).toBe(true);
    expect(draft.recordings[0].transcript.segments.length).toBe(HAND_TRANSCRIPT.segments.length);
  });
});
