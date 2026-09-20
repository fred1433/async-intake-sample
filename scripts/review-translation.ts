/**
 * Asks a second model to read the Spanish copy of the parent flow next to the
 * English one, and the messages the rules compose (the request to the family
 * in seven situations), and to point out what is wrong or unnatural. One
 * call. The answer is written to docs/translation-review.md and applied by
 * hand.
 *
 * Usage: npm run translation:review     (reads .env.local; never prints a key)
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { addToRequest, buildReview } from "../src/lib/engine/review";
import type { Draft, Lang, Submission } from "../src/lib/engine/types";
import { DICTIONARIES } from "../src/lib/i18n";
import { RECORDED_DRAFT } from "../src/lib/review-store";
import { SAMPLE_SUBMISSION } from "../src/lib/sample";

const ReviewAnswer = z.object({
  issues: z.array(z.object({ key: z.string(), problem: z.string(), suggestion: z.string() })),
  overall: z.string(),
});

function flatten(value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof value === "function") {
    const sample = (value as (...args: unknown[]) => string)("Jordan", "Sam");
    out[prefix] = String(sample);
    return out;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out[prefix] = String(value);
  return out;
}

/** The request the rules compose, in one language, for a situation. */
function composed(lang: Lang, situation: string): string {
  const submission: Submission = structuredClone(SAMPLE_SUBMISSION);
  submission.language = lang;
  submission.answers.contact_language = lang;
  let draft: Draft = structuredClone(RECORDED_DRAFT);
  const NOW = "2026-09-20T15:00:00.000Z";
  const add: string[] = [];
  switch (situation) {
    case "missing card":
      break;
    case "unusable recording":
      draft = { ...draft, recordings: draft.recordings.map((r) => ({ ...r, transcript: { ...r.transcript, unusable: "The recording ends before the answer does." } })) };
      break;
    case "days contradicted":
      add.push("xcheck:days");
      break;
    case "days not mentioned":
      submission.answers.preferred_days = ["monday"];
      add.push("xcheck:days");
      break;
    case "time of day":
      submission.answers.preferred_days = ["tuesday"];
      submission.answers.preferred_time = "morning";
      add.push("xcheck:time");
      break;
    case "place":
      submission.answers.preferred_days = ["tuesday"];
      submission.answers.location = "center";
      add.push("xcheck:location");
      break;
    case "several things":
      submission.answers.preferred_time = "morning";
      submission.answers.location = "center";
      add.push("xcheck:days", "xcheck:time", "xcheck:location");
      break;
  }
  let state = buildReview(submission, draft, NOW);
  for (const id of add) state = addToRequest(state, id, NOW);
  return state.request?.text ?? "(no request)";
}

const SITUATIONS = ["missing card", "unusable recording", "days contradicted", "days not mentioned", "time of day", "place", "several things"];

async function main() {
  try {
    process.loadEnvFile(path.join(process.cwd(), ".env.local"));
  } catch {
    // Environment already set.
  }
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) throw new Error("GEMINI_API_KEY and GEMINI_MODEL are needed.");
  const en = flatten(DICTIONARIES.en);
  const es = flatten(DICTIONARIES.es);
  const pairs = Object.keys(en)
    .map((key) => `${key}\n  EN: ${en[key]}\n  ES: ${es[key] ?? "(missing)"}`)
    .join("\n");
  const messages = SITUATIONS.map((situation) => `composed:${situation}\n  EN:\n${composed("en", situation).replace(/^/gm, "    ")}\n  ES:\n${composed("es", situation).replace(/^/gm, "    ")}`).join("\n\n");
  if (process.env.DRY_RUN) {
    // Print what would be sent, call nothing.
    console.log(messages);
    return;
  }
  const prompt =
    "You are reviewing the Spanish version of a short family intake form used by a behavioral health office in the New York area " +
    "(parents from Brooklyn, Jersey City, Newark; usted register, neutral Latin American Spanish). " +
    "Part 1 lists dictionary strings, key by key. Part 2 lists complete messages the office's rules compose from those strings for seven situations; " +
    "read each Spanish message as a parent would receive it, next to its English version. " +
    "Report only real problems: wrong meaning, unnatural phrasing, wrong register, a term a parent would not understand, a mismatch with the English, " +
    "or a sentence that is grammatically wrong once assembled. Answer in JSON: " +
    '{"issues":[{"key":"...","problem":"...","suggestion":"..."}],"overall":"one sentence"}. If nothing is wrong, return an empty issues list.\n\n' +
    "PART 1, dictionary\n\n" +
    pairs +
    "\n\nPART 2, composed messages\n\n" +
    messages;
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(ReviewAnswer),
      temperature: 0,
      maxOutputTokens: 30000,
    },
  });
  const text = response.text ?? "";
  let parsed: z.infer<typeof ReviewAnswer>;
  try {
    parsed = ReviewAnswer.parse(JSON.parse(text));
  } catch (error) {
    await writeFile(path.join(process.cwd(), "docs", "translation-review.raw.txt"), text);
    throw new Error(`The answer could not be read (${error instanceof Error ? error.message : error}); raw text saved to docs/translation-review.raw.txt`);
  }
  const lines = [
    "# Spanish copy: second-model review",
    "",
    `Reviewed on ${new Date().toISOString().slice(0, 10)} by the transcription model of this project (see recorded-run.json for the model id), one call, temperature 0.`,
    `Input tokens: ${response.usageMetadata?.promptTokenCount ?? "?"}, output tokens: ${response.usageMetadata?.candidatesTokenCount ?? "?"}.`,
    `Reviewed: the dictionary, key by key, and the request to the family as the rules compose it in ${SITUATIONS.length} situations (${SITUATIONS.join(", ")}).`,
    "",
    `Overall: ${parsed.overall}`,
    "",
    "## Issues raised",
    "",
    ...(parsed.issues.length === 0
      ? ["None."]
      : parsed.issues.map((issue) => `- \`${issue.key}\`: ${issue.problem}\n  Suggestion: ${issue.suggestion}`)),
    "",
    "## Composed messages reviewed (Spanish)",
    "",
    ...SITUATIONS.flatMap((situation) => [`### ${situation}`, "", "```", composed("es", situation), "```", ""]),
    "## What was applied",
    "",
    "(filled in by hand after reading the list)",
    "",
  ];
  await writeFile(path.join(process.cwd(), "docs", "translation-review-composed.md"), lines.join("\n"));
  console.log(JSON.stringify({ issues: parsed.issues.length, usage: response.usageMetadata }, null, 2));
  for (const issue of parsed.issues) console.log(`- ${issue.key}: ${issue.problem} -> ${issue.suggestion}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
