import Link from "next/link";
import { Hero, SiteFooter } from "@/components/Brand";

export default function NotFound() {
  return (
    <>
      <Hero kicker="404" title="Stranica nije pronađena" sub="Link je možda pogrešan ili događaj još nije objavljen." />
      <main className="wrap" style={{ paddingTop: 36 }}>
        <Link href="/" className="btn">Na početnu</Link>
      </main>
      <SiteFooter />
    </>
  );
}
