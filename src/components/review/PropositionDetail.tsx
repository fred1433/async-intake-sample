"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Check, FileText, Mic, Pencil, Send, TextCursorInput } from "lucide-react";
import type { Evidence, Proposition, RequestDraft } from "@/lib/engine/types";
import { CriterionPill, FindingPill, Kbd, NaturePill, StatePill, formatSeconds, formatWhen } from "./bits";

function evidenceLabel(e: Evidence): string {
  if (e.kind === "document") return `Document, page ${e.page}${e.quote ? "" : " (whole page)"}`;
  if (e.kind === "audio") return `Recording ${formatSeconds(e.start)} to ${formatSeconds(e.end)}`;
  return "Intake form";
}

function EvidenceIcon({ kind }: { kind: Evidence["kind"] }) {
  if (kind === "document") return <FileText className="size-3.5" />;
  if (kind === "audio") return <Mic className="size-3.5" />;
  return <TextCursorInput className="size-3.5" />;
}

export function PropositionDetail({
  proposition: p,
  request,
  editing,
  editText,
  onEditText,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onApprove,
  onAddToRequest,
  onOpenRequest,
  activeEvidence,
  onSelectEvidence,
}: {
  proposition: Proposition;
  request?: RequestDraft;
  editing: boolean;
  editText: string;
  onEditText: (text: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onApprove: () => void;
  onAddToRequest: () => void;
  onOpenRequest: () => void;
  activeEvidence: number;
  onSelectEvidence: (index: number) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [editing]);

  const byRule = p.nature === "rule";
  const inApprovedRequest = p.inRequest && request?.status === "approved";
  const previous = p.history.length > 1 ? p.history[p.history.length - 2] : null;
  const current = p.history[p.history.length - 1];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <FindingPill finding={p.finding} />
        <NaturePill nature={p.nature} />
        <StatePill state={p.state} byRule={byRule} />
        {p.inRequest && <span className="pill pill-brand">{inApprovedRequest ? "In the approved request" : "In the request draft"}</span>}
      </div>
      <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.015em] text-ink">{p.label}</h2>

      {p.recheck && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-soft bg-rose-soft/60 px-3 py-2 text-[13px] text-rose-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Needs another look: {p.recheck.because} ({formatWhen(p.recheck.at)}). Approve again once checked.
          </span>
        </div>
      )}

      <div className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Statement</p>
        {editing ? (
          <div className="mt-1.5">
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => onEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelEdit();
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onSaveEdit();
                }
              }}
              rows={3}
              className="block w-full rounded-lg border border-input bg-white px-3 py-2 text-[15px] leading-[1.5] text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/20"
            />
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={onSaveEdit} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-[13px] font-semibold text-white">
                Save correction
                <span className="ml-1 hidden items-center gap-0.5 md:inline-flex">
                  <Kbd>⌘</Kbd>
                  <Kbd>↵</Kbd>
                </span>
              </button>
              <button type="button" onClick={onCancelEdit} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[13px] font-semibold text-ink">
                Cancel <Kbd>Esc</Kbd>
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-1.5 rounded-lg border border-line bg-white px-3 py-2.5 text-[15px] leading-[1.5] text-ink">{p.statement}</p>
        )}
        {previous && (
          <p className="mt-1.5 text-[12.5px] text-ink-3">
            {current.by === "reviewer" ? "Corrected by the reviewer" : current.by === "ai" ? "Proposed again by the AI" : "Recomputed by rule"} at {formatWhen(current.at)}. Was:{" "}
            <span className="italic">“{previous.statement}”</span> ({previous.by === "ai" ? "AI" : previous.by === "rule" ? "rule" : "reviewer"}, {formatWhen(previous.at)}).
          </p>
        )}
      </div>

      {p.criterion && (
        <div className="mt-4 rounded-lg border border-line bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Criterion applied</p>
              <p className="mt-1 text-[14px] font-semibold text-ink">{p.criterion.label}</p>
              <p className="mt-0.5 text-[13px] text-ink-2">Rule: {p.criterion.rule}</p>
              {p.criterion.note && <p className="mt-1 text-[12.5px] text-ink-3">{p.criterion.note}</p>}
            </div>
            <CriterionPill result={p.criterion.result} />
          </div>
        </div>
      )}

      <div className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Source</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {p.evidence.map((e, index) => (
            <button
              key={`${e.kind}-${index}`}
              type="button"
              onClick={() => onSelectEvidence(index)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium ${
                activeEvidence === index ? "border-brand bg-brand-mist text-brand-strong" : "border-line bg-white text-ink-2 hover:bg-muted"
              }`}
            >
              <EvidenceIcon kind={e.kind} />
              {evidenceLabel(e)}
            </button>
          ))}
        </div>
        {p.evidence[activeEvidence]?.kind !== "form" && p.evidence[activeEvidence]?.quote && (
          <p className="mt-2 text-[13px] leading-[1.5] text-ink-2">
            Quoted: <span className="italic">“{p.evidence[activeEvidence].quote}”</span>
          </p>
        )}
        {p.checked && p.checked.length > 0 && (
          <div className="mt-2 rounded-lg border border-line bg-white px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Checked by the code</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] leading-[1.5] text-ink-2">
              {p.checked.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {p.finding === "withheld" && (
          <p className="mt-2 text-[12.5px] leading-[1.5] text-ink-3">
            The model proposed this and the code refused it. It is listed so nothing disappears: acknowledge it, or correct it with what the source really says.
          </p>
        )}
      </div>

      <div className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">State</p>
        <ul className="mt-1.5 space-y-1 text-[13px] text-ink-2">
          {p.history.map((h, index) => (
            <li key={`${h.at}-${index}`} className="flex gap-2">
              <span className="w-[128px] shrink-0 tabular-nums text-ink-3">{formatWhen(h.at)}</span>
              <span>
                {h.by === "ai" ? "Proposed by AI" : h.by === "rule" ? "Computed by rule" : "Corrected by reviewer"}
                {index > 0 ? `: “${h.statement}”` : ""}
                {` (file version ${h.version})`}
              </span>
            </li>
          ))}
          {p.approvedAt && (
            <li className="flex gap-2">
              <span className="w-[128px] shrink-0 tabular-nums text-ink-3">{formatWhen(p.approvedAt)}</span>
              <span className="font-medium text-green-ink">Approved by reviewer</span>
            </li>
          )}
        </ul>
      </div>

      <div className="mt-auto pb-1 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          {p.inRequest ? (
            <button type="button" onClick={onOpenRequest} className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-3.5 text-[13.5px] font-semibold text-white">
              <Send className="size-4" />
              {inApprovedRequest ? "See the approved request" : "Review the request draft"}
              <Kbd>R</Kbd>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onApprove}
                disabled={editing || (p.state === "approved" && !p.recheck) || (p.finding === "conflicting" && p.state === "proposed")}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-3.5 text-[13.5px] font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
              >
                <Check className="size-4" />
                {p.state === "approved" && !p.recheck ? (p.finding === "withheld" ? "Acknowledged" : "Approved") : p.finding === "withheld" ? "Acknowledge" : "Approve"}
                <Kbd>A</Kbd>
              </button>
              <button
                type="button"
                onClick={onStartEdit}
                disabled={editing}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-[13.5px] font-semibold text-ink hover:bg-muted disabled:opacity-40"
              >
                <Pencil className="size-4" />
                Correct
                <Kbd>E</Kbd>
              </button>
              {p.requestable && (
                <button
                  type="button"
                  onClick={onAddToRequest}
                  disabled={editing}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-[13.5px] font-semibold text-ink hover:bg-muted disabled:opacity-40"
                >
                  <Send className="size-4" />
                  Ask the family
                  <Kbd>R</Kbd>
                </button>
              )}
            </>
          )}
        </div>
        {p.finding === "conflicting" && !p.inRequest && p.state === "proposed" && (
          <p className="mt-2 text-[12.5px] text-ink-3">Rule 2: nothing was chosen. Correct the statement with what you confirmed, or ask the family.</p>
        )}
        {(p.finding === "missing" || p.finding === "unreadable" || p.finding === "unusable_audio") && p.inRequest && (
          <p className="mt-2 text-[12.5px] text-ink-3">Rule 1: a request to the family was prepared for this item. It is not sent.</p>
        )}
      </div>
    </div>
  );
}
