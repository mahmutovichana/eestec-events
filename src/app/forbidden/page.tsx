import Link from "next/link";
import { Hero, SiteFooter } from "@/components/Brand";
import { getCurrentUser } from "@/lib/session";

export const metadata = { title: "Nema pristupa", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function Forbidden() {
  const user = await getCurrentUser();
  return (
    <>
      <Hero kicker="403" title="Nema pristupa" sub="Ova stranica je samo za administratore." />
      <main className="wrap" style={{ paddingTop: 36 }}>
        <p>{user ? `Prijavljen/a si kao ${user.email}, a taj račun nema administratorska prava.` : "Prijavi se administratorskim računom."}</p>
        <p style={{ marginTop: 18 }}><Link href="/" className="btn">Na početnu</Link></p>
      </main>
      <SiteFooter />
    </>
  );
}
