"use client";

/** The review reads this browser's storage on first render, so it renders on the client only. */
import dynamic from "next/dynamic";

const ReviewApp = dynamic(() => import("@/components/review/ReviewApp").then((m) => m.ReviewApp), {
  ssr: false,
  loading: () => <p className="p-8 text-center text-[13px] text-ink-3">Loading the sample file…</p>,
});

export function ReviewClient() {
  return <ReviewApp />;
}
