import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildReview, documentCount, focalProposition } from "@/lib/engine/review";
import { RECORDED_DRAFT } from "@/lib/review-store";
import { SAMPLE_SUBMISSION } from "@/lib/sample";

export function Hero() {
  const state = buildReview(SAMPLE_SUBMISSION, RECORDED_DRAFT, RECORDED_DRAFT.computedAt);
  const focal = focalProposition(state)!;
  const count = documentCount(state);
  // The greeting, the line that says what is missing, and the item itself.
  const requestLines = state.request?.text.split("\n").filter(Boolean) ?? [];
  const itemIndex = requestLines.findIndex((line) => line.startsWith("- "));
  const requestExcerpt = itemIndex === -1 ? requestLines.slice(0, 3).join(" ") : `${requestLines[0]} ${requestLines[itemIndex - 1]} ${requestLines[itemIndex].slice(2)}.`;

  return (
    <section className="hero-glow">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-24 pt-14 md:grid-cols-[1.05fr_0.95fr] md:pb-32 md:pt-24">
        <div className="fade-in-up">
          <p className="eyebrow">Intake file {SAMPLE_SUBMISSION.reference}</p>
          <h1 className="mt-5 text-[40px] font-semibold leading-[1.04] tracking-[-0.028em] text-ink md:text-[60px]">
            <span className="whitespace-nowrap">One missing item.</span>
            <br />
            Draft request ready for review.
          </h1>
          <p className="mt-8 max-w-xl text-[17px] leading-[1.65] text-ink-2 md:text-[19px]">
            A parent finished the intake on a phone. The AI drafted the file one claim at a time, each with its source, checked by
            the code. The reviewer checks the source, corrects what needs it, and approves. Nothing is sent before that.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/review"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand px-6 text-[15px] font-semibold text-white shadow-[0_8px_24px_-10px_rgba(15,118,110,0.7)] transition-colors hover:bg-brand-strong"
            >
              View sample review
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/intake"
              className="inline-flex h-12 items-center rounded-xl border border-line bg-white px-6 text-[15px] font-semibold text-ink transition-colors hover:bg-muted"
            >
              Try the intake flow
            </Link>
          </div>
        </div>

        <div className="fade-in-up-late relative">
          <div className="absolute inset-x-6 -bottom-3 top-6 -z-10 rounded-[26px] bg-white/70 border border-line" aria-hidden />
          <div className="surface p-6 md:p-7">
            <div className="flex items-center justify-between text-[12.5px] font-medium text-ink-3">
              <span>Requested items</span>
              <span>
                {count.received} received of {count.requested}
              </span>
            </div>
            <div className="mt-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{focal.label}</p>
                <p className="mt-1 text-[14.5px] text-ink-2">{focal.statement}</p>
              </div>
              <span className="pill pill-amber mt-1">Not received</span>
            </div>
            <div className="mt-6 rounded-xl border border-line bg-paper p-4">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-strong">Rule 1 · request prepared, not sent</p>
              <p className="mt-2 line-clamp-4 text-[14px] leading-[1.6] text-ink-2">{requestExcerpt}</p>
            </div>
            <div className="mt-5 flex items-center justify-between">
              <span className="text-[13px] text-ink-3">Prepared by rule · awaiting review</span>
              <Link href="/review?open=request" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand-strong hover:underline underline-offset-4">
                Review the request
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
