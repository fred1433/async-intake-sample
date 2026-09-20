/**
 * Computes the recorded review once, for real, and stores it as a fixture.
 *
 * Two calls: one transcription (Gemini), one extraction (Claude). The page then
 * serves this file without calling anything; the "run again" button repeats
 * these two calls live, under the daily cap. What the models answered is kept
 * as well (recorded-raw.json), so the code's check can be run again on the
 * same answers when the check changes, without a call.
 *
 * Usage: npm run fixtures                 (two real calls; reads .env.local; never prints a key)
 *        npm run fixtures -- --reverify   (no call: checks the stored model answers again with the current code)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { computeDraft, verifyRun, type PipelineUsage, type RawRun } from "../src/lib/ai/pipeline";
import { KNOWN_MEDIA_IDS } from "../src/lib/sample";

async function main() {
  try {
    process.loadEnvFile(path.join(process.cwd(), ".env.local"));
  } catch {
    // Environment already set, or no local file: the pipeline checks what it needs.
  }
  const out = path.join(process.cwd(), "src", "lib", "fixtures");
  await mkdir(out, { recursive: true });
  const reverify = process.argv.includes("--reverify");
  const started = Date.now();
  let draft;
  let usage: PipelineUsage;
  let raw: RawRun;
  let run: Record<string, unknown>;
  if (reverify) {
    // The stored answers, checked again by the current code: the recorded date and the usage are those of the real run.
    raw = JSON.parse(await readFile(path.join(out, "recorded-raw.json"), "utf8")) as RawRun;
    const previous = JSON.parse(await readFile(path.join(out, "recorded-run.json"), "utf8")) as { recordedAt: string; usage: PipelineUsage; elapsedMs: number; verifiedAgainAt?: string };
    usage = previous.usage;
    draft = verifyRun(raw, KNOWN_MEDIA_IDS, { origin: "recorded", computedAt: previous.recordedAt });
    run = {
      note: "Recorded run of the two model calls on the sample media, verified by the code. The draft next to this file is served as is; no call happens when the page shows it. The model answers are in recorded-raw.json; verifiedAgainAt says when the code's check was last run again on them without a call.",
      recordedAt: previous.recordedAt,
      elapsedMs: previous.elapsedMs,
      verifiedAgainAt: new Date().toISOString(),
      usage,
    };
  } else {
    const result = await computeDraft(KNOWN_MEDIA_IDS, "recorded");
    draft = result.draft;
    usage = result.usage;
    raw = result.raw;
    run = {
      note: "Recorded run of the two model calls on the sample media, verified by the code. The draft next to this file is served as is; no call happens when the page shows it. The model answers are in recorded-raw.json.",
      recordedAt: draft.computedAt,
      elapsedMs: Date.now() - started,
      usage,
    };
    await writeFile(path.join(out, "recorded-raw.json"), JSON.stringify(raw, null, 2) + "\n");
  }
  // The draft goes to the browser; the run details (models, tokens) and the raw answers stay in the repository only.
  await writeFile(path.join(out, "recorded-draft.json"), JSON.stringify(draft, null, 2) + "\n");
  await writeFile(path.join(out, "recorded-run.json"), JSON.stringify(run, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        mode: reverify ? "reverify (no call)" : "computed (two calls)",
        recordedAt: draft.computedAt,
        elapsedMs: run.elapsedMs,
        usage,
        documents: draft.documents.map((d) => ({ mediaId: d.mediaId, readable: d.readable, fields: d.fields.length })),
        recordings: draft.recordings.map((r) => ({ mediaId: r.mediaId, segments: r.transcript.segments.length, claims: r.claims.length, unusable: r.transcript.unusable })),
        withheld: draft.withheld,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
