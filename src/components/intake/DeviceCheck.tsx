"use client";

/**
 * Camera and microphone check. Everything recorded here stays in this browser:
 * the blob lives in memory, is played back once, and is never uploaded. This is
 * the local half of "in-browser recording"; the processed answer is the sample.
 */
import { useEffect, useRef, useState } from "react";
import { Camera, Square, Play, RotateCcw } from "lucide-react";
import type { Dict } from "@/lib/i18n";

type Phase = "idle" | "asking" | "denied" | "unsupported" | "ready" | "recording" | "recorded";

const MAX_SECONDS = 10;

export function DeviceCheck({ t, enabled }: { t: Dict; enabled: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopStream();
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setPhase("unsupported");
      return;
    }
    setPhase("asking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setPhase("ready");
    } catch {
      setPhase("denied");
    }
  }

  function record() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      setPhase("unsupported");
      return;
    }
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
      setPlaybackUrl(URL.createObjectURL(blob));
      stopStream();
      setPhase("recorded");
    };
    recorder.start();
    setSeconds(0);
    setPhase("recording");
    timerRef.current = window.setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) {
          stop();
          return MAX_SECONDS;
        }
        return s + 1;
      });
    }, 1000);
  }

  function stop() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function retake() {
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    setPlaybackUrl(null);
    setPhase("idle");
    void start();
  }

  return (
    <div className="surface-flat p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold text-ink">{t.prompt.deviceTitle}</p>
          <p className="mt-1 text-[13.5px] leading-[1.55] text-ink-3">{t.prompt.deviceHelp}</p>
        </div>
        <span className="pill pill-neutral shrink-0">{t.prompt.localBadge}</span>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl bg-[#1f1d1a]" style={{ aspectRatio: "4 / 3" }}>
        {phase === "recorded" && playbackUrl ? (
          <video src={playbackUrl} controls playsInline className="h-full w-full object-cover" />
        ) : (
          <video ref={videoRef} muted playsInline autoPlay className={`h-full w-full object-cover ${phase === "ready" || phase === "recording" ? "" : "hidden"}`} />
        )}
        {(phase === "idle" || phase === "asking" || phase === "denied" || phase === "unsupported") && (
          <div className="flex h-full items-center justify-center px-6 text-center text-[13.5px] text-white/70">
            {phase === "asking" ? "…" : phase === "denied" ? t.prompt.deviceDenied : phase === "unsupported" ? t.prompt.deviceUnsupported : ""}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(phase === "idle" || phase === "denied" || phase === "unsupported") && (
          <button
            type="button"
            onClick={() => void start()}
            disabled={!enabled}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-[14px] font-semibold text-ink disabled:opacity-50"
          >
            <Camera className="size-4" />
            {t.prompt.deviceStart}
          </button>
        )}
        {phase === "ready" && (
          <button type="button" onClick={record} className="inline-flex h-11 items-center gap-2 rounded-xl bg-rose-ink px-4 text-[14px] font-semibold text-white">
            <span className="size-2.5 rounded-full bg-white" />
            {t.prompt.deviceRecording} ({MAX_SECONDS}s)
          </button>
        )}
        {phase === "recording" && (
          <button type="button" onClick={stop} className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-4 text-[14px] font-semibold text-white">
            <Square className="size-4" />
            {t.prompt.deviceStop} · {seconds}s
          </button>
        )}
        {phase === "recorded" && (
          <>
            <span className="inline-flex items-center gap-2 text-[13.5px] font-medium text-green-ink">
              <Play className="size-4" />
              {t.prompt.deviceDone}
            </span>
            <button type="button" onClick={retake} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-white px-3 text-[13.5px] font-semibold text-ink">
              <RotateCcw className="size-4" />
              {t.prompt.deviceRetake}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
