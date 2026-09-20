"use client";

/**
 * The reviewer's side. Dense, fast, keyboard first. Every action goes through
 * the engine; this component only decides what is on screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, ChevronLeft, HelpCircle, RefreshCw, RotateCcw, Send } from "lucide-react";
import { TopBanner } from "@/components/site/TopBanner";
import {
  addToRequest,
  applyLiveRun,
  approve,
  approveFile,
  approveRequest,
  canApproveFile,
  correct,
  documentCount,
  editRequest,
  focalProposition,
  STAGE_LABELS,
} from "@/lib/engine/review";
import { Refused, type Draft, type ReviewState } from "@/lib/engine/types";
import { dict } from "@/lib/i18n";
import { isSampleSubmission, loadReview, mediaForLiveRun, persistReview, resetToSample } from "@/lib/review-store";
import { formatDay, formatWhen, Kbd } from "./bits";
import { HelpDialog, JournalPanel, RequestDialog } from "./Panels";
import { PropositionDetail } from "./PropositionDetail";
import { PropositionList } from "./PropositionList";
import { SourcePane } from "./SourcePane";

const STAGE_TONE: Record<ReviewState["stage"], string> = {
  in_review: "pill-sky",
  waiting_for_review: "pill-amber",
  waiting_on_family: "pill-brand",
  ready_for_scheduling: "pill-green",
};

const MOBILE = "(max-width: 767px)";

export function ReviewApp() {
  const [state, setState] = useState<ReviewState>(() => loadReview());
  const stateRef = useRef(state);
  const [selectedId, setSelectedIdRaw] = useState<string | null>(() => focalProposition(state)?.id ?? state.propositions[0]?.id ?? null);
  const [activeEvidence, setActiveEvidence] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [showJournal, setShowJournal] = useState(false);
  // Arriving from the home page: open the request when asked, and on a phone open the focal item at once.
  // This component renders on the client only, so the window is there on first render.
  const [showRequest, setShowRequest] = useState(() => new URLSearchParams(window.location.search).get("open") === "request");
  const [showHelp, setShowHelp] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(() => window.matchMedia(MOBILE).matches);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const t = dict("en");

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const commit = useCallback((next: ReviewState) => {
    persistReview(next);
    stateRef.current = next;
    setState(next);
  }, []);

  const selected = useMemo(() => state.propositions.find((p) => p.id === selectedId) ?? null, [state, selectedId]);

  const setSelectedId = useCallback((id: string | null, evidenceIndex = 0) => {
    setSelectedIdRaw(id);
    setActiveEvidence(evidenceIndex);
    setEditing(false);
  }, []);

  const select = useCallback(
    (id: string, openDetail = false) => {
      setSelectedId(id);
      if (openDetail) setMobileDetail(true);
    },
    [setSelectedId],
  );

  const move = useCallback(
    (delta: number) => {
      if (state.propositions.length === 0) return;
      const index = Math.max(0, state.propositions.findIndex((p) => p.id === selectedId));
      const next = (index + delta + state.propositions.length) % state.propositions.length;
      setSelectedId(state.propositions[next].id);
    },
    [state, selectedId, setSelectedId],
  );

  const doApprove = useCallback(() => {
    if (!selected || selected.inRequest) return;
    const wasApproved = selected.state === "approved" && !selected.recheck;
    try {
      commit(approve(state, selected.id));
      setToast(
        wasApproved
          ? { text: "Already approved. Nothing changed; the journal noted the repeat.", tone: "warn" }
          : { text: `${selected.label}: ${selected.finding === "withheld" ? "acknowledged as not evaluable" : "approved"}.`, tone: "ok" },
      );
    } catch (error) {
      setToast({ text: error instanceof Error ? error.message : "Could not approve.", tone: "warn" });
    }
  }, [state, selected, commit]);

  const startEdit = useCallback(() => {
    if (!selected || selected.inRequest) return;
    setEditText(selected.statement);
    setEditing(true);
  }, [selected]);

  const saveEdit = useCallback(() => {
    if (!selected) return;
    const next = correct(state, selected.id, editText);
    setEditing(false);
    if (next !== state) {
      commit(next);
      setToast({ text: `${selected.label}: corrected. Whatever rests on it is flagged for another look.`, tone: "ok" });
    }
  }, [state, selected, editText, commit]);

  const doRequest = useCallback(() => {
    if (!selected) return;
    if (selected.inRequest) {
      setShowRequest(true);
      return;
    }
    if (!selected.requestable) return;
    try {
      commit(addToRequest(state, selected.id));
      setShowRequest(true);
    } catch (error) {
      setToast({ text: error instanceof Error ? error.message : "Could not add this item.", tone: "warn" });
    }
  }, [state, selected, commit]);

  const doApproveRequest = useCallback(() => {
    try {
      const next = approveRequest(state);
      commit(next);
      setShowRequest(false);
      // The next thing worth a look: the conflict between the form and the recording, with its segment.
      const conflict = next.propositions.find((p) => p.id === "xcheck:days" && p.state === "proposed" && (p.finding === "conflicting" || p.finding === "to_confirm"));
      if (conflict) {
        const audio = conflict.evidence.findIndex((e) => e.kind === "audio");
        setSelectedId(conflict.id, audio === -1 ? 0 : audio);
        setMobileDetail(true);
        setToast({ text: "Request approved, not sent. Next: the days the form and the recording disagree on, with the segment already cued. Nothing else is approved.", tone: "ok" });
      } else {
        setToast({ text: "Request approved. Not sent: this sample sends nothing.", tone: "ok" });
      }
    } catch (error) {
      setToast({ text: error instanceof Error ? error.message : "Could not approve the request.", tone: "warn" });
    }
  }, [state, commit, setSelectedId]);

  const doEditRequest = useCallback(
    (text: string) => {
      try {
        const next = editRequest(state, text);
        if (next !== state) {
          commit(next);
          setToast({ text: "Request text corrected. The rule's version is in the journal.", tone: "ok" });
        }
      } catch (error) {
        setToast({ text: error instanceof Error ? error.message : "Could not correct the request.", tone: "warn" });
      }
    },
    [state, commit],
  );

  const doApproveFile = useCallback(() => {
    const shownVersion = state.version;
    try {
      const next = approveFile(state, shownVersion);
      commit(next);
      setToast({ text: `Version ${shownVersion} approved. ${STAGE_LABELS[next.stage]}.`, tone: "ok" });
    } catch (error) {
      const refusedState = (error as { state?: ReviewState }).state;
      if (refusedState) commit(refusedState);
      setToast({ text: error instanceof Refused ? error.message : "Could not approve the file.", tone: "warn" });
    }
  }, [state, commit]);

  const runAgain = useCallback(async () => {
    if (running) return;
    setRunning(true);
    // What the run is for. The result is applied to the file as it is when the run comes back, and only if it is still this file.
    const expected = { reference: state.submission.reference, media: mediaForLiveRun(state.submission) };
    try {
      const response = await fetch("/api/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media: expected.media }),
      });
      const payload = (await response.json()) as { draft?: Draft; error?: string };
      if (!response.ok || !payload.draft) {
        setToast({ text: payload.error ?? "The live run did not come back. The recorded review stays available.", tone: "warn" });
        return;
      }
      const result = applyLiveRun(stateRef.current, expected, payload.draft);
      if (!result.applied) {
        setToast({ text: result.reason ?? "The live result was not applied.", tone: "warn" });
        return;
      }
      commit(result.state);
      setToast({
        text: `Live draft computed at ${formatWhen(payload.draft.computedAt)}: ${result.state.propositions.length} propositions, ${payload.draft.withheld.length} withheld by the source check${payload.draft.withheld.length > 0 ? ", listed as not evaluable" : ""}.`,
        tone: "ok",
      });
    } catch {
      setToast({ text: "The live run did not come back. The recorded review stays available.", tone: "warn" });
    } finally {
      setRunning(false);
    }
  }, [state, running, commit]);

  const reset = useCallback(() => {
    const fresh = resetToSample();
    commit(fresh);
    setSelectedId(focalProposition(fresh)?.id ?? null);
    setMobileDetail(window.matchMedia(MOBILE).matches);
    setToast({ text: "Back to the sample file and the recorded review.", tone: "ok" });
  }, [commit, setSelectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);
      if (typing) return;
      if (showRequest || showHelp) {
        if (event.key === "Escape") {
          setShowRequest(false);
          setShowHelp(false);
        }
        return;
      }
      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          break;
        case "a":
          doApprove();
          break;
        case "e":
          event.preventDefault();
          startEdit();
          break;
        case "r":
          doRequest();
          break;
        case "g":
          setShowJournal((v) => !v);
          break;
        case "?":
          setShowHelp(true);
          break;
        case "Enter":
          if (selectedId) setMobileDetail(true);
          break;
        case "Escape":
          setEditing(false);
          setMobileDetail(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, doApprove, startEdit, doRequest, showRequest, showHelp, selectedId]);

  const count = documentCount(state);
  const check = canApproveFile(state);
  const childName = `${state.submission.answers.child_last_name ?? ""}, ${state.submission.answers.child_first_name ?? ""}`.replace(/^, |, $/g, "");
  const openRequestItems = state.request?.items.filter((i) => !i.satisfiedAt).length ?? 0;
  const draftLabel =
    state.draft.origin === "live" ? `Live draft, computed ${formatWhen(state.draft.computedAt)}` : `Recorded review of ${formatDay(state.draft.computedAt)}`;
  const evidence = selected?.evidence[activeEvidence] ?? selected?.evidence[0] ?? null;

  return (
    <div className="flex min-h-full flex-col bg-paper">
      <TopBanner text={t.bannerTop} />
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 md:px-5">
          <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5" />
            <span className="hidden sm:inline">Sample Behavioral Health</span>
            <span className="sm:hidden">Home</span>
          </Link>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[14px] font-semibold text-ink">{childName}</span>
            <span className="text-[12.5px] text-ink-3">
              {state.submission.reference} · v{state.version}
            </span>
            <span className={`pill ${STAGE_TONE[state.stage]}`}>{STAGE_LABELS[state.stage]}</span>
            <span className="hidden text-[12.5px] text-ink-3 md:inline">
              {count.received} received of {count.requested}
            </span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void runAgain()}
              disabled={running}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-[12.5px] font-semibold text-ink hover:bg-muted disabled:opacity-60"
              title="Run the two model calls again on the sample media"
            >
              <RefreshCw className={`size-3.5 ${running ? "animate-spin" : ""}`} />
              {running ? "Running…" : "Run again"}
            </button>
            <button
              type="button"
              onClick={() => setShowRequest(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-[12.5px] font-semibold text-ink hover:bg-muted"
            >
              <Send className="size-3.5" />
              Request{openRequestItems > 0 ? ` (${openRequestItems})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setShowJournal((v) => !v)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold ${showJournal ? "border-brand bg-brand-mist text-brand-strong" : "border-line bg-white text-ink hover:bg-muted"}`}
              aria-label="Journal"
            >
              <BookOpen className="size-3.5" />
              <span className="hidden sm:inline">Journal</span>
            </button>
            <button type="button" onClick={() => setShowHelp(true)} className="inline-flex size-8 items-center justify-center rounded-lg border border-line bg-white text-ink hover:bg-muted" aria-label="Keyboard shortcuts">
              <HelpCircle className="size-4" />
            </button>
            <button type="button" onClick={reset} className="inline-flex size-8 items-center justify-center rounded-lg border border-line bg-white text-ink-3 hover:bg-muted" aria-label="Reset to the sample" title={isSampleSubmission(state.submission) ? "Reset the sample review" : "Back to the sample file"}>
              <RotateCcw className="size-4" />
            </button>
          </div>
          <p className="basis-full text-[12px] text-ink-3" data-testid="draft-origin">
            {draftLabel}
            {state.draft.origin === "recorded" ? ": served as stored, no model call was made to show it." : ": the two model calls ran on the sample media for this view."}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-4 md:px-5">
        <div className="grid gap-4 md:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_minmax(0,0.95fr)]">
          <aside className={`surface-flat overflow-hidden md:max-h-[calc(100vh-256px)] md:overflow-y-auto ${mobileDetail ? "hidden md:block" : ""}`}>
            <PropositionList propositions={state.propositions} selectedId={selectedId} onSelect={(id) => select(id, true)} />
          </aside>

          <section className={`surface-flat p-4 md:max-h-[calc(100vh-256px)] md:overflow-y-auto md:p-5 ${mobileDetail ? "" : "hidden md:block"}`}>
            <button type="button" onClick={() => setMobileDetail(false)} className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-ink-3 md:hidden">
              <ChevronLeft className="size-4" />
              All {state.propositions.length} propositions
            </button>
            {selected ? (
              <PropositionDetail
                proposition={selected}
                request={state.request}
                editing={editing}
                editText={editText}
                onEditText={setEditText}
                onStartEdit={startEdit}
                onSaveEdit={saveEdit}
                onCancelEdit={() => setEditing(false)}
                onApprove={doApprove}
                onAddToRequest={doRequest}
                onOpenRequest={() => setShowRequest(true)}
                activeEvidence={Math.min(activeEvidence, Math.max(0, selected.evidence.length - 1))}
                onSelectEvidence={setActiveEvidence}
              />
            ) : (
              <p className="text-[13px] text-ink-3">Select a proposition.</p>
            )}
          </section>

          <section className={`surface-flat p-4 md:col-span-2 md:max-h-[calc(100vh-256px)] md:overflow-y-auto md:p-5 xl:col-span-1 ${mobileDetail ? "" : "hidden md:block"}`}>
            <SourcePane evidence={evidence} state={state} />
          </section>
        </div>

        <div className={`surface-flat mt-4 flex flex-wrap items-center gap-3 p-4 ${mobileDetail ? "hidden md:flex" : ""}`}>
          <div className="min-w-0 flex-1">
            {state.approval && !state.approval.detached ? (
              <p className="text-[13.5px] text-ink">
                <span className="font-semibold text-green-ink">Version {state.approval.version} approved</span> by the reviewer at {formatWhen(state.approval.at)}.{" "}
                <span className="text-ink-3">Stage: {STAGE_LABELS[state.stage]}. Content {state.approval.hash.slice(0, 16)}.</span>
              </p>
            ) : (
              <p className="text-[13.5px] text-ink-2">
                {check.ok ? (
                  <>Everything is reviewed. Approving names version {state.version} and moves the file to its next administrative step.</>
                ) : (
                  <>
                    <span className="font-semibold text-ink">Before the file can be approved:</span> {check.reasons.join(" ")}
                  </>
                )}
                {state.approvalHistory.length > 0 && (
                  <span className="text-ink-3"> An earlier approval (version {state.approvalHistory[state.approvalHistory.length - 1].version}) was detached; see the journal.</span>
                )}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={doApproveFile}
            disabled={!check.ok}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-[13.5px] font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
          >
            Approve file · version {state.version}
          </button>
        </div>

        {showJournal && (
          <div className="surface-flat mt-4 p-4">
            <JournalPanel state={state} />
          </div>
        )}

        <p className="mt-6 text-center text-[12px] text-ink-3">
          {t.sampleOnly} · Reviewer actions are kept on this device. · Press <Kbd>?</Kbd> for the keyboard.
        </p>
      </main>

      <RequestDialog open={showRequest} onOpenChange={setShowRequest} request={state.request} onApprove={doApproveRequest} onEdit={doEditRequest} />
      <HelpDialog open={showHelp} onOpenChange={setShowHelp} />

      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 left-1/2 z-40 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl border px-4 py-3 text-[13.5px] shadow-lg ${
            toast.tone === "ok" ? "border-green-soft bg-white text-ink" : "border-amber-soft bg-white text-amber-ink"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
