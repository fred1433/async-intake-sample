import { About } from "@/components/landing/About";
import { Hero } from "@/components/landing/Hero";
import { Rules } from "@/components/landing/Rules";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { TopBanner } from "@/components/site/TopBanner";
import { dict } from "@/lib/i18n";

export default function HomePage() {
  const t = dict("en");
  return (
    <main className="flex min-h-full flex-col">
      <TopBanner text={t.bannerTop} />
      <SiteHeader current="home" />
      <Hero />
      <Rules />
      <About />
      <SiteFooter note={t.sampleOnly} />
    </main>
  );
}
