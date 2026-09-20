"use client";

/**
 * The parent's side: a guided form, two document items, one recorded prompt, a
 * signature, then review and save. Progress is kept on this device under a
 * code. The only files that can be attached are the sample files the page
 * provides; nothing of the visitor's is uploaded, and saving sends nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, FileText, Mic, Paperclip, X } from "lucide-react";
import type { FieldValue, Lang, Submission } from "@/lib/engine/types";
import { dict, type Dict } from "@/lib/i18n";
import { sampleIntakeDraft, STEPS, submissionFromDraft, switchDraftLanguage, type IntakeDraft, type StepId } from "@/lib/intake-draft";
import { MEDIA, SAMPLE_REFERENCE, SAMPLE_SUBMISSION } from "@/lib/sample";
import { INTAKE_PREFIX, LANG_KEY, loadJSON, newResumeCode, saveJSON, SUBMISSION_KEY } from "@/lib/storage";
import { documentItems, promptQuestions, TEMPLATE, type FieldQuestion } from "@/lib/template";
import { TopBanner } from "@/components/site/TopBanner";
import { DeviceCheck } from "./DeviceCheck";
import { SignaturePad } from "./SignaturePad";

function freshDraft(lang: Lang): IntakeDraft {
  return {
    code: newResumeCode(),
    lang,
    step: 0,
    answers: structuredClone(SAMPLE_SUBMISSION.answers),
    documents: Object.fromEntries(documentItems(TEMPLATE).map((d) => [d.id, { status: "missing" as const }])),
    recordings: Object.fromEntries(promptQuestions(TEMPLATE).map((p) => [p.id, { status: "missing" as const }])),
    startedAt: new Date().toISOString(),
  };
}

const inputClass =
  "mt-1.5 block h-12 w-full rounded-xl border border-input bg-white px-3.5 text-[16px] text-ink outline-none transition-shadow focus:border-brand focus:ring-3 focus:ring-brand/20";

function IntakeShell({
  t,
  topRef,
  onSwitchLang,
  children,
}: {
  t: Dict;
  topRef: React.RefObject<HTMLDivElement | null>;
  onSwitchLang: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col bg-paper">
      <TopBanner text={t.bannerTop} />
      <div ref={topRef} className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-16 pt-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-brand text-white text-[13px] font-bold">S</span>
            <span className="text-[14.5px] font-semibold text-ink">{t.org}</span>
          </Link>
          <button type="button" onClick={onSwitchLang} className="pill pill-neutral hover:bg-brand-soft hover:text-brand-strong" aria-label={t.switchTo}>
            {t.switchTo}
          </button>
        </div>
        {children}
        <p className="mt-10 text-center text-[12px] text-ink-3">{t.sampleOnly}</p>
      </div>
    </div>
  );
}

export function IntakeFlow() {
  const [draft, setDraft] = useState<IntakeDraft | null>(null);
  const [lang, setLang] = useState<Lang>(() => {
    const stored = loadJSON<Lang>(LANG_KEY);
    return stored === "en" || stored === "es" ? stored : "en";
  });
  const [resumeCode, setResumeCode] = useState("");
  const [resumeError, setResumeError] = useState(false);
  const [saved, setSaved] = useState<{ reference: string; version: number } | null>(null);
  const [prepDeadline, setPrepDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const t: Dict = dict(lang);
  const topRef = useRef<HTMLDivElement | null>(null);

  // The screen language only. The language of the messages is the parent's own answer on the form.
  const switchLang = () => {
    const next: Lang = lang === "en" ? "es" : "en";
    setLang(next);
    saveJSON(LANG_KEY, next);
    if (draft) update(switchDraftLanguage(draft, next));
  };

  const update = useCallback(
    (patch: Partial<IntakeDraft>) => {
      setDraft((current) => {
        if (!current) return current;
        const next = { ...current, ...patch };
        saveJSON(INTAKE_PREFIX + next.code, next);
        return next;
      });
    },
    [],
  );

  const start = () => {
    const fresh = freshDraft(lang);
    fresh.answers.contact_language = lang;
    saveJSON(INTAKE_PREFIX + fresh.code, fresh);
    setDraft(fresh);
    setSaved(null);
  };

  const resume = () => {
    const code = resumeCode.trim().toUpperCase();
    let found = loadJSON<IntakeDraft>(INTAKE_PREFIX + code);
    // The sample file's form is always resumable: it is the one the reviewer view shows.
    if (!found && code === SAMPLE_REFERENCE) {
      found = sampleIntakeDraft();
      saveJSON(INTAKE_PREFIX + code, found);
    }
    if (!found) {
      setResumeError(true);
      return;
    }
    setResumeError(false);
    setLang(found.lang);
    setDraft({ ...found, step: Math.min(found.step, STEPS.length - 1) });
    setSaved(null);
  };

  const stepId: StepId | null = draft ? STEPS[draft.step] : null;

  useEffect(() => {
    topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [draft?.step, saved]);

  // Preparation time of the recorded prompt: a deadline set when the step opens, a clock that ticks.
  useEffect(() => {
    if (stepId !== "recorded") return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [stepId]);
  const prepLeft = stepId === "recorded" && prepDeadline !== null ? Math.max(0, Math.ceil((prepDeadline - now) / 1000)) : null;

  const goToStep = useCallback(
    (step: number) => {
      const patch: Partial<IntakeDraft> = { step };
      if (STEPS[step] === "recorded") {
        const opened = Date.now();
        setPrepDeadline(opened + promptQuestions(TEMPLATE)[0].prepSeconds * 1000);
        setNow(opened);
      }
      setDraft((current) => {
        if (!current) return current;
        // The signature step shows the parent's name typed in: that typed name is the signature until it is changed or drawn over.
        if (STEPS[step] === "signature" && !current.signature) {
          patch.signature = { name: ((current.answers.guardian_name as string) ?? "").trim(), signedAt: new Date().toISOString(), ink: false };
        }
        const next = { ...current, ...patch };
        saveJSON(INTAKE_PREFIX + next.code, next);
        return next;
      });
    },
    [],
  );

  const sectionFields = (section: string) => TEMPLATE.sections.find((s) => s.id === section)?.questions?.filter((q): q is FieldQuestion => q.kind === "field") ?? [];

  const requiredMissing = (section: StepId): string[] =>
    sectionFields(section)
      .filter((q) => q.required)
      .filter((q) => {
        const v = draft?.answers[q.id];
        return !v || (Array.isArray(v) && v.length === 0);
      })
      .map((q) => q.id);

  const canContinue = (): boolean => {
    if (!draft || !stepId) return false;
    if (stepId === "child" || stepId === "guardian") return requiredMissing(stepId).length === 0;
    if (stepId === "signature") return Boolean(draft.signature?.name?.trim());
    return true;
  };

  const save = () => {
    if (!draft) return;
    const nowIso = new Date().toISOString();
    const submission: Submission = submissionFromDraft(draft, loadJSON<Submission>(SUBMISSION_KEY), nowIso);
    saveJSON(SUBMISSION_KEY, submission);
    update({ submittedVersion: submission.version, submittedAt: nowIso, step: STEPS.length - 1 });
    setSaved({ reference: draft.code, version: submission.version });
  };

  const setAnswer = (id: string, value: FieldValue) => draft && update({ answers: { ...draft.answers, [id]: value } });

  const renderField = (q: FieldQuestion) => {
    if (!draft) return null;
    const label = t.fields[q.id] ?? q.id;
    const value = draft.answers[q.id];
    if (q.type === "multi") {
      const selected = Array.isArray(value) ? value : [];
      return (
        <fieldset key={q.id}>
          <legend className="text-[14px] font-medium text-ink-2">{label}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(q.options ?? []).map((option) => {
              const on = selected.includes(option);
              return (
                <label
                  key={option}
                  className={`flex h-12 cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 text-[15px] ${on ? "border-brand bg-brand-mist text-brand-strong" : "border-input bg-white text-ink"}`}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--brand)]"
                    checked={on}
                    onChange={(e) => setAnswer(q.id, e.target.checked ? [...selected, option] : selected.filter((x) => x !== option))}
                  />
                  {t.options[option] ?? option}
                </label>
              );
            })}
          </div>
        </fieldset>
      );
    }
    if (q.type === "select") {
      return (
        <label key={q.id} className="block">
          <span className="text-[14px] font-medium text-ink-2">{label}</span>
          <select className={inputClass} value={typeof value === "string" ? value : ""} onChange={(e) => setAnswer(q.id, e.target.value)}>
            {(q.options ?? []).map((option) => (
              <option key={option} value={option}>
                {t.options[option] ?? option}
              </option>
            ))}
          </select>
        </label>
      );
    }
    return (
      <label key={q.id} className="block">
        <span className="text-[14px] font-medium text-ink-2">
          {label}
          {q.required ? "" : <span className="ml-1.5 text-[12px] font-normal text-ink-3">({t.optional.toLowerCase()})</span>}
        </span>
        <input
          type={q.type}
          className={inputClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setAnswer(q.id, e.target.value)}
          autoComplete="off"
        />
      </label>
    );
  };

  if (saved && draft) {
    return (
      <IntakeShell t={t} topRef={topRef} onSwitchLang={switchLang}>
        <div className="surface mt-10 p-7 text-center">
          <div className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-green-soft text-green-ink">
            <Check className="size-6" />
          </div>
          <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.02em] text-ink">{t.review.sentTitle}</h1>
          <p className="mt-3 text-[15px] leading-[1.6] text-ink-2">{t.review.sentIntro(saved.reference)}</p>
          <Link
            href="/review"
            className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-semibold text-white hover:bg-brand-strong"
          >
            {t.review.openReview}
            <ArrowRight className="size-4" />
          </Link>
          <button type="button" onClick={() => { setSaved(null); setDraft(null); }} className="mt-4 text-[14px] font-medium text-ink-3 underline-offset-4 hover:underline">
            {t.review.startOver}
          </button>
        </div>
      </IntakeShell>
    );
  }

  if (!draft) {
    return (
      <IntakeShell t={t} topRef={topRef} onSwitchLang={switchLang}>
        <div className="mt-12">
          <p className="eyebrow">{t.org}</p>
          <h1 className="mt-3 text-[34px] font-semibold leading-[1.08] tracking-[-0.025em] text-ink">{t.intakeTitle}</h1>
          <p className="mt-4 text-[16px] leading-[1.6] text-ink-2">{t.intakeIntro}</p>
          <button
            type="button"
            onClick={start}
            className="mt-8 inline-flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-brand text-[16px] font-semibold text-white hover:bg-brand-strong"
          >
            {t.start}
            <ArrowRight className="size-4" />
          </button>
          <div className="mt-10 surface-flat p-5">
            <p className="text-[14.5px] font-semibold text-ink">{t.resume}</p>
            <div className="mt-3 flex gap-2">
              <input
                value={resumeCode}
                onChange={(e) => setResumeCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") resume();
                }}
                placeholder={t.resumePlaceholder}
                className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-white px-3.5 text-[16px] uppercase tracking-wider outline-none placeholder:normal-case placeholder:tracking-normal focus:border-brand focus:ring-3 focus:ring-brand/20"
                autoCapitalize="characters"
                autoComplete="off"
              />
              <button type="button" onClick={resume} className="h-12 shrink-0 rounded-xl border border-line bg-white px-4 text-[14px] font-semibold text-ink">
                OK
              </button>
            </div>
            {resumeError && <p className="mt-2 text-[13px] text-rose-ink">{t.resumeNotFound}</p>}
            <p className="mt-3 text-[12.5px] leading-[1.5] text-ink-3">{t.resumeHelp}</p>
          </div>
        </div>
      </IntakeShell>
    );
  }

  const section = t.sections[stepId as keyof typeof t.sections];
  const prompt = promptQuestions(TEMPLATE)[0];
  const stepNumber = draft.step + 1;

  return (
    <IntakeShell t={t} topRef={topRef} onSwitchLang={switchLang}>
      <div className="mt-8">
        <span className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-brand-strong">{t.stepOf(stepNumber, STEPS.length)}</span>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(stepNumber / STEPS.length) * 100}%` }} />
      </div>

      <h1 className="mt-7 text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">{section.title}</h1>
      <p className="mt-2 text-[15px] leading-[1.55] text-ink-2">{section.intro}</p>
      {draft.step === 0 && <p className="mt-3 inline-block rounded-lg bg-brand-mist px-3 py-1.5 text-[13px] text-brand-strong">{t.sampleFilled}</p>}

      <div className="mt-7 space-y-5">
        {(stepId === "child" || stepId === "guardian" || stepId === "scheduling") && sectionFields(stepId).map(renderField)}

        {stepId === "documents" && (
          <>
            {documentItems(TEMPLATE).map((item) => {
              const slot = draft.documents[item.id];
              const media = item.sampleMediaId ? MEDIA[item.sampleMediaId] : undefined;
              return (
                <div key={item.id} className="surface-flat p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-mist text-brand-strong">
                        <FileText className="size-4" />
                      </span>
                      <div>
                        <p className="text-[15px] font-semibold leading-snug text-ink">{t.documents[item.id]}</p>
                        <p className="mt-0.5 text-[12.5px] text-ink-3">{item.required ? t.required : t.optional}</p>
                      </div>
                    </div>
                    {slot?.status === "received" ? <span className="pill pill-green">{t.docAttached}</span> : null}
                  </div>
                  {slot?.status === "received" && media && media.kind === "document" ? (
                    <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-paper p-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={media.file} alt="" className="h-14 w-11 rounded-md border border-line object-cover object-top" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium text-ink">{t.media[media.id] ?? media.title}</p>
                        <p className="text-[12px] text-ink-3">{t.pages(media.pages.length)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => update({ documents: { ...draft.documents, [item.id]: { status: "missing" } } })}
                        className="inline-flex size-9 items-center justify-center rounded-lg text-ink-3 hover:bg-muted"
                        aria-label={t.docRemove}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => update({ documents: { ...draft.documents, [item.id]: { status: "received", mediaId: item.sampleMediaId, receivedAt: new Date().toISOString() } } })}
                        className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-4 text-[14px] font-semibold text-white"
                      >
                        <Paperclip className="size-4" />
                        {t.docAttachSample}
                      </button>
                      <span className="inline-flex h-11 items-center rounded-xl px-2 text-[13.5px] text-ink-3">{t.docSkipped}</span>
                    </div>
                  )}
                  {item.id === "insurance_card" && slot?.status !== "received" && <p className="mt-3 text-[12.5px] leading-[1.5] text-ink-3">{t.docHintMissing}</p>}
                </div>
              );
            })}
            <p className="text-[12.5px] leading-[1.5] text-ink-3">{t.docNoUpload}</p>
          </>
        )}

        {stepId === "recorded" && (
          <>
            <div className="surface-flat p-4">
              <p className="text-[16px] font-medium leading-[1.5] text-ink">{t.prompt.question}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-3">
                <span>{prepLeft && prepLeft > 0 ? t.prompt.prep(prepLeft) : t.prompt.deviceNote}</span>
                {prepLeft && prepLeft > 0 ? (
                  <button type="button" onClick={() => setPrepDeadline(Date.now())} className="font-medium text-brand-strong underline-offset-4 hover:underline">
                    {t.prompt.skipPrep}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="surface-flat p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[15px] font-semibold text-ink">{t.prompt.sampleTitle}</p>
                  <p className="mt-1 text-[13.5px] leading-[1.55] text-ink-3">{t.prompt.sampleHelp}</p>
                </div>
                <span className="pill pill-brand shrink-0">{t.prompt.sampleBadge}</span>
              </div>
              <audio controls preload="metadata" src={MEDIA[prompt.sampleMediaId].file} className="mt-4 w-full" />
              {draft.recordings[prompt.id]?.status === "received" ? (
                <p className="mt-3 inline-flex items-center gap-2 text-[13.5px] font-medium text-green-ink">
                  <Check className="size-4" />
                  {t.prompt.sampleUsed}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => update({ recordings: { ...draft.recordings, [prompt.id]: { status: "received", mediaId: prompt.sampleMediaId, durationSeconds: (MEDIA[prompt.sampleMediaId] as { durationSeconds: number }).durationSeconds } } })}
                  className="mt-3 inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-4 text-[14px] font-semibold text-white"
                >
                  <Mic className="size-4" />
                  {t.prompt.useSample}
                </button>
              )}
            </div>

            <DeviceCheck t={t} enabled={prepLeft === 0 || prepLeft === null} />
          </>
        )}

        {stepId === "signature" && (
          <>
            <p className="rounded-xl border border-line bg-white p-4 text-[14.5px] leading-[1.6] text-ink-2">{t.signature.statement}</p>
            <SignaturePad
              label={t.signature.draw}
              clearLabel={t.signature.clear}
              onChange={(ink) => update({ signature: { name: draft.signature?.name ?? (draft.answers.guardian_name as string) ?? "", signedAt: new Date().toISOString(), ink } })}
            />
            <label className="block">
              <span className="text-[14px] font-medium text-ink-2">{t.signature.typedName}</span>
              <input
                type="text"
                className={inputClass}
                value={draft.signature?.name ?? ""}
                onChange={(e) => update({ signature: { name: e.target.value, signedAt: new Date().toISOString(), ink: draft.signature?.ink ?? false } })}
              />
            </label>
            <p className="text-[13px] text-ink-3">
              {t.signature.date}: {new Date().toLocaleDateString(lang === "es" ? "es-US" : "en-US", { year: "numeric", month: "long", day: "numeric" })}
            </p>
          </>
        )}

        {stepId === "review" && (
          <div className="surface-flat divide-y divide-line">
            {(["child", "guardian", "scheduling"] as const).map((sectionId, index) => (
              <div key={sectionId} className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3">{t.sections[sectionId].title}</p>
                  <button type="button" onClick={() => goToStep(index)} className="text-[13px] font-medium text-brand-strong">
                    {t.review.edit}
                  </button>
                </div>
                <dl className="mt-2 space-y-1">
                  {sectionFields(sectionId).map((q) => {
                    const v = draft.answers[q.id];
                    const text = Array.isArray(v) ? v.map((x) => t.options[x] ?? x).join(", ") : typeof v === "string" ? (t.options[v] ?? v) : "";
                    return (
                      <div key={q.id} className="flex justify-between gap-4 text-[14px]">
                        <dt className="text-ink-3">{t.fields[q.id]}</dt>
                        <dd className="text-right font-medium text-ink">{text || " "}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ))}
            <div className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3">{t.sections.documents.title}</p>
                <button type="button" onClick={() => goToStep(3)} className="text-[13px] font-medium text-brand-strong">
                  {t.review.edit}
                </button>
              </div>
              <ul className="mt-2 space-y-1">
                {documentItems(TEMPLATE).map((item) => (
                  <li key={item.id} className="flex justify-between gap-4 text-[14px]">
                    <span className="text-ink-3">{t.documents[item.id]}</span>
                    <span className={`font-medium ${draft.documents[item.id]?.status === "received" ? "text-green-ink" : "text-amber-ink"}`}>
                      {draft.documents[item.id]?.status === "received" ? t.review.attached : t.review.missing}
                    </span>
                  </li>
                ))}
                <li className="flex justify-between gap-4 text-[14px]">
                  <span className="text-ink-3">{t.sections.recorded.title}</span>
                  <span className={`font-medium ${draft.recordings[prompt.id]?.status === "received" ? "text-green-ink" : "text-amber-ink"}`}>
                    {draft.recordings[prompt.id]?.status === "received" ? t.review.recordedAttached : t.review.recordedMissing}
                  </span>
                </li>
                <li className="flex justify-between gap-4 text-[14px]">
                  <span className="text-ink-3">{t.sections.signature.title}</span>
                  <span className={`font-medium ${draft.signature?.name ? "text-green-ink" : "text-amber-ink"}`}>{draft.signature?.name ? t.review.signed : t.review.notSigned}</span>
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center gap-3">
        {draft.step > 0 && (
          <button type="button" onClick={() => goToStep(draft.step - 1)} className="inline-flex h-12 items-center gap-2 rounded-xl border border-line bg-white px-4 text-[15px] font-semibold text-ink">
            <ArrowLeft className="size-4" />
            {t.back}
          </button>
        )}
        {stepId === "review" ? (
          <button type="button" onClick={save} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-semibold text-white hover:bg-brand-strong">
            {t.review.submit}
            <ArrowRight className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={!canContinue()}
            onClick={() => goToStep(draft.step + 1)}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
          >
            {t.next}
            <ArrowRight className="size-4" />
          </button>
        )}
      </div>
      <p className="mt-5 text-center text-[12.5px] leading-[1.6] text-ink-3">
        {t.savedNote} {t.yourCode}: <span className="font-semibold text-ink-2">{draft.code}</span>. {t.yourCodeHelp}
      </p>
    </IntakeShell>
  );
}
