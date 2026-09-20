"use client";

import { useState } from "react";
import { Check, Pencil, Send } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { JournalEntry, RequestDraft, ReviewState } from "@/lib/engine/types";
import { DOCUMENT_LABELS, FINDING_LABELS } from "@/lib/engine/review";
import { Kbd, formatWhen } from "./bits";

const ACTOR_TONE: Record<JournalEntry["actor"], string> = {
  ai: "pill-sky",
  rule: "pill-neutral",
  reviewer: "pill-green",
  parent: "pill-brand",
};

const ACTOR_LABEL: Record<JournalEntry["actor"], string> = {
  ai: "AI",
  rule: "Rule",
  reviewer: "Reviewer",
  parent: "Family",
};

export function JournalPanel({ state }: { state: ReviewState }) {
  const entries = [...state.journal].reverse();
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[14px] font-semibold text-ink">Journal</h3>
        <p className="text-[12.5px] text-ink-3">
          {entries.length} entries · file version {state.version}
        </p>
      </div>
      {state.approvalHistory.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {state.approvalHistory.map((a) => (
            <li key={`${a.version}-${a.at}`} className="rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] text-ink-2">
              Version {a.version} was approved at {formatWhen(a.at)} (content {a.hash.slice(0, 16)}). Detached{" "}
              {a.detached ? `at ${formatWhen(a.detached.at)}: ${a.detached.because}` : ""}.
              <details className="mt-1">
                <summary className="cursor-pointer text-ink-3">
                  What was approved: {a.snapshot.length} propositions
                  {a.request ? " and the request text" : ""}
                </summary>
                <ul className="mt-1.5 space-y-1 text-ink-2">
                  {a.snapshot.map((s) => (
                    <li key={s.id}>
                      <span className="font-medium text-ink">{s.label}</span> ({FINDING_LABELS[s.finding]}, {s.state}): {s.statement}
                    </li>
                  ))}
                </ul>
                {a.request && (
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-paper p-2.5 font-sans text-[12.5px] leading-[1.5] text-ink">
                    {a.request.text}
                  </pre>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead className="bg-paper text-left text-[11px] uppercase tracking-[0.1em] text-ink-3">
            <tr>
              <th className="px-3 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">Who</th>
              <th className="px-3 py-2 font-semibold">What</th>
              <th className="px-3 py-2 font-semibold">v</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {entries.map((e, index) => (
              <tr key={`${e.at}-${index}`} className="align-top">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink-3">{formatWhen(e.at)}</td>
                <td className="px-3 py-2">
                  <span className={`pill ${ACTOR_TONE[e.actor]}`}>{ACTOR_LABEL[e.actor]}</span>
                </td>
                <td className="px-3 py-2 text-ink-2">
                  <span className="font-medium text-ink">{e.action.replace(/_/g, " ")}</span>
                  <span className="text-ink-3"> · </span>
                  {e.detail}
                  {e.from !== undefined && e.to !== undefined && (
                    <span className="mt-0.5 block text-ink-3">
                      From <span className="italic">“{e.from}”</span> to <span className="italic">“{e.to}”</span>
                    </span>
                  )}
                  {e.from === undefined && e.to !== undefined && (
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-ink-3">Text as approved or prepared</summary>
                      <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-line bg-paper p-2.5 font-sans text-[12.5px] leading-[1.5] text-ink">
                        {e.to}
                      </pre>
                    </details>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-ink-3">{e.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RequestDialog({
  open,
  onOpenChange,
  request,
  onApprove,
  onEdit,
  onResolveItem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request?: RequestDraft;
  onApprove: () => void;
  onEdit: (text: string) => void;
  onResolveItem: (propositionId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <RequestBody request={request} onApprove={onApprove} onEdit={onEdit} onResolveItem={onResolveItem} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted with the dialog content, so the editing state starts fresh every time the dialog opens. */
function RequestBody({
  request,
  onApprove,
  onEdit,
  onResolveItem,
}: {
  request?: RequestDraft;
  onApprove: () => void;
  onEdit: (text: string) => void;
  onResolveItem: (propositionId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  const pending = request?.items.filter((i) => !i.satisfiedAt) ?? [];
  const itemLabel = (id: string) => {
    if (id.startsWith("doc:")) return DOCUMENT_LABELS[id.slice(4)] ?? id;
    if (id.startsWith("rec:")) return "Recorded answer";
    if (id === "xcheck:days") return "Preferred days, to confirm";
    if (id === "xcheck:time") return "Time of day, to confirm";
    if (id === "xcheck:location") return "Place of the sessions, to confirm";
    return id;
  };
  const superseded = request?.approvals.filter((a) => a.superseded) ?? [];
  return (
    <>
      <DialogTitle className="text-[17px] font-semibold tracking-[-0.01em]">Request to the family</DialogTitle>
      <DialogDescription className="text-[13px] text-ink-3">
        Prepared by rule 1 from the file, no model writes it
        {request?.language === "es" ? ", in Spanish, the language the parent asked for" : ", in the language the parent asked for"}. You can correct it before
        approving. Nothing is sent by this sample.
      </DialogDescription>
      {request ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {request.status === "approved" ? (
              <span className="pill pill-green">Approved {request.approvedAt ? `at ${formatWhen(request.approvedAt)}` : ""} · not sent</span>
            ) : (
              <span className="pill pill-amber">Draft · not sent</span>
            )}
            {request.edited && <span className="pill pill-neutral">Text corrected by the reviewer</span>}
            <span className="text-[12.5px] text-ink-3">
              {pending.length} open item{pending.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="space-y-1 text-[13px] text-ink-2">
            {request.items.map((item) => (
              <li key={item.propositionId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {item.satisfiedAt ? <Check className="size-3.5 text-green-ink" /> : <Send className="size-3.5 text-ink-3" />}
                <span className={item.satisfiedAt ? "line-through text-ink-3" : ""}>{itemLabel(item.propositionId)}</span>
                {item.satisfiedAt && (
                  <span className="text-[12px] text-ink-3">
                    {item.satisfiedBy === "reviewer" ? "resolved by the reviewer" : "received"} {formatWhen(item.satisfiedAt)}
                  </span>
                )}
                {!item.satisfiedAt && item.basisMissing && (
                  <span className="pill pill-amber" title={`Since ${formatWhen(item.basisMissing.at)}`}>
                    {item.basisMissing.because}
                  </span>
                )}
                {!item.satisfiedAt && (
                  <button
                    type="button"
                    onClick={() => onResolveItem(item.propositionId)}
                    className="inline-flex h-6 items-center rounded-md border border-line bg-white px-2 text-[11.5px] font-semibold text-ink-2 hover:bg-muted"
                    title="Take this item out of the request: handled outside the message, or no longer a question. The journal keeps it."
                  >
                    Resolve
                  </button>
                )}
              </li>
            ))}
          </ul>
          {editing ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              autoFocus
              className="block w-full rounded-lg border border-input bg-white px-3 py-2 font-sans text-[13.5px] leading-[1.55] text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/20"
            />
          ) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-paper p-3 font-sans text-[13.5px] leading-[1.55] text-ink">
              {request.text}
            </pre>
          )}
          {superseded.length > 0 && (
            <details className="text-[12.5px] text-ink-3">
              <summary className="cursor-pointer">
                {superseded.length === 1 ? "An earlier approved text was superseded" : `${superseded.length} earlier approved texts were superseded`}
              </summary>
              {superseded.map((a) => (
                <div key={a.at} className="mt-2">
                  <p>
                    Approved at {formatWhen(a.at)} (version {a.version}), superseded at {a.superseded ? formatWhen(a.superseded.at) : ""}:{" "}
                    {a.superseded?.because}.
                  </p>
                  <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-line bg-white p-2.5 font-sans text-[12.5px] leading-[1.5] text-ink-2">
                    {a.text}
                  </pre>
                </div>
              ))}
            </details>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-[13.5px] font-semibold text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onEdit(text);
                    setEditing(false);
                  }}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-3.5 text-[13.5px] font-semibold text-white"
                >
                  Save correction
                </button>
              </>
            ) : (
              <>
                {pending.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setText(request.text);
                      setEditing(true);
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-[13.5px] font-semibold text-ink hover:bg-muted"
                  >
                    <Pencil className="size-4" />
                    Correct the text
                  </button>
                )}
                {request.status !== "approved" && pending.length > 0 && (
                  <button
                    type="button"
                    onClick={onApprove}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-3.5 text-[13.5px] font-semibold text-white hover:bg-brand-strong"
                  >
                    <Check className="size-4" />
                    Approve the request (not sent)
                  </button>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <p className="text-[13.5px] text-ink-2">No request is needed: every requested item is in.</p>
      )}
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ["J / ↓", "Next proposition"],
  ["K / ↑", "Previous proposition"],
  ["A", "Approve the selected proposition (acknowledge, when it is not evaluable)"],
  ["E", "Correct the statement"],
  ["R", "Ask the family, or open the request"],
  ["G", "Show or hide the journal"],
  ["Esc", "Cancel an edit, close a panel"],
  ["?", "This list"],
];

export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton>
        <DialogTitle className="text-[17px] font-semibold tracking-[-0.01em]">Keyboard</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-3">The reviewer view is meant to be worked through without the mouse.</DialogDescription>
        <ul className="space-y-2">
          {SHORTCUTS.map(([keys, what]) => (
            <li key={keys} className="flex items-center justify-between gap-4 text-[13.5px] text-ink-2">
              <span>{what}</span>
              <span className="flex items-center gap-1">
                {keys.split(" / ").map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
