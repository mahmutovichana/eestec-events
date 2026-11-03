import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { fmtDateRange } from "@/lib/util";
import { Hero, SiteFooter } from "@/components/Brand";
import { Tabs } from "@/components/Tabs";
import { CopyLink } from "@/components/CopyLink";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  const p = await db.project.findUnique({ where: { slug: project }, select: { name: true, description: true, status: true } });
  if (!p || p.status === "DRAFT") return { title: "Događaj" };
  return { title: p.name, description: p.description || undefined };
}

export default async function PublicLayout({ children, params }: { children: React.ReactNode; params: Promise<{ project: string }> }) {
  const { project } = await params;
  const p = await db.project.findUnique({ where: { slug: project } });
  if (!p) notFound();
  const user = await getCurrentUser();
  const preview = p.status === "DRAFT";
  // Nacrt vidi samo admin (pregled prije objave). Za sve ostale se ponaša kao da ne postoji.
  if (preview && user?.role !== "ADMIN") notFound();

  const facts = [fmtDateRange(p.startsAt, p.endsAt), p.location].filter(Boolean);
  return (
    <>
      <Hero
        kicker={p.status === "COMPLETED" ? "Završen događaj" : p.status === "ARCHIVED" ? "Arhiva" : "Događaj"}
        title={p.name}
        sub={p.description || undefined}
        facts={facts}
        actions={<CopyLink path={`/e/${p.slug}`} label="Kopiraj link događaja" className="btn white sm" />}
      />
      <Tabs base={`/e/${p.slug}`} />
      <main className="wrap">
        {preview ? <div className="notice">Pregled za administratora. Događaj je nacrt i javnost ga ne vidi.</div> : null}
        {p.status === "COMPLETED" ? <div className="notice">Događaj je završen. Glasanje je zatvoreno, a feedback je i dalje otvoren.</div> : null}
        {p.status === "ARCHIVED" ? <div className="notice">Događaj je arhiviran i dostupan samo za čitanje.</div> : null}
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
