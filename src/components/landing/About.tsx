import { RECORDED_DRAFT } from "@/lib/review-store";

function recordedOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const COLUMNS = (recorded: string) => [
  {
    title: "What runs for real",
    lines: [
      "Transcription of the sample recording by a Google model, and extraction from the sample documents and the transcript by an Anthropic model, on request.",
      "Every quote is checked against the document text, every value against its quote, every date against the passage. Every audio segment is located from the quoted words within the timestamps the transcription returned, and checked against the length of the recording. Days, hours, places and negations are checked in the quoted words. What fails is listed as not evaluable, never shown as a fact.",
      "The wording of a rephrased statement is the model's: the reviewer judges it against the recording. Whether a recording was cut off is what the transcription reports; the code does not detect that on its own.",
      `The review shown first was recorded on ${recorded}. The button in the reviewer view runs it again, under a daily cap. When the cap is reached, the recorded review stays available and says it is recorded.`,
    ],
  },
  {
    title: "What stays on your device",
    lines: [
      "The camera and microphone check in the intake flow records on your device and sends nothing.",
      "Form progress and the reviewer's actions are kept on your device, not on a server. Saving the form sends nothing.",
    ],
  },
  {
    title: "What this sample does not do",
    lines: [
      "No upload of your own files: the server processes only the sample media the page provides.",
      "No cross-device resume, no messages sent, no accounts or roles, no multi-tenant setup.",
      "No clinical assessment of any kind. The checks are administrative: received, readable, consistent.",
    ],
  },
  {
    title: "Before any patient data",
    lines: [
      "Signed agreements with every processor, including the model providers. Storage with signed URLs and an access log. Encryption at rest and in transit. Role-based access and retention rules.",
      "None of that is claimed here. This page proves the processing of one sample and a local capture.",
    ],
  },
];

export function About() {
  const columns = COLUMNS(recordedOn(RECORDED_DRAFT.computedAt));
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-6xl px-5 py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="eyebrow">About this sample</p>
          <h2 className="mt-4 text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink md:text-[40px]">
            What is real here, and what is not.
          </h2>
        </div>
        <div className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-2">
          {columns.map((column) => (
            <div key={column.title}>
              <h3 className="text-[15px] font-semibold uppercase tracking-[0.08em] text-brand-strong">{column.title}</h3>
              <ul className="mt-4 space-y-3">
                {column.lines.map((line) => (
                  <li key={line} className="flex gap-3 text-[15.5px] leading-[1.65] text-ink-2">
                    <span className="mt-[11px] size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-16 max-w-2xl text-[17px] leading-[1.6] text-ink">
          This sample demonstrates one workflow. Your existing prototypes would inform the production scope.
        </p>
      </div>
    </section>
  );
}
