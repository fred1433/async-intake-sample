export function SiteFooter({ note }: { note: string }) {
  return (
    <footer className="mt-auto w-full border-t border-line bg-white/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-[13px] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-medium text-ink-2">{note}</p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            Built by{" "}
            <a href="https://theaipipe.com" className="font-medium text-ink-2 underline-offset-4 hover:underline">
              The AI Pipe
            </a>
          </span>
          <a href="https://github.com/fred1433/async-intake-sample" className="underline-offset-4 hover:underline">
            Source
          </a>
        </p>
      </div>
    </footer>
  );
}
