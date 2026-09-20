export function TopBanner({ text }: { text: string }) {
  return (
    <div className="w-full bg-brand-mist border-b border-brand-soft text-brand-strong">
      <p className="mx-auto max-w-6xl px-5 py-2 text-center text-[12.5px] font-medium tracking-wide">{text}</p>
    </div>
  );
}
