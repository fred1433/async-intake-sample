"use client";

import { useEffect, useRef } from "react";
import type { Proposition, PropositionGroup } from "@/lib/engine/types";
import { GROUP_LABELS } from "@/lib/engine/review";
import { FindingPill, StateDot } from "./bits";

const GROUP_ORDER: PropositionGroup[] = ["documents", "referral_letter", "insurance_card", "recording", "cross_checks"];

export function PropositionList({
  propositions,
  selectedId,
  onSelect,
}: {
  propositions: Proposition[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <div className="divide-y divide-line">
      {GROUP_ORDER.map((group) => {
        const items = propositions.filter((p) => p.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="py-2">
            <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">{GROUP_LABELS[group]}</p>
            <ul>
              {items.map((p) => {
                const selected = p.id === selectedId;
                return (
                  <li key={p.id}>
                    <button
                      ref={selected ? selectedRef : undefined}
                      type="button"
                      onClick={() => onSelect(p.id)}
                      className={`flex w-full items-start gap-3 border-l-2 px-4 py-2.5 text-left transition-colors ${
                        selected ? "border-brand bg-brand-mist" : "border-transparent hover:bg-muted/70"
                      }`}
                    >
                      <span className="mt-[7px]">
                        <StateDot state={p.state} recheck={!!p.recheck} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13.5px] font-semibold text-ink">{p.label}</span>
                          <FindingPill finding={p.finding} compact />
                        </span>
                        <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">{p.statement}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
