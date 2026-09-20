/**
 * The invariant of the fourth pass: the code never affirms an agreement
 * between the form and the recording. A cross-check is "Sources disagree" on
 * an explicit negation in the clause of the quoted words, or "To confirm";
 * nothing else, what seems to agree included. Checked on the recorded review
 * and on ten synthetic transcripts whose structured data matches the form
 * exactly: the cases where an eager checker would say "consistent".
 *
 * Written before the correction of the fourth pass; red on aaf262a.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RawClaim, RawTranscript } from "../src/lib/engine/raw";
import { buildReview, FINDING_LABELS } from "../src/lib/engine/review";
import type { Day, Draft, Submission } from "../src/lib/engine/types";
import { transcriptFromRaw, verifyDraft } from "../src/lib/engine/verify";
import { RECORDED_DRAFT } from "../src/lib/review-store";
import { SAMPLE_SUBMISSION } from "../src/lib/sample";
import { DURATION_SECONDS, NOW, RAW_DRAFT, source, submission } from "./helpers";

type Place = "home" | "center" | "either";

interface Synthetic {
  name: string;
  lines: string[];
  days: Day[];
  time: "morning" | "early_afternoon" | "after_3pm" | "evening";
  hour: number;
  place: Place;
  quotes: { days: string; time: string; place: string };
}

/** Ten answers whose structure matches the form: no computed agreement may come out of them. */
const SYNTHETIC: Synthetic[] = [
  {
    name: "Tuesdays after 3 pm at home",
    lines: ["Tuesdays work best for us, any time after 3 pm.", "We would rather do the sessions at home."],
    days: ["tuesday"],
    time: "after_3pm",
    hour: 15,
    place: "home",
    quotes: { days: "Tuesdays work best for us", time: "any time after 3 pm", place: "do the sessions at home" },
  },
  {
    name: "Mondays and Wednesdays from 8 am at the center",
    lines: ["Mondays and Wednesdays are good for us, from 8 am, at the center."],
    days: ["monday", "wednesday"],
    time: "morning",
    hour: 8,
    place: "center",
    quotes: { days: "Mondays and Wednesdays are good for us", time: "from 8 am", place: "at the center" },
  },
  {
    name: "Spanish: martes a partir de las tres de la tarde en casa",
    lines: ["Los martes nos viene bien, a partir de las tres de la tarde, en casa."],
    days: ["tuesday"],
    time: "after_3pm",
    hour: 15,
    place: "home",
    quotes: { days: "Los martes nos viene bien", time: "a partir de las tres de la tarde", place: "en casa" },
  },
  {
    name: "Tuesdays, after three pm, either place",
    lines: ["Tuesdays work for us, after three pm, and either place is fine."],
    days: ["tuesday"],
    time: "after_3pm",
    hour: 15,
    place: "either",
    quotes: { days: "Tuesdays work for us", time: "after three pm", place: "either place is fine" },
  },
  {
    name: "Fridays starting at 5 pm at the clinic",
    lines: ["We can do Fridays starting at 5 pm at the clinic."],
    days: ["friday"],
    time: "evening",
    hour: 17,
    place: "center",
    quotes: { days: "We can do Fridays", time: "starting at 5 pm", place: "at the clinic" },
  },
  {
    name: "Saturday mornings from 8 am at home",
    lines: ["Saturday mornings from 8 am at home would be perfect."],
    days: ["saturday"],
    time: "morning",
    hour: 8,
    place: "home",
    quotes: { days: "Saturday mornings", time: "from 8 am", place: "at home would be perfect" },
  },
  {
    name: "Tuesdays work, but Thursdays don't, after 3 pm",
    lines: ["Tuesdays work, but Thursdays don't.", "After 3 pm is best, wherever you prefer."],
    days: ["tuesday"],
    time: "after_3pm",
    hour: 15,
    place: "either",
    quotes: { days: "Tuesdays work", time: "After 3 pm is best", place: "wherever you prefer" },
  },
  {
    name: "Wednesdays from noon, whichever place",
    lines: ["We are free on Wednesdays from noon, anywhere is fine."],
    days: ["wednesday"],
    time: "early_afternoon",
    hour: 12,
    place: "either",
    quotes: { days: "We are free on Wednesdays", time: "from noon", place: "anywhere is fine" },
  },
  {
    name: "Tuesdays, no problem, after 3 pm at home",
    lines: ["After 3 pm works, at home.", "No problem with Tuesdays either."],
    days: ["tuesday"],
    time: "after_3pm",
    hour: 15,
    place: "home",
    quotes: { days: "No problem with Tuesdays", time: "After 3 pm works", place: "at home" },
  },
  {
    name: "Tuesdays and Thursdays from 3 pm at the center",
    lines: ["Tuesdays and Thursdays, from 3 pm, at the center please."],
    days: ["tuesday", "thursday"],
    time: "after_3pm",
    hour: 15,
    place: "center",
    quotes: { days: "Tuesdays and Thursdays", time: "from 3 pm", place: "at the center please" },
  },
];

function transcript(lines: string[]): RawTranscript {
  return { segments: lines.map((text, i) => ({ start: i * 3, end: i * 3 + 3, text })), complete: true, note: null };
}

function claim(overrides: Partial<RawClaim> & Pick<RawClaim, "key" | "quote">): RawClaim {
  return { label: overrides.key, statement: `The parent states that ${overrides.quote}.`, nature: "rephrase", days: [], earliestHour: null, location: null, uncertain: null, ...overrides };
}

function draftOf(s: Synthetic): Draft {
  const raw = structuredClone(RAW_DRAFT);
  raw.recordings[0].claims = [
    claim({ key: "days_that_work", label: "Days that work", quote: s.quotes.days, days: s.days }),
    claim({ key: "time_window", label: "Time window", quote: s.quotes.time, earliestHour: s.hour }),
    claim({ key: "location_preference", label: "Location preference", quote: s.quotes.place, location: s.place }),
  ];
  return verifyDraft(
    raw,
    {
      documents: [source("referral-letter"), source("insurance-card")],
      recordings: [{ mediaId: "recording-scheduling", transcript: transcriptFromRaw("recording-scheduling", transcript(s.lines), DURATION_SECONDS), durationSeconds: DURATION_SECONDS }],
    },
    { origin: "recorded", computedAt: NOW },
  );
}

function formOf(s: Synthetic): Submission {
  const sub = submission();
  sub.answers.preferred_days = s.days;
  sub.answers.preferred_time = s.time;
  sub.answers.location = s.place;
  return sub;
}

const ALLOWED_FINDINGS = new Set(["to_confirm", "conflicting"]);
const ALLOWED_RESULTS = new Set(["not_assessable", "not_met", "recheck"]);

function crossChecksOf(state: ReturnType<typeof buildReview>) {
  return state.propositions.filter((p) => p.id.startsWith("xcheck:"));
}

describe("no cross-check ever renders an agreement", () => {
  it("on the recorded review, whatever the form says", () => {
    const forms: Submission["answers"][] = [
      {},
      { preferred_days: ["tuesday"] },
      { preferred_days: ["tuesday"], preferred_time: "after_3pm", location: "home" },
      { preferred_days: ["tuesday"], location: "either" },
      { preferred_days: [], preferred_time: "morning", location: "center" },
    ];
    for (const answers of forms) {
      const state = buildReview({ ...SAMPLE_SUBMISSION, answers: { ...SAMPLE_SUBMISSION.answers, ...answers } }, RECORDED_DRAFT, NOW);
      const crosses = crossChecksOf(state);
      expect(crosses.length).toBeGreaterThan(0);
      for (const p of crosses) {
        expect(ALLOWED_FINDINGS.has(p.finding), `${p.id} with ${JSON.stringify(answers)}: ${p.finding}`).toBe(true);
        expect(ALLOWED_RESULTS.has(p.criterion?.result ?? ""), `${p.id} criterion ${p.criterion?.result}`).toBe(true);
        expect(p.requestable, `${p.id} must stay askable`).toBe("confirm");
      }
    }
  });

  for (const s of SYNTHETIC) {
    it(`on a synthetic answer whose structure matches the form: ${s.name}`, () => {
      const d = draftOf(s);
      expect(d.withheld, "the synthetic claims must pass the source check").toEqual([]);
      const state = buildReview(formOf(s), d, NOW);
      const crosses = crossChecksOf(state);
      expect(crosses.map((p) => p.id).sort()).toEqual(["xcheck:days", "xcheck:location", "xcheck:time"]);
      for (const p of crosses) {
        expect(ALLOWED_FINDINGS.has(p.finding), `${p.id}: ${p.finding}`).toBe(true);
        expect(ALLOWED_RESULTS.has(p.criterion?.result ?? ""), `${p.id} criterion ${p.criterion?.result}`).toBe(true);
        expect(p.statement).not.toMatch(/\bagree/i);
        expect(p.requestable).toBe("confirm");
      }
    });
  }

  it("the engine has no producer of a consistent finding, and no label for one", () => {
    expect("consistent" in FINDING_LABELS).toBe(false);
    const engine = readFileSync(path.resolve(import.meta.dirname, "../src/lib/engine/review.ts"), "utf8");
    expect(engine).not.toMatch(/"consistent"/);
  });
});
