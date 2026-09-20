/**
 * Runs the two model calls again on the sample media, under the daily caps.
 *
 * The browser can only name media the page provides; anything else is refused
 * before a call is made. When the cap is reached or a provider is down, the
 * answer says so and the page keeps the recorded review.
 */
import { NextResponse } from "next/server";
import { computeDraft, ModelAnswerUnusable, ModelNotConfigured, ProviderUnavailable } from "@/lib/ai/pipeline";
import { inspect, LIMIT_SCOPE, recordProviderFailure, recordProviderSuccess, takeLiveRun } from "@/lib/limits";
import { isKnownMedia } from "@/lib/sample";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RECORDED_STAYS = "The recorded review stays available.";

function clientId(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0] ?? "local").trim();
}

function liveConfigured(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY &&
      process.env.ANTHROPIC_MODEL &&
      process.env.GEMINI_API_KEY &&
      process.env.GEMINI_MODEL &&
      process.env.DEMO_SPEND_LIMIT_USD,
  );
}

export async function GET(request: Request) {
  return NextResponse.json({
    live: liveConfigured(),
    limits: inspect(new Date(), clientId(request)),
    scope: LIMIT_SCOPE,
    spendLimitUsd: process.env.DEMO_SPEND_LIMIT_USD ? Number(process.env.DEMO_SPEND_LIMIT_USD) : null,
  });
}

export async function POST(request: Request) {
  let body: { media?: unknown };
  try {
    body = (await request.json()) as { media?: unknown };
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const media = Array.isArray(body.media) ? body.media : [];
  if (media.length === 0 || !media.every(isKnownMedia)) {
    return NextResponse.json(
      { error: "This page only processes the sample files it provides. Nothing else is read." },
      { status: 400 },
    );
  }

  if (!liveConfigured()) {
    return NextResponse.json(
      { error: `Live runs are switched off on this deployment. ${RECORDED_STAYS}` },
      { status: 503 },
    );
  }

  const decision = takeLiveRun(clientId(request));
  if (!decision.allowed) {
    const paused = decision.reason === "paused_after_errors";
    return NextResponse.json(
      {
        error: paused
          ? `Live runs are paused after repeated provider errors, until ${decision.pausedUntil}. ${RECORDED_STAYS}`
          : decision.reason === "instance_daily_cap"
            ? `Today's live runs on this sample are used up. ${RECORDED_STAYS} The cap lifts at midnight UTC.`
            : `You have used your live runs for today. ${RECORDED_STAYS} The cap lifts at midnight UTC.`,
        limits: decision,
      },
      { status: paused ? 503 : 429, headers: { "Retry-After": paused ? "1800" : "3600" } },
    );
  }

  try {
    const { draft, usage } = await computeDraft(media as string[], "live");
    recordProviderSuccess();
    return NextResponse.json({
      draft,
      // Token counts only: the page never shows which models ran.
      usage: {
        transcription: usage.transcription
          ? { inputTokens: usage.transcription.inputTokens, outputTokens: usage.transcription.outputTokens, cached: usage.transcription.cached ?? false }
          : null,
        extraction: usage.extraction ? { inputTokens: usage.extraction.inputTokens, outputTokens: usage.extraction.outputTokens } : null,
      },
      limits: inspect(new Date(), clientId(request)),
    });
  } catch (error) {
    if (error instanceof ModelNotConfigured) {
      return NextResponse.json({ error: `Live runs are not configured on this deployment. ${RECORDED_STAYS}` }, { status: 503 });
    }
    if (error instanceof ProviderUnavailable) {
      recordProviderFailure();
      return NextResponse.json(
        {
          error: `The ${error.provider} provider did not answer. ${RECORDED_STAYS}`,
          // Status and error class only: enough to tell a cap from an outage, never the provider's message.
          detail: { provider: error.provider, status: error.status, kind: error.kind },
        },
        { status: 503, headers: { "Retry-After": "600" } },
      );
    }
    if (error instanceof ModelAnswerUnusable) {
      return NextResponse.json({ error: `A model answered with something this page could not read. ${RECORDED_STAYS}` }, { status: 502 });
    }
    console.error(error);
    return NextResponse.json({ error: `Something went wrong on the server. ${RECORDED_STAYS}` }, { status: 500 });
  }
}
