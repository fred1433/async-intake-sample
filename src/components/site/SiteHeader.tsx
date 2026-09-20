import Link from "next/link";

export function SiteHeader({ current }: { current?: "home" | "review" | "intake" }) {
  const item = (href: string, label: string, key: "home" | "review" | "intake") => (
    <Link
      href={href}
      className={`whitespace-nowrap text-[13.5px] font-medium transition-colors sm:text-[14px] ${current === key ? "text-ink" : "text-ink-3 hover:text-ink"}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="w-full">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-brand text-white text-[13px] font-bold">S</span>
          <span className="whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] text-ink">
            <span className="sm:hidden">Sample BH</span>
            <span className="hidden sm:inline">Sample Behavioral Health</span>
          </span>
          <span className="pill pill-neutral hidden sm:inline-flex">fictional</span>
        </Link>
        <nav className="flex items-center gap-4 sm:gap-5">
          {item("/review", "Sample review", "review")}
          {item("/intake", "Intake flow", "intake")}
        </nav>
      </div>
    </header>
  );
}
