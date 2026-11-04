import Link from "next/link";
import { db } from "@/lib/db";
import { fmtDateRange } from "@/lib/util";
import { Hero, SiteFooter } from "@/components/Brand";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ prijava?: string }> }) {
  const { prijava } = await searchParams;
  const projects = await db.project.findMany({ where: { status: { in: ["PUBLISHED", "COMPLETED"] } }, orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }] });
  return (
    <>
      <Hero kicker="EESTEC LC Sarajevo" title="Događaji" sub="Agende, ankete za ručak i feedback na jednom mjestu." />
      <main className="wrap" style={{ paddingTop: 36 }}>
        {prijava === "neuspjela" ? <div className="notice" role="alert">Prijava nije uspjela ili je otkazana. Pokušaj ponovo.</div> : null}
        <div className="projects">
          {projects.map((p) => (
            <Link key={p.id} href={`/e/${p.slug}`} className="pcard">
              <h2>{p.name}</h2>
              <p>{[fmtDateRange(p.startsAt, p.endsAt), p.location, p.description].filter(Boolean).join(" · ")}</p>
            </Link>
          ))}
          {projects.length === 0 ? <p>Trenutno nema objavljenih događaja.</p> : null}
        </div>
        <p style={{ marginTop: 28 }}><Link href="/admin" className="btn ghost sm">Admin</Link></p>
      </main>
      <SiteFooter />
    </>
  );
}
