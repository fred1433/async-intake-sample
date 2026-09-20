"use client";

/**
 * The original next to the claim: the document page with the passage marked,
 * the audio segment with its start and end, or the form answer as entered.
 */
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Pause, Play } from "lucide-react";
import type { Evidence, ReviewState } from "@/lib/engine/types";
import { normalize } from "@/lib/engine/verify";
import { dict } from "@/lib/i18n";
import { MEDIA, type SampleDocument, type SampleRecording } from "@/lib/sample";
import { formatSeconds } from "./bits";

function Highlighted({ text, quote }: { text: string; quote: string }) {
  if (!quote) return <>{text}</>;
  const hay = normalize(text);
  const needle = normalize(quote);
  const at = hay.indexOf(needle);
  if (at === -1 || needle.length === 0) return <>{text}</>;
  // normalize() only folds case and collapses spaces on this text layer, so the
  // offsets line up once the same collapse is applied to the original.
  const collapsed = text.replace(/\s+/g, " ").trim();
  const start = collapsed.toLowerCase().indexOf(needle);
  if (start === -1) return <>{text}</>;
  const end = start + needle.length;
  return (
    <>
      {collapsed.slice(0, start)}
      <mark className="quote">{collapsed.slice(start, end)}</mark>
      {collapsed.slice(end)}
    </>
  );
}

const BLOCK_CLASS: Record<string, string> = {
  letterhead: "text-[17px] font-bold text-[#2b3a4a] font-serif",
  "letterhead-sub": "text-[10.5px] text-ink-3 mb-4 pb-3 border-b-2 border-[#2b3a4a]/60",
  date: "text-[12.5px] mb-4 font-serif",
  meta: "text-[12.5px] font-serif",
  para: "text-[12.5px] leading-[1.6] mt-3 font-serif",
  signature: "text-[12.5px] italic mt-5 font-serif",
  "signature-sub": "text-[10.5px] text-ink-3",
  "card-brand": "text-[16px] font-bold text-[#1d4e89]",
  "card-line": "text-[13px] mt-1",
  "card-small": "text-[10.5px] text-ink-3 mt-3",
};

function DocumentView({ doc, page, quote }: { doc: SampleDocument; page: number; quote: string }) {
  const current = doc.pages.find((p) => p.number === page) ?? doc.pages[0];
  const isCard = doc.id === "insurance-card";
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-ink">
          {doc.title}
          <span className="ml-2 font-normal text-ink-3">
            page {current.number} of {doc.pages.length}
            {current.label ? ` · ${current.label.toLowerCase()}` : ""}
          </span>
        </p>
        <a href={doc.file} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-strong hover:underline underline-offset-4">
          Open the file
          <ExternalLink className="size-3.5" />
        </a>
      </div>
      <div className={`paper-page mt-3 rounded-lg ${isCard ? "p-4" : "p-5 md:p-7"}`}>
        {current.blocks.map((block) => (
          <p key={block.id} className={BLOCK_CLASS[block.style] ?? "text-[12.5px]"}>
            <Highlighted text={block.text} quote={quote} />
          </p>
        ))}
      </div>
      {!quote && <p className="mt-2 text-[12px] text-ink-3">The whole page is the source of this item.</p>}
    </div>
  );
}

function AudioSegment({ recording, start, end, quote, transcript }: { recording: SampleRecording; start: number; end: number; quote: string; transcript: ReviewState["draft"]["recordings"][number]["transcript"] }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<"segment" | "all" | null>(null);
  const [position, setPosition] = useState(0);
  const segmentEnd = end > start ? end : recording.durationSeconds;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setPosition(audio.currentTime);
      if (playing === "segment" && audio.currentTime >= segmentEnd) {
        audio.pause();
        setPlaying(null);
      }
    };
    const onEnded = () => setPlaying(null);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, [playing, segmentEnd]);

  const play = async (mode: "segment" | "all") => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing === mode) {
      audio.pause();
      setPlaying(null);
      return;
    }
    audio.currentTime = mode === "segment" ? start : 0;
    setPlaying(mode);
    try {
      await audio.play();
    } catch {
      setPlaying(null);
    }
  };

  const total = recording.durationSeconds || 1;
  const left = (start / total) * 100;
  const width = ((segmentEnd - start) / total) * 100;
  const head = Math.min(100, (position / total) * 100);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-ink">
          {recording.title}
          <span className="ml-2 font-normal text-ink-3">
            {formatSeconds(start)} to {formatSeconds(segmentEnd)}
          </span>
        </p>
        <span className="text-[12px] text-ink-3">{formatSeconds(recording.durationSeconds)} total</span>
      </div>
      <audio ref={audioRef} src={recording.file} preload="metadata" />
      <div className="surface-flat mt-3 p-4">
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-line">
          <div className="absolute top-0 h-full rounded-full bg-amber-soft" style={{ left: `${left}%`, width: `${width}%` }} />
          <div className="absolute top-0 h-full rounded-full bg-brand/70" style={{ left: `${left}%`, width: `${Math.max(0, Math.min(width, head - left))}%` }} />
          <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-ink shadow" style={{ left: `${head}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void play("segment")} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-[13px] font-semibold text-white">
            {playing === "segment" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            Play segment
          </button>
          <button type="button" onClick={() => void play("all")} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[13px] font-semibold text-ink">
            {playing === "all" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            Play all
          </button>
          <span className="ml-auto text-[12px] tabular-nums text-ink-3">{formatSeconds(position)}</span>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {transcript.segments.map((segment) => {
          const inWindow = segment.end > start && segment.start < segmentEnd;
          return (
            <p key={`${segment.start}-${segment.end}`} className={`rounded-lg px-2.5 py-1.5 text-[13px] leading-[1.55] ${inWindow ? "bg-brand-mist text-ink" : "text-ink-3"}`}>
              <span className="mr-2 tabular-nums text-[11.5px] text-ink-3">{formatSeconds(segment.start)}</span>
              {inWindow ? <Highlighted text={segment.text} quote={quote} /> : segment.text}
            </p>
          );
        })}
        {transcript.unusable && <p className="text-[12.5px] text-amber-ink">Transcription note: {transcript.unusable}</p>}
      </div>
    </div>
  );
}

function FormAnswer({ questionId, value }: { questionId: string; value: string }) {
  const t = dict("en");
  const label = t.fields[questionId] ?? (questionId.startsWith("documents.") ? t.documents[questionId.slice(10)] : questionId.startsWith("recordings.") ? "Recorded answer" : questionId);
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink">Intake form, as entered by the parent</p>
      <div className="surface-flat mt-3 p-4">
        <p className="text-[12.5px] text-ink-3">{label}</p>
        <p className="mt-1 text-[15px] font-medium text-ink">{value}</p>
      </div>
    </div>
  );
}

export function SourcePane({ evidence, state, empty }: { evidence: Evidence | null; state: ReviewState; empty?: string }) {
  if (!evidence) {
    return <p className="text-[13px] text-ink-3">{empty ?? "Select a proposition to see its source."}</p>;
  }
  if (evidence.kind === "form") return <FormAnswer questionId={evidence.questionId} value={evidence.value} />;
  const media = MEDIA[evidence.mediaId];
  if (!media) return <p className="text-[13px] text-ink-3">Source not available.</p>;
  if (evidence.kind === "document" && media.kind === "document") return <DocumentView doc={media} page={evidence.page} quote={evidence.quote} />;
  if (evidence.kind === "audio" && media.kind === "recording") {
    const review = state.draft.recordings.find((r) => r.mediaId === media.id);
    const transcript = review?.transcript ?? { mediaId: media.id, segments: [], unusable: null };
    return <AudioSegment key={`${media.id}-${evidence.start}-${evidence.end}`} recording={media} start={evidence.start} end={evidence.end} quote={evidence.quote} transcript={transcript} />;
  }
  return <p className="text-[13px] text-ink-3">Source not available.</p>;
}
