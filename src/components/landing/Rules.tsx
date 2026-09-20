import { FileQuestion, GitCompareArrows, CheckCircle2 } from "lucide-react";

const RULES = [
  {
    icon: FileQuestion,
    title: "A required item is missing",
    body: "A request to the family is prepared, in the parent's language. It is not sent.",
    example: "Insurance card: not received",
    tone: "pill-amber",
  },
  {
    icon: GitCompareArrows,
    title: "Two sources disagree",
    body: "The file waits for a reviewer. Nothing is chosen for the family.",
    example: "Form says Thursday. Recording says not Thursdays.",
    tone: "pill-rose",
  },
  {
    icon: CheckCircle2,
    title: "The reviewer approves the current version",
    body: "The file moves to the next administrative step. The journal keeps the approved version.",
    example: "Version 1 approved by the reviewer",
    tone: "pill-green",
  },
];

export function Rules() {
  return (
    <section className="border-t border-line bg-white/50">
      <div className="mx-auto max-w-6xl px-5 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="eyebrow">Workflow rules</p>
          <h2 className="mt-4 text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink md:text-[40px]">
            Three rules, run for real.
          </h2>
          <p className="mt-5 text-[16.5px] leading-[1.65] text-ink-2">
            Each one fires on the sample file. You can watch it happen in the reviewer view, and read what it did in the journal.
          </p>
        </div>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {RULES.map((rule) => (
            <div key={rule.title} className="surface p-6 md:p-7">
              <div className="inline-flex size-10 items-center justify-center rounded-xl bg-brand-mist text-brand-strong">
                <rule.icon className="size-5" />
              </div>
              <h3 className="mt-5 text-[18px] font-semibold tracking-[-0.01em] text-ink">{rule.title}</h3>
              <p className="mt-2 text-[15px] leading-[1.65] text-ink-2">{rule.body}</p>
              <p className="mt-5">
                <span className={`pill ${rule.tone}`}>{rule.example}</span>
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
