/**
 * The invariant of the fifth pass: the code reads no polarity from words. No
 * cross-check attributes an availability or a negation to the parent or to
 * the recording; every cross-check statement opens with "As extracted", the
 * form value and the extracted value stand side by side with the quote, and
 * the question to the family says "as we read it" wherever it cites the
 * recorded answer. Checked on the recorded review under several forms and on
 * twenty synthetic answers, the ones that tripped four rounds of heuristics
 * included: "Tuesdays work and Thursdays do not", "I don't mind Tuesdays",
 * "Tuesdays work because Sam does not have swimming", "after 3 pm without a
 * break", "We cannot do sessions on Tuesdays, Thursdays or Fridays".
 *
 * Written before the correction of the fifth pass; red on a95d316.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RawClaim, RawTranscript } from "../src/lib/engine/raw";
import { addToRequest, buildReview } from "../src/lib/engine/review";
import type { Day, Draft, Submission } from "../src/lib/engine/types";
import { transcriptFromRaw, verifyDraft } from "../src/lib/engine/verify";
import { RECORDED_DRAFT } from "../src/lib/review-store";
import { SAMPLE_SUBMISSION } from "../src/lib/sample";
import { DURATION_SECONDS, NOW, RAW_DRAFT, source, submission } from "./helpers";

type Place = "home" | "center" | "either";
type Time = "morning" | "early_afternoon" | "after_3pm" | "evening";

interface Extracted {
  key: RawClaim["key"];
  quote: string;
  days?: Day[];
  hour?: number;
  place?: Place;
}

interface Synthetic {
  name: string;
  lines: string[];
  claims: Extracted[];
  form: { days?: Day[]; time?: Time; place?: Place };
}

/** Twenty answers, with what a model could extract from them, right or wrong: no polarity may be computed from any of them. */
const SYNTHETIC: Synthetic[] = [
  {
    name: "Tuesdays work and Thursdays do not",
    lines: ["Tuesdays work and Thursdays do not."],
    claims: [
      { key: "days_that_work", quote: "Tuesdays work", days: ["tuesday"] },
      { key: "days_that_do_not_work", quote: "Thursdays do not", days: ["thursday"] },
    ],
    form: { days: ["tuesday", "thursday"] },
  },
  { name: "I don't mind Tuesdays", lines: ["I don't mind Tuesdays."], claims: [{ key: "days_that_work", quote: "I don't mind Tuesdays", days: ["tuesday"] }], form: { days: ["tuesday"] } },
  {
    name: "Tuesdays work because Sam does not have swimming",
    lines: ["Tuesdays work because Sam does not have swimming."],
    claims: [{ key: "days_that_work", quote: "Tuesdays work because Sam does not have swimming", days: ["tuesday"] }],
    form: { days: ["thursday"] },
  },
  {
    name: "after 3 pm without a break",
    lines: ["We can do sessions after 3 pm without a break."],
    claims: [{ key: "time_window", quote: "after 3 pm without a break", hour: 15 }],
    form: { time: "after_3pm" },
  },
  {
    name: "We cannot do sessions on Tuesdays, Thursdays or Fridays",
    lines: ["We cannot do sessions on Tuesdays, Thursdays or Fridays."],
    claims: [{ key: "days_that_do_not_work", quote: "We cannot do sessions on Tuesdays, Thursdays or Fridays", days: ["tuesday", "thursday", "friday"] }],
    form: { days: ["tuesday"] },
  },
  {
    name: "Not Thursdays, Sam has swimming on Thursdays",
    lines: ["Not Thursdays, Sam has swimming on Thursdays."],
    claims: [{ key: "days_that_do_not_work", quote: "Not Thursdays", days: ["thursday"] }],
    form: { days: ["thursday"] },
  },
  {
    name: "Sam has swimming on Thursdays, extracted as Thursday working",
    lines: ["Sam has swimming on Thursdays."],
    claims: [{ key: "days_that_work", quote: "Sam has swimming on Thursdays", days: ["thursday"] }],
    form: { days: ["thursday"] },
  },
  {
    name: "Thursdays don't work for us, extracted as Thursday working",
    lines: ["Thursdays don't work for us."],
    claims: [{ key: "days_that_work", quote: "Thursdays don't work for us", days: ["thursday"] }],
    form: { days: ["thursday"] },
  },
  {
    name: "No problem with Tuesdays, extracted as Tuesday not working",
    lines: ["No problem with Tuesdays."],
    claims: [{ key: "days_that_do_not_work", quote: "No problem with Tuesdays", days: ["tuesday"] }],
    form: { days: ["tuesday"] },
  },
  {
    name: "Los martes sí, pero los jueves no",
    lines: ["Los martes sí, pero los jueves no."],
    claims: [
      { key: "days_that_work", quote: "Los martes sí", days: ["tuesday"] },
      { key: "days_that_do_not_work", quote: "pero los jueves no", days: ["thursday"] },
    ],
    form: { days: ["tuesday", "thursday"] },
  },
  {
    name: "después de las tres de la tarde against a morning form",
    lines: ["Podemos empezar después de las tres de la tarde."],
    claims: [{ key: "time_window", quote: "después de las tres de la tarde", hour: 15 }],
    form: { time: "morning" },
  },
  {
    name: "We cannot do the sessions at home, extracted as home",
    lines: ["We cannot do the sessions at home."],
    claims: [{ key: "location_preference", quote: "We cannot do the sessions at home", place: "home" }],
    form: { place: "home" },
  },
  {
    name: "rather at home, never at the center, against a center form",
    lines: ["We would rather do the sessions at home, never at the center."],
    claims: [{ key: "location_preference", quote: "rather do the sessions at home", place: "home" }],
    form: { place: "center" },
  },
  {
    name: "before 3 pm, extracted as from 15",
    lines: ["Any time before 3 pm works for us."],
    claims: [{ key: "time_window", quote: "before 3 pm", hour: 15 }],
    form: { time: "after_3pm" },
  },
  {
    name: "Mornings are impossible, afternoons are fine",
    lines: ["Mornings are impossible, afternoons are fine."],
    claims: [{ key: "time_window", quote: "afternoons are fine", hour: 12 }],
    form: { time: "morning" },
  },
  {
    name: "Mondays and Wednesdays are good, except Wednesday mornings",
    lines: ["Mondays and Wednesdays are good, except Wednesday mornings."],
    claims: [{ key: "days_that_work", quote: "Mondays and Wednesdays are good", days: ["monday", "wednesday"] }],
    form: { days: ["wednesday"] },
  },
  {
    name: "Fridays starting at 5 pm at the clinic",
    lines: ["We can do Fridays starting at 5 pm at the clinic."],
    claims: [
      { key: "days_that_work", quote: "We can do Fridays", days: ["friday"] },
      { key: "time_window", quote: "starting at 5 pm", hour: 17 },
      { key: "location_preference", quote: "at the clinic", place: "center" },
    ],
    form: { days: ["friday"], time: "evening", place: "home" },
  },
  {
    name: "Neither Monday nor Tuesday works",
    lines: ["Neither Monday nor Tuesday works."],
    claims: [{ key: "days_that_do_not_work", quote: "Neither Monday nor Tuesday works", days: ["monday", "tuesday"] }],
    form: { days: ["monday"] },
  },
  {
    name: "Tuesdays, not Thursdays",
    lines: ["Tuesdays, not Thursdays."],
    claims: [
      { key: "days_that_work", quote: "Tuesdays", days: ["tuesday"] },
      { key: "days_that_do_not_work", quote: "not Thursdays", days: ["thursday"] },
    ],
    form: { days: ["thursday"] },
  },
  {
    name: "Wednesdays from noon, anywhere",
    lines: ["We are free on Wednesdays from noon, anywhere is fine."],
    claims: [
      { key: "days_that_work", quote: "We are free on Wednesdays", days: ["wednesday"] },
      { key: "time_window", quote: "from noon", hour: 12 },
      { key: "location_preference", quote: "anywhere is fine", place: "either" },
    ],
    form: { days: ["wednesday"], time: "early_afternoon", place: "center" },
  },
];

function transcript(lines: string[]): RawTranscript {
  return { segments: lines.map((text, i) => ({ start: i * 3, end: i * 3 + 3, text })), complete: true, note: null };
}

function rawClaim(e: Extracted): RawClaim {
  return {
    key: e.key,
    label: e.key,
    statement: `The parent states that ${e.quote}.`,
    nature: "rephrase",
    quote: e.quote,
    days: e.days ?? [],
    earliestHour: e.hour ?? null,
    location: e.place ?? null,
    uncertain: null,
  };
}

function draftOf(s: Synthetic): Draft {
  const raw = structuredClone(RAW_DRAFT);
  raw.recordings[0].claims = s.claims.map(rawClaim);
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
  if (s.form.days) sub.answers.preferred_days = s.form.days;
  if (s.form.time) sub.answers.preferred_time = s.form.time;
  if (s.form.place) sub.answers.location = s.form.place;
  return sub;
}

/** Wordings that attribute an availability or a negation to the parent or to the recording, or that read one from words. */
const ATTRIBUTIONS: RegExp[] = [
  /recorded answer (says|names|negates|mentions|gives)/i,
  /the parent (states|says|said)/i,
  /\bas working\b/i,
  /\bnegat/i,
  /\bagree/i,
  /named in the spoken clause/i,
  /the spoken (words|clause)/i,
];

const ALLOWED_FINDINGS = new Set(["to_confirm", "conflicting"]);
const ALLOWED_RESULTS = new Set(["not_assessable", "not_met", "recheck"]);

function crossChecksOf(state: ReturnType<typeof buildReview>) {
  return state.propositions.filter((p) => p.id.startsWith("xcheck:"));
}

function checkCross(state: ReturnType<typeof buildReview>, label: string) {
  const crosses = crossChecksOf(state);
  expect(crosses.length, `${label}: no cross-check was built`).toBeGreaterThan(0);
  for (const p of crosses) {
    expect(p.statement, `${label} ${p.id}`).toMatch(/^As extracted/);
    for (const re of ATTRIBUTIONS) {
      expect(p.statement, `${label} ${p.id} statement`).not.toMatch(re);
      expect(p.criterion?.note ?? "", `${label} ${p.id} note`).not.toMatch(re);
      expect(p.criterion?.rule ?? "", `${label} ${p.id} rule`).not.toMatch(re);
    }
    expect(ALLOWED_FINDINGS.has(p.finding), `${label} ${p.id}: ${p.finding}`).toBe(true);
    expect(ALLOWED_RESULTS.has(p.criterion?.result ?? ""), `${label} ${p.id} criterion ${p.criterion?.result}`).toBe(true);
    expect(p.requestable, `${label} ${p.id} must stay askable`).toBe("confirm");
  }
  // The question to the family cites the recorded answer only "as we read it".
  let asked = state;
  for (const p of crosses) asked = addToRequest(asked, p.id, NOW);
  const lines = asked.request!.text.split("\n").filter((line) => line.startsWith("- ") && /recorded answer/.test(line));
  for (const line of lines) expect(line, `${label} question`).toMatch(/as we read it/);
}

describe("no cross-check ever attributes an availability or a negation to the parent", () => {
  it("on the recorded review, whatever the form says", () => {
    const forms: Submission["answers"][] = [
      {},
      { preferred_days: ["tuesday"] },
      { preferred_days: ["thursday"], preferred_time: "morning", location: "center" },
      { preferred_days: ["tuesday"], preferred_time: "after_3pm", location: "home" },
      { preferred_days: [], preferred_time: "evening", location: "either" },
    ];
    for (const answers of forms) {
      const state = buildReview({ ...SAMPLE_SUBMISSION, answers: { ...SAMPLE_SUBMISSION.answers, ...answers } }, RECORDED_DRAFT, NOW);
      checkCross(state, JSON.stringify(answers));
    }
  });

  for (const s of SYNTHETIC) {
    it(`on a synthetic answer: ${s.name}`, () => {
      const d = draftOf(s);
      // No false rejection: the code reads no polarity, so nothing here "says the opposite".
      expect(d.withheld, `${s.name}: the extracted claims must pass the source check`).toEqual([]);
      expect(d.recordings[0].claims).toHaveLength(s.claims.length);
      for (const c of d.recordings[0].claims) for (const line of c.checked) for (const re of ATTRIBUTIONS) expect(line, `${s.name} checked`).not.toMatch(re);
      checkCross(buildReview(formOf(s), d, NOW), s.name);
    });
  }

  it("the engine has no reader of a negation, and no producer of a consistent finding", () => {
    const verify = readFileSync(path.resolve(import.meta.dirname, "../src/lib/engine/verify.ts"), "utf8");
    const review = readFileSync(path.resolve(import.meta.dirname, "../src/lib/engine/review.ts"), "utf8");
    for (const name of ["negated", "deniedIn", "hourNamed", "NEGATIONS", "deniesOf", "checkHour"]) {
      expect(verify, `verify.ts still defines ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
      expect(review, `review.ts still uses ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect(review).not.toMatch(/"consistent"/);
  });
});
