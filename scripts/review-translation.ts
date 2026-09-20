/**
 * Asks a second model to read the Spanish copy of the parent flow next to the
 * English one and point out what is wrong or unnatural. One call. The answer
 * is written to docs/translation-review.md and applied by hand.
 *
 * Usage: npm run translation:review     (reads .env.local; never prints a key)
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { DICTIONARIES } from "../src/lib/i18n";

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
  const prompt =
    "You are reviewing the Spanish version of a short family intake form used by a behavioral health office in the New York area " +
    "(parents from Brooklyn, Jersey City, Newark; usted register, neutral Latin American Spanish). " +
    "For each key below, compare ES with EN. Report only real problems: wrong meaning, unnatural phrasing, wrong register, " +
    "a term a parent would not understand, or a mismatch with the English. Answer in JSON: " +
    '{"issues":[{"key":"...","problem":"...","suggestion":"..."}],"overall":"one sentence"}. If nothing is wrong, return an empty issues list.\n\n' +
    pairs;
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(ReviewAnswer),
      temperature: 0,
      maxOutputTokens: 8000,
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
    "",
    `Overall: ${parsed.overall}`,
    "",
    "## Issues raised",
    "",
    ...(parsed.issues.length === 0
      ? ["None."]
      : parsed.issues.map((issue) => `- \`${issue.key}\`: ${issue.problem}\n  Suggestion: ${issue.suggestion}`)),
    "",
    "## What was applied",
    "",
    "(filled in by hand after reading the list)",
    "",
  ];
  await writeFile(path.join(process.cwd(), "docs", "translation-review.md"), lines.join("\n"));
  console.log(JSON.stringify({ issues: parsed.issues.length, usage: response.usageMetadata }, null, 2));
  for (const issue of parsed.issues) console.log(`- ${issue.key}: ${issue.problem} -> ${issue.suggestion}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
