"use client";

/** The flow resumes from this browser's storage, so it renders on the client only. */
import dynamic from "next/dynamic";

const IntakeFlow = dynamic(() => import("@/components/intake/IntakeFlow").then((m) => m.IntakeFlow), {
  ssr: false,
  loading: () => <p className="p-8 text-center text-[13px] text-ink-3">Loading…</p>,
});

export function IntakeClient() {
  return <IntakeFlow />;
}
