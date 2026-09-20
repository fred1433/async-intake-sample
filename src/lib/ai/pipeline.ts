/**
 * The only place that calls a model. Server only.
 *
 * One transcription call (the recording) and one extraction call (documents and
 * transcript together), then the code verifies every quote and locates every
 * audio segment. Models come from the environment, never from a literal here.
 * Output length is bounded. The keys stay on the server.
 *
 * The transcript of a sample recording is kept in memory for the UTC day: a
 * run whose extraction fails does not spend the transcription again, and the
 * daily count taken before the first call is what bounds both providers.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ApiError as GeminiApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { RawDraft, RawTranscript } from "../engine/raw";
import type { Draft, Transcript } from "../engine/types";
import { transcriptFromRaw, verifyDraft, type DocumentSource, type RecordingSource } from "../engine/verify";
import { documentOf, isKnownMedia, mediaOf, pageText, type SampleDocument, type SampleRecording } from "../sample";
import { dict } from "../i18n";
import { EXTRACT_SYSTEM, TRANSCRIBE_PROMPT, extractInstruction } from "./prompt";

/** Room for the model's reasoning as well as the structured answer: a bound of 3000 cut the JSON short on 20 September 2026. */
export const MAX_OUTPUT_TOKENS = 8000;

export class ModelNotConfigured extends Error {}
/** The call did not come back: no credit, no key accepted, no route, no answer. */
export class ProviderUnavailable extends Error {
  constructor(
    message: string,
    /** Which of the two calls failed, and the HTTP status the provider gave, if any. Never the provider's words. */
    public provider: "transcription" | "extraction",
    public status: number | null = null,
    public kind: string | null = null,
  ) {
    super(message);
    this.name = "ProviderUnavailable";
  }
}
/** The call came back, and the answer held nothing this page can read. */
export class ModelAnswerUnusable extends Error {}

export interface PipelineUsage {
  transcription: { model: string; inputTokens: number; outputTokens: number; cached?: boolean } | null;
  extraction: { model: string; inputTokens: number; outputTokens: number; cacheReadInputTokens: number } | null;
}

/** The two calls, replaceable in tests. */
export interface PipelineCalls {
  transcribe: typeof transcribe;
  extract: typeof extract;
}

const transcriptCache = new Map<string, { day: string; transcript: Transcript; usage: PipelineUsage["transcription"] }>();

/** Tests only. */
export function resetTranscriptCache(): void {
  transcriptCache.clear();
}

function anthropicModel(): string {
  const model = process.env.ANTHROPIC_MODEL;
  if (!model) throw new ModelNotConfigured("ANTHROPIC_MODEL is not set.");
  return model;
}

function geminiModel(): string {
  const model = process.env.GEMINI_MODEL;
  if (!model) throw new ModelNotConfigured("GEMINI_MODEL is not set.");
  return model;
}

async function mediaBytes(file: string): Promise<Buffer> {
  return readFile(path.join(process.cwd(), "public", file.replace(/^\//, "")));
}

export function documentSource(doc: SampleDocument): DocumentSource {
  const pages: Record<number, string> = {};
  for (const page of doc.pages) pages[page.number] = pageText(doc, page.number);
  return { mediaId: doc.id, pages };
}

export async function transcribe(recording: SampleRecording): Promise<{ transcript: Transcript; usage: PipelineUsage["transcription"] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ModelNotConfigured("GEMINI_API_KEY is not set.");
  const model = geminiModel();
  const ai = new GoogleGenAI({ apiKey });
  const bytes = await mediaBytes(recording.file);
  let text: string | undefined;
  let usage: PipelineUsage["transcription"] = null;
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: recording.mimeType, data: bytes.toString("base64") } }, { text: TRANSCRIBE_PROMPT }],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(RawTranscript),
        maxOutputTokens: 2000,
        temperature: 0,
      },
    });
    text = response.text;
    usage = {
      model,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } catch (error) {
    console.error("The transcription call failed.", error);
    const status = error instanceof GeminiApiError ? error.status : null;
    const kind = error instanceof Error ? error.name : null;
    throw new ProviderUnavailable("The transcription provider did not answer.", "transcription", status, kind);
  }
  let raw: RawTranscript;
  try {
    raw = RawTranscript.parse(JSON.parse(text ?? ""));
  } catch (error) {
    console.error("The transcription answer could not be read.", error);
    throw new ModelAnswerUnusable("The transcription came back in a shape this page cannot read.");
  }
  return { transcript: transcriptFromRaw(recording.id, raw, recording.durationSeconds), usage };
}

export async function extract(
  documents: SampleDocument[],
  transcripts: Transcript[],
): Promise<{ raw: RawDraft; usage: PipelineUsage["extraction"] }> {
  const model = anthropicModel();
  const client = new Anthropic();
  const content: Anthropic.ContentBlockParam[] = [];
  for (const doc of documents) {
    const bytes = await mediaBytes(doc.file);
    content.push({ type: "text", text: `Document mediaId "${doc.id}" (${doc.title}):` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") } });
  }
  content.push({
    type: "text",
    text: extractInstruction(
      documents.map((d) => ({ mediaId: d.id, title: d.title, pages: d.pages.length })),
      transcripts,
      dict("en").prompt.question,
    ),
  });
  let response;
  try {
    response = await client.messages.parse({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [{ type: "text", text: EXTRACT_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(RawDraft) },
    });
  } catch (error) {
    // What the provider says can name the account or the balance: it stays in the server log.
    console.error("The extraction call failed.", error);
    if (error instanceof APIError) throw new ProviderUnavailable("The model provider did not answer the call.", "extraction", error.status ?? null, error.name);
    // The call came back and its answer could not be parsed: a bad answer, not an outage.
    if (error instanceof Error && /structured output/i.test(error.message)) throw new ModelAnswerUnusable("The answer held nothing this page can read.");
    throw new ProviderUnavailable("The model provider did not answer the call.", "extraction", null, error instanceof Error ? error.name : null);
  }
  if (!response.parsed_output) {
    console.error("The extraction answer could not be parsed.", response.stop_reason);
    throw new ModelAnswerUnusable("The answer held nothing this page can read.");
  }
  return {
    raw: response.parsed_output,
    usage: {
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

/** Runs the whole thing on known sample media only. Unknown ids are refused before any call. */
export async function computeDraft(
  mediaIds: string[],
  origin: Draft["origin"],
  calls: Partial<PipelineCalls> = {},
): Promise<{ draft: Draft; usage: PipelineUsage }> {
  const { transcribe: doTranscribe = transcribe, extract: doExtract = extract } = calls;
  const ids = Array.from(new Set(mediaIds));
  for (const id of ids) {
    if (!isKnownMedia(id)) throw new Error(`Refused: "${id}" is not a sample media this page provides.`);
  }
  const documents = ids.map(mediaOf).filter((m): m is SampleDocument => m.kind === "document").map((m) => documentOf(m.id));
  const recordings = ids.map(mediaOf).filter((m): m is SampleRecording => m.kind === "recording");

  const usage: PipelineUsage = { transcription: null, extraction: null };
  const transcripts: Transcript[] = [];
  const day = new Date().toISOString().slice(0, 10);
  for (const recording of recordings) {
    const key = `${recording.id}:${process.env.GEMINI_MODEL ?? ""}`;
    const kept = transcriptCache.get(key);
    if (kept && kept.day === day) {
      transcripts.push(kept.transcript);
      usage.transcription = kept.usage ? { ...kept.usage, cached: true } : null;
      continue;
    }
    const result = await doTranscribe(recording);
    transcriptCache.set(key, { day, transcript: result.transcript, usage: result.usage });
    transcripts.push(result.transcript);
    usage.transcription = result.usage;
  }

  const { raw, usage: extractionUsage } = await doExtract(documents, transcripts);
  usage.extraction = extractionUsage;

  const sources = {
    documents: documents.map(documentSource),
    recordings: transcripts.map((t): RecordingSource => ({ mediaId: t.mediaId, transcript: t, durationSeconds: recordings.find((r) => r.id === t.mediaId)?.durationSeconds ?? 0 })),
  };
  const draft = verifyDraft(raw, sources, { origin, computedAt: new Date().toISOString() });
  return { draft, usage };
}
