import type { Criterion, Finding, Nature, PropositionState } from "@/lib/engine/types";
import { FINDING_LABELS } from "@/lib/engine/review";

const FINDING_TONE: Record<Finding, string> = {
  present: "pill-neutral",
  consistent: "pill-green",
  missing: "pill-amber",
  unreadable: "pill-amber",
  conflicting: "pill-rose",
  to_confirm: "pill-amber",
  unusable_audio: "pill-amber",
  negative: "pill-sky",
  withheld: "pill-amber",
  not_checked: "pill-neutral",
};

export function FindingPill({ finding, compact = false }: { finding: Finding; compact?: boolean }) {
  return <span className={`pill ${FINDING_TONE[finding]} ${compact ? "px-2 py-[2px] text-[11px]" : ""}`}>{FINDING_LABELS[finding]}</span>;
}

const STATE_META: Record<PropositionState, { label: string; dot: string; tone: string }> = {
  proposed: { label: "Proposed by AI", dot: "bg-sky-ink", tone: "pill-sky" },
  corrected: { label: "Corrected by reviewer", dot: "bg-amber-ink", tone: "pill-amber" },
  approved: { label: "Approved", dot: "bg-green-ink", tone: "pill-green" },
};

export function StateDot({ state, recheck }: { state: PropositionState; recheck?: boolean }) {
  return (
    <span
      className={`inline-block size-2 rounded-full ${recheck ? "bg-rose-ink ring-2 ring-rose-soft" : STATE_META[state].dot}`}
      title={recheck ? "Needs another look" : STATE_META[state].label}
      aria-label={recheck ? "Needs another look" : STATE_META[state].label}
    />
  );
}

export function StatePill({ state, byRule }: { state: PropositionState; byRule?: boolean }) {
  const meta = STATE_META[state];
  return <span className={`pill ${meta.tone}`}>{state === "proposed" && byRule ? "Proposed by rule" : meta.label}</span>;
}

const NATURE_LABEL: Record<Nature | "rule", string> = {
  extraction: "Extraction",
  rephrase: "Rephrase",
  inference: "Inference",
  rule: "Computed by rule",
};

export function NaturePill({ nature }: { nature: Nature | "rule" }) {
  return <span className="pill pill-neutral">{NATURE_LABEL[nature]}</span>;
}

const CRITERION_TONE: Record<Criterion["result"], string> = {
  met: "pill-green",
  not_met: "pill-rose",
  not_assessable: "pill-neutral",
  recheck: "pill-amber",
};

const CRITERION_LABEL: Record<Criterion["result"], string> = {
  met: "Met",
  not_met: "Not met",
  not_assessable: "Not assessable",
  recheck: "Re-check",
};

export function CriterionPill({ result }: { result: Criterion["result"] }) {
  return <span className={`pill ${CRITERION_TONE[result]}`}>{CRITERION_LABEL[result]}</span>;
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatSeconds(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const whole = Math.floor(tenths / 10);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}.${tenths % 10}`;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd hidden md:inline-flex">{children}</kbd>;
}
