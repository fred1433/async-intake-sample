/**
 * Computes the recorded review once, for real, and stores it as a fixture.
 *
 * Two calls: one transcription (Gemini), one extraction (Claude). The page then
 * serves this file without calling anything; the "run again" button repeats
 * these two calls live, under the daily cap.
 *
 * Usage: npm run fixtures     (reads .env.local; never prints a key)
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { computeDraft } from "../src/lib/ai/pipeline";
import { KNOWN_MEDIA_IDS } from "../src/lib/sample";

async function main() {
  try {
    process.loadEnvFile(path.join(process.cwd(), ".env.local"));
  } catch {
    // Environment already set, or no local file: the pipeline checks what it needs.
  }
  const started = Date.now();
  const { draft, usage } = await computeDraft(KNOWN_MEDIA_IDS, "recorded");
  const out = path.join(process.cwd(), "src", "lib", "fixtures");
  await mkdir(out, { recursive: true });
  const run = {
    note: "Recorded run of the two model calls on the sample media, verified by the code. The draft next to this file is served as is; no call happens when the page shows it.",
    recordedAt: draft.computedAt,
    elapsedMs: Date.now() - started,
    usage,
  };
  // The draft goes to the browser; the run details (models, tokens) stay in the repository only.
  await writeFile(path.join(out, "recorded-draft.json"), JSON.stringify(draft, null, 2) + "\n");
  await writeFile(path.join(out, "recorded-run.json"), JSON.stringify(run, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
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
